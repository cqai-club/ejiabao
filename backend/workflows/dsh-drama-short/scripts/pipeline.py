# ============================================================
# workflows/drama_short.py · 工作流 2：剧情短片（文案生成剧情）
#
# 输入：故事梗概/剧本 + 类型
# 流程：剧本扩写/分镜拆解(LLM) -> 多角色配音(拿真实时长)
#       -> 分镜画面(文生图/文生视频 API 或占位卡 + Ken Burns，按时长) -> 对白字幕/配乐合成 -> 发布包
# 输出：final_video.mp4 + publish_package_handoff.json
# ============================================================
import json
import os
import shutil

from _base import (
    BaseWorkflow, concat_videos, dialogue_tts, generate_covers, ken_burns,
    make_publish_meta, mix_bgm, mux_audio, burn_subtitles, llm, run_ff,
    srt_from_captions, write_handoff, FONT, fpath,
)

SCREENPLAY_PROMPT = """你是一名短剧编剧。请把下面这个故事梗概扩写成一条约 {duration} 秒的短视频剧本，
并拆成分镜，只输出 JSON（不要任何解释）：

{{
  "title": "短剧标题（≤16字，带反转钩子）",
  "genre": "类型",
  "scenes": [
    {{
      "id": 1,
      "visual": "该镜头的画面描述（场景/人物/运镜/光线，用于文生图或文生视频）",
      "dialogue": [{{"role": "角色名", "text": "台词"}}],
      "duration": 6
    }}
  ]
}}

规则：
1. scenes 顺序遵循 起-承-转-合，最后一个镜头给出反转/钩子；
2. 每个 scene 的 duration 为 4-10 秒整数，总时长控制在 {duration} 秒左右（仅参考，实际以配音时长为准）；
3. dialogue 可为空（纯旁白/无对白镜头），有台词时每句独立成项并标注角色。

故事梗概：
{story}"""

SCENE_COLORS = ['0x1e293b', '0x312e81', '0x7f1d1d', '0x14532d', '0x431407', '0x0f172a']


class DramaShortWorkflow(BaseWorkflow):
    name = 'drama'
    description = '剧情短片（文案生成剧情）：故事梗概 → 分镜剧本 → 短片'
    stages = ['script', 'audio', 'visual', 'assemble', 'publish']

    def story(self):
        return (getattr(self.args, 'story', None) or getattr(self.args, 'script', None)
                or self.cfg.get('story', '') or self.cfg.get('script', ''))

    def _offline_plan(self, story, duration):
        idea = (story or '一个平凡人遇见反转的日常故事').strip()
        scenes = [
            {'id': 1, 'visual': '开场：主角登场，交代日常', 'dialogue': [{'role': '主角', 'text': '又是普通的一天。'}], 'duration': 6},
            {'id': 2, 'visual': '发展：意外发生，冲突升级', 'dialogue': [{'role': '主角', 'text': '等等，事情不对。'}], 'duration': 6},
            {'id': 3, 'visual': '高潮：真相揭晓，情绪爆发', 'dialogue': [{'role': '主角', 'text': '原来是这样！'}], 'duration': 6},
            {'id': 4, 'visual': '结尾：反转钩子，留下悬念', 'dialogue': [{'role': '主角', 'text': '可是，那真的结束了吗？'}], 'duration': 6},
        ]
        return {'title': idea[:16] or '反转短剧', 'genre': '反转',
                'scenes': scenes, 'source': 'offline'}

    # ---- 阶段 1：剧本 ----
    def stage_script(self):
        if self.state.get('script_ok') and os.path.isfile(os.path.join(self.out, 'plan.json')):
            self.log('plan.json 已存在，跳过。', 'script')
            return
        story = self.story()
        if not story:
            self.log('未提供 --story/--script，使用示例梗概。', 'script')
            story = '一个深夜加班的程序员，发现公司里的AI同事其实一直在偷偷帮他。'
        duration = int(getattr(self.args, 'duration', 0) or self.cfg.get('duration', 40))
        plan = None
        if not self.skip_llm():
            try:
                content = llm(SCREENPLAY_PROMPT.format(duration=duration, story=story))
                data = json.loads(content)
                if data.get('scenes'):
                    plan = data
                    plan['source'] = 'llm'
            except Exception as exc:
                self.log('LLM 剧本失败，使用离线模板：%s' % exc, 'script')
        if not plan:
            plan = self._offline_plan(story, duration)
        with open(os.path.join(self.out, 'plan.json'), 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        lines = []
        for sc in plan['scenes']:
            for d in sc.get('dialogue', []):
                lines.append('%s：%s' % (d.get('role', '角色'), d.get('text', '')))
        script_text = '\n'.join(lines)
        with open(os.path.join(self.out, 'script.txt'), 'w', encoding='utf-8') as f:
            f.write(script_text)
        self.save({'script_ok': True, 'script_text': script_text, 'plan': plan})
        self.log('剧本完成：%d 个分镜' % len(plan['scenes']), 'script')

    # ---- 阶段 2：配音（先配音，拿到真实时长）----
    def stage_audio(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        audio_dir = os.path.join(self.out, 'audio')
        os.makedirs(audio_dir, exist_ok=True)
        voice_wav = os.path.join(audio_dir, 'voiceover.wav')

        segments = []
        scene_of_line = []  # 每句台词所属的 scene 下标
        for si, sc in enumerate(plan['scenes']):
            for d in sc.get('dialogue', []):
                segments.append({'role': d.get('role', '角色'), 'text': d.get('text', '')})
                scene_of_line.append(si)

        timeline = []
        scene_durations = {}
        if segments:
            _, timeline = dialogue_tts(segments, voice_wav, prefer='edge', gap=0.0)
            for li, si in enumerate(scene_of_line):
                if li < len(timeline):
                    scene_durations[si] = scene_durations.get(si, 0.0) + (timeline[li]['end'] - timeline[li]['start'])
        else:
            self.log('无对白，跳过配音。', 'audio')
            voice_wav = ''

        with open(os.path.join(self.out, 'timeline.json'), 'w', encoding='utf-8') as f:
            json.dump(timeline, f, ensure_ascii=False, indent=2)
        self.save({'audio_ok': True, 'voiceover': voice_wav, 'timeline': timeline,
                   'scene_durations': scene_durations})
        self.log('配音完成：%d 句对白' % len(timeline), 'audio')

    # ---- 阶段 3：画面 ----
    def stage_visual(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        scene_durations = self.state.get('scene_durations', {})
        size = self.aspect()
        shots_dir = os.path.join(self.out, 'shots')
        os.makedirs(shots_dir, exist_ok=True)
        clips = []
        for i, sc in enumerate(plan['scenes']):
            out = os.path.join(shots_dir, 'scene_%02d.mp4' % i)
            if os.path.isfile(out):
                clips.append(out)
                continue
            d = scene_durations.get(str(i)) or scene_durations.get(i) or float(sc.get('duration', 6))
            d = max(1.0, float(d))
            card = self._scene_card(i, sc.get('visual', ''), sc.get('id', i + 1))
            ken_burns(card, out, d, size=size, mode='in' if i % 2 == 0 else 'out')
            clips.append(out)
        concat_videos(clips, os.path.join(self.out, 'raw_video.mp4'), size=size)
        self.save({'visual_ok': True, 'raw_video': os.path.join(self.out, 'raw_video.mp4')})
        self.log('分镜画面完成：%d 个镜头（无文生图 Key 时为场景占位卡）' % len(clips), 'visual')

    def _scene_card(self, idx, visual, sid):
        p = os.path.join(self.out, 'shots', 'card_%02d.png' % idx)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        color = SCENE_COLORS[idx % len(SCENE_COLORS)]
        label = ('场景 %d' % sid) + (' | ' + visual[:20] if visual else '')
        fontfile = ('fontfile=%s:' % fpath(FONT)) if FONT else ''
        text = label.replace('\\', '/').replace(':', '\\:').replace("'", '')
        run_ff(['-y', '-f', 'lavfi', '-i', 'color=c=%s:s=1080x1080' % color,
                '-vf', "drawtext=%stext='%s':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2"
                       % (fontfile, text),
                '-frames:v', '1', p])
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

        captions = [{'text': '%s：%s' % (t.get('role', ''), t.get('text', '')),
                     'start': t['start'], 'end': t['end']} for t in timeline]
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
        title = plan.get('title') or self.cfg.get('title', '反转短剧')
        meta = make_publish_meta(title, self.state.get('script_text', ''), tags_hint=['短剧', '剧情', '反转'], skip_llm=self.skip_llm())
        covers = generate_covers(self.out, '短剧剧情封面：电影感构图、情绪张力、留白放标题', self.skip_covers())
        path = write_handoff(self.out, self.state.get('final_video', ''), meta, covers=covers)
        self.save({'publish_ok': True, 'publish_meta': meta, 'covers': covers})
        self.log('发布包完成：%s' % path, 'publish')
