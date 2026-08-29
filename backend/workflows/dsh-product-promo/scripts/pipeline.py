# ============================================================
# workflows/product_promo.py · 工作流 1：商品推广（图转视频）
#
# 输入：商品图（1-N 张）+ 卖点关键词
# 流程：卖点文案/分镜(LLM) -> 分镜配音(TTS，拿到真实时长)
#       -> 图片动态化(图转视频 API 或 FFmpeg Ken Burns，按时长) -> 字幕/配乐合成 -> 发布包
# 输出：final_video.mp4 + publish_package_handoff.json
# ============================================================
import json
import os
import shutil

from _base import (
    BaseWorkflow, concat_videos, dialogue_tts, generate_covers, ken_burns,
    make_publish_meta, mix_bgm, mux_audio, burn_subtitles,
    llm, run_ff, srt_from_captions, write_handoff,
)

IMG2VIDEO_PROMPT = """你是一名带货短视频编导。请根据商品卖点写一条 30-60 秒的带货口播，
并拆成 4-8 个分镜，只输出 JSON（不要任何解释）：

{{
  "title": "短视频标题（≤20字，带钩子）",
  "shots": [
    {{"visual": "该分镜的画面描述（镜头运动/产品特写/信息点，用于图转视频）", "voiceover": "该分镜口播文案（一句话）", "duration": 5}}
  ]
}}

规则：
1. shots 顺序按 痛点钩子 -> 卖点展开 -> 使用场景 -> 行动号召 结构；
2. 每个 shot 的 duration 为 3-8 秒整数，总时长控制在 {duration} 秒左右（仅作参考，实际以配音时长为准）；
3. voiceover 口语化、有感染力，每个 shot 一句话。

商品卖点：
{keywords}"""


class ProductPromoWorkflow(BaseWorkflow):
    name = 'product'
    description = '商品推广（图转视频）：商品图 + 卖点 → 带货短视频'
    stages = ['script', 'audio', 'visual', 'assemble', 'publish']

    def images(self):
        imgs = list(getattr(self.args, 'images', None) or []) or self.cfg.get('images', [])
        return [os.path.abspath(p) for p in imgs if p and os.path.isfile(p)]

    def keywords(self):
        return getattr(self.args, 'keywords', None) or self.cfg.get('keywords', '') or '品质好物，限时优惠'

    def _offline_plan(self, keywords, duration):
        import re
        points = [p.strip() for p in re.split(r'[,，、;；\n]', keywords or '') if p.strip()]
        if not points:
            points = ['品质好物', '限时优惠', '值得入手']
        lines = ['这' + points[0] + '，真的值得看看']
        for p in points[:6]:
            lines.append(p + '，就是这么能打。')
        lines.append('现在下单，马上拥有。')
        per = max(3, min(7, round(duration / max(1, len(lines)))))
        shots = []
        for i, ln in enumerate(lines):
            shots.append({'visual': '镜头%s：产品特写，缓慢推近' % (i + 1),
                          'voiceover': ln, 'duration': per})
        return {'title': (keywords[:16] or '好物推荐') + '，值得入手', 'shots': shots, 'source': 'offline'}

    # ---- 阶段 1：脚本 ----
    def stage_script(self):
        if self.state.get('script_ok') and os.path.isfile(os.path.join(self.out, 'plan.json')):
            self.log('plan.json 已存在，跳过。', 'script')
            return
        keywords = self.keywords()
        duration = int(getattr(self.args, 'duration', 0) or self.cfg.get('duration', 45))
        plan = None
        if not self.skip_llm():
            try:
                content = llm(IMG2VIDEO_PROMPT.format(duration=duration, keywords=keywords))
                data = json.loads(content)
                if data.get('shots'):
                    plan = data
                    plan['source'] = 'llm'
            except Exception as exc:
                self.log('LLM 分镜失败，使用离线模板：%s' % exc, 'script')
        if not plan:
            plan = self._offline_plan(keywords, duration)
        with open(os.path.join(self.out, 'plan.json'), 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        script_text = '\n'.join(s['voiceover'] for s in plan['shots'])
        with open(os.path.join(self.out, 'script.txt'), 'w', encoding='utf-8') as f:
            f.write(script_text)
        self.save({'script_ok': True, 'script_text': script_text, 'plan': plan})
        self.log('分镜完成：%d 个镜头' % len(plan['shots']), 'script')

    # ---- 阶段 2：配音（先配音，拿到真实时长）----
    def stage_audio(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        audio_dir = os.path.join(self.out, 'audio')
        os.makedirs(audio_dir, exist_ok=True)
        voice_wav = os.path.join(audio_dir, 'voiceover.wav')
        segments = [{'role': 'A', 'text': s['voiceover']} for s in plan['shots']]
        voice = getattr(self.args, 'voice', None) or self.cfg.get('voice', '')
        _, timeline = dialogue_tts(segments, voice_wav, voice_a=voice or None, prefer='edge', gap=0.0)
        with open(os.path.join(self.out, 'timeline.json'), 'w', encoding='utf-8') as f:
            json.dump(timeline, f, ensure_ascii=False, indent=2)
        self.save({'audio_ok': True, 'voiceover': voice_wav, 'timeline': timeline})
        self.log('配音完成：%d 段，%.1f 秒' % (len(timeline), timeline[-1]['end'] if timeline else 0), 'audio')

    # ---- 阶段 3：画面（图转视频，按时长）----
    def stage_visual(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        timeline = self.state.get('timeline', [])
        imgs = self.images()
        if not imgs:
            self.log('未提供 --images，用纯色底代替（可先跑通流程）。', 'visual')
            imgs = [self._placeholder_image()]
        size = self.aspect()
        shots_dir = os.path.join(self.out, 'shots')
        os.makedirs(shots_dir, exist_ok=True)
        clips = []
        for i, shot in enumerate(plan['shots']):
            out = os.path.join(shots_dir, 'shot_%02d.mp4' % i)
            if os.path.isfile(out):
                clips.append(out)
                continue
            d = (timeline[i]['end'] - timeline[i]['start']) if i < len(timeline) else float(shot.get('duration', 5))
            d = max(1.0, d)
            ken_burns(imgs[i % len(imgs)], out, d, size=size, mode='in' if i % 2 == 0 else 'out')
            clips.append(out)
        concat_videos(clips, os.path.join(self.out, 'raw_video.mp4'), size=size)
        self.save({'visual_ok': True, 'raw_video': os.path.join(self.out, 'raw_video.mp4')})
        self.log('画面动态化完成：%d 个镜头' % len(clips), 'visual')

    def _placeholder_image(self):
        p = os.path.join(self.out, 'placeholder.png')
        if not os.path.isfile(p):
            run_ff(['-y', '-f', 'lavfi', '-i', 'color=c=0x2a2a3a:s=1080x1080', '-frames:v', '1', p])
        return p

    # ---- 阶段 4：合成 ----
    def stage_assemble(self):
        raw = os.path.join(self.out, 'raw_video.mp4')
        voice = self.state.get('voiceover', '')
        timeline = self.state.get('timeline', [])
        with_audio = os.path.join(self.out, 'with_audio.mp4')
        if voice and os.path.isfile(voice):
            mux_audio(raw, voice, with_audio)
        else:
            shutil.copyfile(raw, with_audio)

        captions = [{'text': t['text'], 'start': t['start'], 'end': t['end']} for t in timeline]
        subbed = os.path.join(self.out, 'subbed.mp4')
        burn_subtitles(with_audio, captions, subbed)

        final = os.path.join(self.out, 'final_video.mp4')
        bgm = getattr(self.args, 'bgm', None) or self.cfg.get('bgm', '')
        if bgm and os.path.isfile(bgm):
            mix_bgm(subbed, bgm, final)
        else:
            shutil.copyfile(subbed, final)
        with open(os.path.join(self.out, 'subtitles.srt'), 'w', encoding='utf-8') as f:
            f.write(srt_from_captions(captions))
        self.save({'assemble_ok': True, 'final_video': final})
        self.log('成片完成：%s' % final, 'assemble')

    # ---- 阶段 5：发布 ----
    def stage_publish(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        title = plan.get('title') or self.cfg.get('title', '好物推荐')
        meta = make_publish_meta(title, self.state.get('script_text', ''), tags_hint=['好物推荐', '带货', '种草'], skip_llm=self.skip_llm())
        covers = generate_covers(self.out, '电商带货商品封面：产品特写、高质感打光、醒目卖点氛围', self.skip_covers())
        path = write_handoff(self.out, self.state.get('final_video', ''), meta, covers=covers)
        self.save({'publish_ok': True, 'publish_meta': meta, 'covers': covers})
        self.log('发布包完成：%s' % path, 'publish')
