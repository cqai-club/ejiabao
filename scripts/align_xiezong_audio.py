"""Build caption and motion cues from the generated speech, not script length."""

import argparse
import difflib
import json
import re
from pathlib import Path


def normalize(text):
    return "".join(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", text))


def align_script(script, words):
    text = normalize(script)
    heard, starts, ends = [], [], []
    for word in words:
        letters = normalize(word["word"])
        for index, letter in enumerate(letters):
            heard.append(letter)
            span = word["end"] - word["start"]
            starts.append(word["start"] + span * index / len(letters))
            ends.append(word["start"] + span * (index + 1) / len(letters))
    blocks = difflib.SequenceMatcher(None, text, "".join(heard), autojunk=False).get_matching_blocks()
    coverage = sum(block.size for block in blocks) / max(1, len(text))
    if not text or coverage < 0.8:
        raise ValueError(f"Speech/script match too low: {coverage:.1%}; review the generated speech")
    anchors = {}
    for block in blocks:
        for offset in range(block.size):
            anchors[block.a + offset] = (starts[block.b + offset], ends[block.b + offset])
    times = []
    for index in range(len(text)):
        if index in anchors:
            times.append(anchors[index])
            continue
        before = max((i for i in anchors if i < index), default=-1)
        after = min((i for i in anchors if i > index), default=len(text))
        start = anchors[before][1] if before >= 0 else starts[0]
        end = anchors[after][0] if after < len(text) else ends[-1]
        step = max(0, end - start) / (after - before - 1)
        times.append((start + step * (index - before - 1), start + step * (index - before)))
    return text, times, coverage


def build_timeline(script, words, duration):
    text, times, coverage = align_script(script, words)
    captions = []
    cursor = 0
    for clause in re.split(r"[，。！？；、\n\r]+", script):
        clean = normalize(clause)
        for offset in range(0, len(clean), 14):
            part = clean[offset:offset + 14]
            start = times[cursor][0]
            end = min(duration, max(start + 0.08, times[cursor + len(part) - 1][1]))
            captions.append({"text": part, "start": round(start, 3), "end": round(end, 3)})
            cursor += len(part)

    definitions = [
        ("准备装修", "title", "准备装修", ""),
        ("别再到处跑建材", "title", "别再到处跑建材", ""),
        ("我是谢兰军", "name", "谢兰军", ""),
        ("瓷砖", "categories", "", ""),
        ("一站式配齐", "promise", "一站式配齐", ""),
        ("货源直供", "promise", "货源直供", ""),
        ("不玩虚报价", "contrast", "不玩虚报价", ""),
        ("新房装修", "title", "新房装修", ""),
        ("大单子小单子", "title", "大单小单", "都用心对待"),
        ("看得见实物", "promise", "看得见实物", ""),
        ("售后有门店兜底", "promise", "门店兜底", ""),
        ("欢迎来兰军建材城", "closing", "兰军建材城", ""),
        ("交个朋友也可以", "closing", "交个朋友", ""),
    ]
    cues = []
    for keyword, kind, title, subtitle in definitions:
        at = text.find(keyword)
        if at < 0:
            continue
        # A claim appears once its defining words have started, never by an estimated section time.
        cue = {"kind": kind, "title": title, "subtitle": subtitle, "start": round(times[at][0], 3)}
        if kind == "categories":
            cue["items"] = [{"text": item, "start": round(times[text.index(item, at)][0], 3)} for item in ["瓷砖", "门窗", "卫浴", "板材"] if item in text[at:]]
        if subtitle:
            sub_at = text.find(normalize(subtitle), at)
            cue["subtitleStart"] = times[sub_at][0] if sub_at >= 0 else duration
        cues.append(cue)
    cues.sort(key=lambda cue: cue["start"])
    for index, cue in enumerate(cues):
        cue["end"] = round(min(cues[index + 1]["start"] - 0.12, cue["start"] + 6.5) if index + 1 < len(cues) else duration - 0.08, 3)
    cues = [cue for cue in cues if cue["end"] - cue["start"] > 0.6]
    return {"duration": duration, "captions": captions, "cues": cues, "speechMatch": coverage, "words": words}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    script = args.script.read_text(encoding="utf-8-sig")
    model = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
    segments, info = model.transcribe(str(args.video), language="zh", beam_size=5, word_timestamps=True, initial_prompt=script, vad_filter=True)
    words = [{"word": word.word, "start": word.start, "end": word.end} for segment in segments for word in segment.words]
    result = build_timeline(script, words, info.duration)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Speech match: {result['speechMatch']:.1%}; captions={len(result['captions'])}; cues={len(result['cues'])}")


if __name__ == "__main__":
    main()
