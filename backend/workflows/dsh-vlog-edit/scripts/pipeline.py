# ============================================================
# workflows/vlog_edit.py · 工作流 3：VLOG（实拍精剪）
#
# 输入：实拍素材目录（或视频文件列表）+ 主题
# 流程：素材扫描/探针 -> 高光剪辑计划(LLM) -> 裁剪/拼接
#       -> 字幕/配乐/响度归一 -> 发布包
# 输出：final_video.mp4 + publish_package_handoff.json
# ============================================================
import glob
import json
import os
import shutil
import sys

from _base import (
    BaseWorkflow, concat_copies, generate_covers, make_publish_meta, mix_bgm,
    burn_subtitles, llm, probe_duration, srt_from_captions, trim_clip_av,
    write_handoff,
)

VIDEO_EXTS = ('*.mp4', '*.mov', '*.m4v', '*.mkv', '*.avi', '*.webm')

CUT_PLAN_PROMPT = """你是一名 VLOG 剪辑师。下面是若干段实拍素材的时长信息，以及 VLOG 主题。
请给出精剪计划，只输出 JSON（不要任何解释）：

{{
  "title": "成片标题（≤20字）",
  "clips": [
    {{"index": 0, "start": 1.0, "end": 8.0, "caption": "该片段的画面亮点字幕（一句话，无画面则写主题相关）"}}
  ]
}}

规则：
1. index 对应素材编号；start/end 是保留区间（秒），剪掉开头抖动的 1-2 秒和结尾拖沓；
2. 总保留时长控制在 {duration} 秒左右；
3. caption 用于烧录成片段字幕，口语化、有网感。

素材清单：
{clip_info}"""


class VlogWorkflow(BaseWorkflow):
    name = 'vlog'
    description = 'VLOG（实拍精剪）：实拍素材 → 高光剪辑成片'
    stages = ['ingest', 'plan', 'cut', 'polish', 'publish']

    def _scan_clips(self):
        clips = list(getattr(self.args, 'clips', None) or []) or self.cfg.get('clips', [])
        if isinstance(clips, str):
            clips = [clips]
        found = []
        for c in clips:
            if os.path.isdir(c):
                for ext in VIDEO_EXTS:
                    found += sorted(glob.glob(os.path.join(c, ext)))
            elif os.path.isfile(c):
                found.append(c)
        return [os.path.abspath(p) for p in found]

    # ---- 阶段 1：素材扫描 ----
    def stage_ingest(self):
        clips = self._scan_clips()
        if not clips:
            self.log('未找到实拍素材（--clips 目录/文件）。', 'ingest')
            sys.exit(1)
        info = []
        for i, c in enumerate(clips):
            info.append({'index': i, 'path': c, 'duration': round(probe_duration(c) or 0, 2)})
        with open(os.path.join(self.out, 'clips.json'), 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
        self.save({'ingest_ok': True, 'clips': info})
        self.log('扫描到 %d 段素材' % len(info), 'ingest')

    # ---- 阶段 2：剪辑计划 ----
    def stage_plan(self):
        if self.state.get('plan_ok') and os.path.isfile(os.path.join(self.out, 'cut_plan.json')):
            self.log('cut_plan.json 已存在，跳过。', 'plan')
            return
        clips = self.state.get('clips', [])
        duration = int(getattr(self.args, 'duration', 0) or self.cfg.get('duration', 60))
        topic = getattr(self.args, 'title', None) or self.cfg.get('title', '') or '日常 VLOG'

        plan = None
        if not self.skip_llm():
            clip_info = '\n'.join('素材%d：%.2f 秒' % (c['index'], c['duration']) for c in clips)
            try:
                content = llm(CUT_PLAN_PROMPT.format(duration=duration, clip_info=clip_info))
                data = json.loads(content)
                if data.get('clips'):
                    plan = data
                    plan['source'] = 'llm'
            except Exception as exc:
                self.log('LLM 剪辑计划失败，使用离线模板：%s' % exc, 'plan')
        if not plan:
            plan = self._offline_plan(clips, duration, topic)

        # 校正区间并写回
        for item in plan.get('clips', []):
            idx = int(item.get('index', 0))
            if 0 <= idx < len(clips):
                total = clips[idx]['duration']
                item['start'] = max(0.0, min(float(item.get('start', 0)), max(0, total - 1)))
                item['end'] = min(float(item.get('end', total)), total)
                item['path'] = clips[idx]['path']
            else:
                item['skip'] = True
        plan['clips'] = [c for c in plan.get('clips', []) if not c.get('skip')]
        if not plan['clips']:
            self.log('剪辑计划为空，退出。', 'plan')
            sys.exit(1)
        with open(os.path.join(self.out, 'cut_plan.json'), 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        self.save({'plan_ok': True, 'cut_plan': plan})
        self.log('剪辑计划完成：保留 %d 个片段' % len(plan['clips']), 'plan')

    def _offline_plan(self, clips, duration, topic):
        keep = []
        per = max(3.0, duration / max(1, len(clips)))
        for c in clips:
            total = c['duration']
            start = min(1.0, total * 0.05) if total > 2 else 0.0
            end = min(total, start + per)
            if end - start < 1.0:
                end = total
            keep.append({'index': c['index'], 'start': round(start, 2), 'end': round(end, 2),
                         'caption': '%s · 精彩片段' % topic[:10]})
        return {'title': topic, 'clips': keep, 'source': 'offline'}

    # ---- 阶段 3：裁剪 ----
    def stage_cut(self):
        plan = json.load(open(os.path.join(self.out, 'cut_plan.json'), encoding='utf-8'))
        size = self.aspect()
        cuts_dir = os.path.join(self.out, 'cuts')
        os.makedirs(cuts_dir, exist_ok=True)
        cut_clips = []
        for i, item in enumerate(plan['clips']):
            out = os.path.join(cuts_dir, 'cut_%02d.mp4' % i)
            if os.path.isfile(out):
                cut_clips.append(out)
                continue
            trim_clip_av(item['path'], out, float(item['start']), float(item['end']), size)
            cut_clips.append(out)
        concat_copies(cut_clips, os.path.join(self.out, 'raw_video.mp4'))
        self.save({'cut_ok': True, 'raw_video': os.path.join(self.out, 'raw_video.mp4')})
        self.log('裁剪拼接完成：%d 个片段（保留原声）' % len(cut_clips), 'cut')

    # ---- 阶段 4：润色 ----
    def stage_polish(self):
        raw = os.path.join(self.out, 'raw_video.mp4')
        plan = json.load(open(os.path.join(self.out, 'cut_plan.json'), encoding='utf-8'))

        # 片段字幕（按片段时长累计）
        captions = []
        t = 0.0
        for item in plan['clips']:
            d = float(item['end']) - float(item['start'])
            captions.append({'text': item.get('caption', ''), 'start': round(t, 2), 'end': round(t + d, 2)})
            t += d
        subbed = os.path.join(self.out, 'subbed.mp4')
        burn_subtitles(raw, captions, subbed)

        final = os.path.join(self.out, 'final_video.mp4')
        bgm = getattr(self.args, 'bgm', None) or self.cfg.get('bgm', '')
        if bgm and os.path.isfile(bgm):
            mix_bgm(subbed, bgm, final)
        else:
            shutil.copyfile(subbed, final)
        with open(os.path.join(self.out, 'subtitles.srt'), 'w', encoding='utf-8') as f:
            f.write(srt_from_captions(captions))
        self.save({'polish_ok': True, 'final_video': final})
        self.log('成片完成：%s' % final, 'polish')

    # ---- 阶段 5：发布 ----
    def stage_publish(self):
        plan = json.load(open(os.path.join(self.out, 'cut_plan.json'), encoding='utf-8'))
        title = plan.get('title') or self.cfg.get('title', '日常 VLOG')
        meta = make_publish_meta(title, self.state.get('script_text', ''), tags_hint=['vlog', '日常', '记录'], skip_llm=self.skip_llm())
        covers = generate_covers(self.out, '真实感 VLOG 生活记录风格封面：自然光、第一视角、轻松氛围', self.skip_covers())
        path = write_handoff(self.out, self.state.get('final_video', ''), meta, covers=covers)
        self.save({'publish_ok': True, 'publish_meta': meta, 'covers': covers})
        self.log('发布包完成：%s' % path, 'publish')
