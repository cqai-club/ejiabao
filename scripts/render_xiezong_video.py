from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np


FPS = 25
WIDTH = 720
HEIGHT = 1280
MAX_DRIVEN_DURATION_DELTA = 0.2
FONT_FILE = r"C:\Windows\Fonts\HarmonyOS_Sans_SC_Bold.ttf"


def read_image(path: Path, flags: int) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, flags)
    if image is None:
        raise RuntimeError(f"无法读取图片：{path}")
    return image


def write_image(path: Path, image: np.ndarray) -> None:
    suffix = path.suffix.lower() or ".png"
    ok, encoded = cv2.imencode(suffix, image)
    if not ok:
        raise RuntimeError(f"无法写入图片：{path}")
    encoded.tofile(str(path))


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout)[-3000:]
        raise RuntimeError(f"命令执行失败：{' '.join(command)}\n{detail}")
    return result


def media_duration(path: Path) -> float:
    result = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path)
    ])
    return float(result.stdout.strip())


def probe_media(path: Path) -> dict:
    result = run([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_name,codec_type,width,height,r_frame_rate",
        "-of",
        "json",
        str(path),
    ])
    return json.loads(result.stdout)


def validate_probe_data(probe: dict, expected_duration: float | None = None) -> dict:
    streams = probe.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if video is None:
        raise RuntimeError("成片缺少视频流")
    if audio is None:
        raise RuntimeError("成片缺少音频流")
    if (video.get("width"), video.get("height")) != (WIDTH, HEIGHT):
        raise RuntimeError(
            f"成片分辨率不符合预期：{video.get('width')}x{video.get('height')}，"
            f"预期 {WIDTH}x{HEIGHT}"
        )
    if video.get("codec_name") != "h264":
        raise RuntimeError(f"成片视频编码不符合预期：{video.get('codec_name')}")
    if video.get("r_frame_rate") != f"{FPS}/1":
        raise RuntimeError(f"成片帧率不符合预期：{video.get('r_frame_rate')}")
    duration = float(probe.get("format", {}).get("duration", 0))
    if duration <= 0:
        raise RuntimeError("成片时长无效")
    if expected_duration is not None and abs(duration - expected_duration) > 0.15:
        raise RuntimeError(
            f"成片时长不符合预期：{duration:.3f}s，预期 {expected_duration:.3f}s"
        )
    return {
        "duration": duration,
        "width": video["width"],
        "height": video["height"],
        "video_codec": video["codec_name"],
        "audio_codec": audio.get("codec_name"),
        "frame_rate": video["r_frame_rate"],
    }


def validate_rendered_video(path: Path, expected_duration: float | None = None) -> dict:
    if not path.is_file():
        raise FileNotFoundError(path)
    return validate_probe_data(probe_media(path), expected_duration)


def make_cutout(source: Path, output: Path) -> None:
    image = read_image(source, cv2.IMREAD_COLOR)
    # The green-screen panel occupies the center of the supplied screenshot.
    crop = image[475:1144, 150:520]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hue, saturation, value = cv2.split(hsv)
    green = ((hue >= 35) & (hue <= 90) & (saturation >= 65) & (value >= 35)).astype(np.uint8) * 255
    green = cv2.morphologyEx(green, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    green = cv2.morphologyEx(green, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    alpha = cv2.GaussianBlur(255 - green, (3, 3), 0)
    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    write_image(output, rgba)


def resize_cover(image: np.ndarray, scale: float) -> np.ndarray:
    target_height = max(HEIGHT, round(HEIGHT * scale))
    ratio = target_height / image.shape[0]
    target_width = max(WIDTH, round(image.shape[1] * ratio))
    return cv2.resize(image, (target_width, target_height), interpolation=cv2.INTER_CUBIC)


def make_background(image: np.ndarray, scale: float, pan_x: float, pan_y: float) -> np.ndarray:
    resized = resize_cover(image, scale)
    max_x = resized.shape[1] - WIDTH
    max_y = resized.shape[0] - HEIGHT
    center_x = max_x / 2
    center_y = max_y / 2
    x = int(np.clip(center_x + pan_x, 0, max_x))
    y = int(np.clip(center_y + pan_y, 0, max_y))
    result = resized[y:y + HEIGHT, x:x + WIDTH].copy()
    if result.shape[:2] != (HEIGHT, WIDTH):
        result = cv2.resize(result, (WIDTH, HEIGHT), interpolation=cv2.INTER_CUBIC)
    return result


def overlay_person(background: np.ndarray, person: np.ndarray, height: int, x_offset: int, y: int) -> np.ndarray:
    scale = height / person.shape[0]
    width = max(1, round(person.shape[1] * scale))
    resized = cv2.resize(person, (width, height), interpolation=cv2.INTER_LANCZOS4)
    alpha = resized[:, :, 3:4].astype(np.float32) / 255.0
    foreground = resized[:, :, :3].astype(np.float32)

    x = round((WIDTH - width) / 2 + x_offset)
    y = round(y)
    src_x = max(0, -x)
    src_y = max(0, -y)
    dst_x = max(0, x)
    dst_y = max(0, y)
    copy_width = min(width - src_x, WIDTH - dst_x)
    copy_height = min(height - src_y, HEIGHT - dst_y)
    if copy_width <= 0 or copy_height <= 0:
        return background

    fg = foreground[src_y:src_y + copy_height, src_x:src_x + copy_width]
    mask = alpha[src_y:src_y + copy_height, src_x:src_x + copy_width]
    # A soft grounding shadow keeps the still portrait from looking cut out.
    shadow_mask = cv2.GaussianBlur((mask[:, :, 0] * 150).astype(np.uint8), (31, 31), 0).astype(np.float32) / 255.0
    shadow = np.zeros_like(fg)
    target = background[dst_y:dst_y + copy_height, dst_x:dst_x + copy_width].astype(np.float32)
    target *= (1.0 - shadow_mask[:, :, None] * 0.18)
    target = target * (1.0 - mask) + fg * mask
    background[dst_y:dst_y + copy_height, dst_x:dst_x + copy_width] = np.clip(target, 0, 255).astype(np.uint8)
    return background


def add_bottom_gradient(image: np.ndarray) -> np.ndarray:
    result = image.astype(np.float32)
    start = int(HEIGHT * 0.72)
    ramp = np.zeros((HEIGHT, 1, 1), dtype=np.float32)
    ramp[start:, :, 0] = np.linspace(0, 0.34, HEIGHT - start, dtype=np.float32)[:, None]
    result *= 1.0 - ramp
    return np.clip(result, 0, 255).astype(np.uint8)


def render_base(background_path: Path, cutout_path: Path, audio_duration: float, output: Path) -> None:
    background = read_image(background_path, cv2.IMREAD_COLOR)
    person = read_image(cutout_path, cv2.IMREAD_UNCHANGED)
    frame_count = math.ceil(audio_duration * FPS)
    cut_1 = 43.68 / 73 * audio_duration
    cut_2 = 46.80 / 73 * audio_duration
    cut_3 = 48.68 / 73 * audio_duration
    segments = [
        (0.0, cut_1, 1.00, 1.045, 0, 18, 950, 180, 0),
        (cut_1, cut_2, 1.10, 1.12, 22, 22, 1030, 120, 0),
        (cut_2, cut_3, 1.10, 1.05, -18, -12, 995, 140, 0),
        (cut_3, audio_duration, 1.04, 1.01, -8, 8, 950, 180, 0),
    ]

    writer = cv2.VideoWriter(
        str(output),
        cv2.VideoWriter_fourcc(*"mp4v"),
        FPS,
        (WIDTH, HEIGHT),
    )
    if not writer.isOpened():
        raise RuntimeError(f"无法创建视频文件：{output}")

    try:
        for frame_index in range(frame_count):
            timestamp = frame_index / FPS
            segment = next(item for item in segments if timestamp < item[1] or item is segments[-1])
            start, end, scale_start, scale_end, pan_start, pan_end, person_height, person_y, person_x = segment
            progress = 0.0 if end <= start else min(1.0, max(0.0, (timestamp - start) / (end - start)))
            scale = scale_start + (scale_end - scale_start) * progress
            pan = pan_start + (pan_end - pan_start) * progress
            frame = make_background(background, scale, pan, 0)
            frame = add_bottom_gradient(frame)
            current_height = round(person_height + (12 if segment is segments[1] else -8) * progress)
            frame = overlay_person(frame, person, current_height, person_x, person_y)
            writer.write(frame)
    finally:
        writer.release()


def render_driven_base(source: Path, audio_duration: float, output: Path) -> None:
    if source.resolve() == output.resolve():
        raise ValueError("中间文件不能覆盖口型驱动素材")
    capture = cv2.VideoCapture(str(source))
    writer = None
    try:
        if not capture.isOpened():
            raise RuntimeError(f"无法读取口型驱动视频：{source}")
        fps = capture.get(cv2.CAP_PROP_FPS)
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not math.isfinite(fps) or abs(fps - FPS) > 0.01:
            raise RuntimeError("口型驱动视频必须为 25 FPS，不能通过变速匹配录音")
        if height <= 0 or abs(width / height - WIDTH / HEIGHT) > 0.005:
            raise RuntimeError("口型驱动视频必须为 9:16，避免裁切人物")
        # Audio selection is quantized to tenths; allow at most five frames at the tail.
        if count <= 0 or abs(count / fps - audio_duration) > MAX_DRIVEN_DURATION_DELTA + 1e-6:
            raise RuntimeError("口型驱动视频与原录音时长不一致，请使用同一段录音生成口型")

        writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT))
        if not writer.isOpened():
            raise RuntimeError(f"无法创建视频文件：{output}")
        cuts = [0.0, 43.68 / 73, 46.80 / 73, 48.68 / 73, 1.0]
        scales = [(1.00, 1.045), (1.10, 1.12), (1.10, 1.05), (1.04, 1.01)]
        last_frame = None
        for frame_index in range(math.ceil(audio_duration * FPS)):
            # Read every driven frame. Re-overlaying the portrait would erase its lip motion.
            if frame_index < count:
                ok, last_frame = capture.read()
                if not ok:
                    raise RuntimeError(f"口型驱动视频解码中断：第 {frame_index} 帧")
            if last_frame is None:
                raise RuntimeError("口型驱动视频没有可解码画面")
            progress = frame_index / FPS / audio_duration
            index = next((i for i in range(4) if progress < cuts[i + 1]), 3)
            local = (progress - cuts[index]) / (cuts[index + 1] - cuts[index])
            start, end = scales[index]
            writer.write(make_background(last_frame, start + (end - start) * local, 0, 0))
    finally:
        capture.release()
        if writer is not None:
            writer.release()


def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    remainder = seconds % 60
    return f"{hours}:{minutes:02d}:{remainder:05.2f}"


def wrap_text(text: str, limit: int = 15) -> str:
    text = re.sub(r"\s+", "", text)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\\N{text[limit:limit * 2]}"


def subtitle_chunks(text: str, limit: int = 15) -> list[str]:
    clean = re.sub(r"\s+", "", text)
    parts = [part for part in re.split(r"(?<=[。！？；，、])", clean) if part]
    chunks: list[str] = []
    for part in parts:
        while len(part) > limit:
            chunks.append(part[:limit])
            part = part[limit:]
        if part:
            chunks.append(part)
    return chunks


def write_ass(script_path: Path, duration: float, output: Path) -> None:
    text = script_path.read_text(encoding="utf-8").strip()
    chunks = subtitle_chunks(text)
    start = 0.32
    end = max(start + 0.1, duration - 0.48)
    weights = [max(1, len(chunk)) for chunk in chunks]
    total_weight = sum(weights)
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 720",
        "PlayResY: 1280",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Main,HarmonyOS Sans SC,42,&H0000B7FF,&H0000B7FF,&H0000F0FF,&H90000000,1,0,0,0,100,100,0,0,1,4,2,2,34,34,96,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    cursor = start
    for chunk, weight in zip(chunks, weights):
        segment_duration = (end - start) * weight / total_weight
        next_cursor = min(end, cursor + segment_duration)
        lines.append(f"Dialogue: 0,{ass_time(cursor)},{ass_time(next_cursor)},Main,,0,0,0,,{wrap_text(chunk)}")
        cursor = next_cursor
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def add_audio_and_subtitles(base: Path, audio: Path, subtitles: Path, duration: float, output: Path, workdir: Path) -> None:
    filter_value = f"subtitles={subtitles.name}:fontsdir='C\\:/Windows/Fonts',fade=t=in:st=0:d=0.25,fade=t=out:st={max(0.3, duration - 0.55):.3f}:d=0.5"
    run([
        "ffmpeg", "-y",
        "-i", base.name,
        "-i", str(audio),
        "-filter:v", filter_value,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-t", f"{duration:.3f}",
        "-r", str(FPS),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "160k",
        "-ar", "48000",
        "-ac", "2",
        "-shortest",
        output.name
    ], cwd=workdir)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用人物绿幕图、展厅背景图、文案和录音生成竖屏知识口播视频。")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--driven-video", type=Path, help="使用同一段原录音生成的 9:16、25 FPS 口型驱动视频")
    mode.add_argument("--static-preview", action="store_true", help="仅导出静态构图预览，不生成口型")
    parser.add_argument("--person", type=Path)
    parser.add_argument("--background", type=Path)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.static_preview and (args.person is None or args.background is None):
        parser.error("--static-preview 需要 --person 和 --background")
    for name in ("person", "background", "script", "audio", "output", "driven_video"):
        path = getattr(args, name)
        if path is not None:
            setattr(args, name, path.resolve())
    if args.output in (args.person, args.background, args.script, args.audio, args.driven_video):
        parser.error("输出文件不能覆盖输入素材")
    return args


def main() -> None:
    args = parse_args()

    inputs = [args.script, args.audio]
    inputs += [args.person, args.background] if args.static_preview else [args.driven_video]
    for path in inputs:
        if not path.is_file():
            raise FileNotFoundError(path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    workdir = args.output.parent
    cutout = workdir / f"{args.output.stem}.cutout.png"
    base = workdir / f"{args.output.stem}.base.mp4"
    subtitles = workdir / f"{args.output.stem}.subtitles.ass"
    duration = media_duration(args.audio)
    if args.static_preview:
        print("mode=static-preview; lip_sync=false")
        make_cutout(args.person, cutout)
        render_base(args.background, cutout, duration, base)
    else:
        render_driven_base(args.driven_video, duration, base)
    write_ass(args.script, duration, subtitles)
    add_audio_and_subtitles(base, args.audio, subtitles, duration, args.output, workdir)
    metadata = validate_rendered_video(args.output, duration)
    print(f"output={args.output}")
    print(f"duration={duration:.3f}")
    print(f"validated={metadata}")
    print(f"cut_points={[round(43.68 / 73 * duration, 3), round(46.80 / 73 * duration, 3), round(48.68 / 73 * duration, 3)]}")


if __name__ == "__main__":
    main()
