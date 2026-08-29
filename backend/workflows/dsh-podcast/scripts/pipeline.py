# ============================================================
# workflows/podcast.py · 工作流 4：文生播客（豆包双人）
#
# 输入：主题/话题（或现成双人对话稿）
# 流程：双人对话稿(豆包大模型) -> 分角色配音(豆包双人 TTS，回落 edge-tts)
#       -> 音频波形可视化 + 说话人字幕 -> 成片
# 输出：final_video.mp4 + podcast.mp3 + publish_package_handoff.json
# ============================================================
import json
import os
import shutil
import sys

from _base import (
    BaseWorkflow, dialogue_tts, generate_covers, llm, make_publish_meta,
    make_waveform, mux_audio, burn_subtitles, probe_duration, read_credentials,
    run_ff, srt_from_captions, write_handoff,
)

PODCAST_PROMPT = """你是一名播客主编。请根据下面的话题，写一段双人对话播客稿（一位主持人 + 一位嘉宾），
只输出 JSON（不要任何解释）：

{{
  "title": "本期播客标题（≤20字，有信息量）",
  "segments": [
    {{"role": "主持人", "text": "..."}},
    {{"role": "嘉宾", "text": "..."}}
  ]
}}

规则：
1. 主持人负责开场、提问、串场、收尾；嘉宾负责展开观点、举例子；
2. 两人轮流发言，共 {turns} 轮左右，总字数控制在 {chars} 字以内（约 {minutes} 分钟口播）；
3. 语言口语化、有对话感，避免书面腔。

话题：
{topic}"""


class PodcastWorkflow(BaseWorkflow):
    name = 'podcast'
    description = '文生播客（豆包双人）：话题 → 双人对话播客（视频 + 音频）'
    stages = ['script', 'audio', 'visual', 'assemble', 'publish']

    def topic(self):
        return (getattr(self.args, 'topic', None) or getattr(self.args, 'script', None)
                or self.cfg.get('topic', '') or self.cfg.get('script', ''))

    def _offline_plan(self, topic, turns, chars):
        t = (topic or 'AI 如何改变内容创作').strip()
        pairs = [
            {'role': '主持人', 'text': '欢迎来到本期节目，今天我们聊聊：%s。这个话题最近很热。' % t},
            {'role': '嘉宾', 'text': '是的，%s 正在快速改变很多人的工作方式，我们先从一个具体场景说起。' % t},
            {'role': '主持人', 'text': '能举一个最直观的例子吗？'},
            {'role': '嘉宾', 'text': '比如自动生成口播、自动剪辑，以前要一整天，现在可能几分钟就出第一版。'},
            {'role': '主持人', 'text': '那普通人上手难不难？'},
            {'role': '嘉宾', 'text': '关键是把流程拆清楚，工具反而越来越简单。'},
            {'role': '主持人', 'text': '最后给大家一句建议吧。'},
            {'role': '嘉宾', 'text': '别只看热闹，从一个真实任务开始跑通它。'},
        ]
        n = max(2, min(turns, len(pairs)))
        return {'title': t[:16] + '：一场对话', 'segments': pairs[:n], 'source': 'offline'}

    # ---- 阶段 1：对话稿 ----
    def stage_script(self):
        if self.state.get('script_ok') and os.path.isfile(os.path.join(self.out, 'plan.json')):
            self.log('plan.json 已存在，跳过。', 'script')
            return
        topic = self.topic()
        if not topic:
            self.log('未提供 --topic/--script，使用示例话题。', 'script')
            topic = 'AI 如何改变内容创作'
        duration = int(getattr(self.args, 'duration', 0) or self.cfg.get('duration', 180))
        minutes = max(1, round(duration / 60))
        chars = int(duration * 5.0)
        turns = max(4, duration // 12)
        plan = None
        if not self.skip_llm():
            try:
                content = llm(PODCAST_PROMPT.format(topic=topic, turns=turns, chars=chars, minutes=minutes),
                              prefer='doubao')
                data = json.loads(content)
                if data.get('segments'):
                    plan = data
                    plan['source'] = 'doubao'
            except Exception as exc:
                self.log('LLM 对话稿失败，使用离线模板：%s' % exc, 'script')
        if not plan:
            plan = self._offline_plan(topic, turns, chars)
        with open(os.path.join(self.out, 'plan.json'), 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        script_text = '\n'.join('%s：%s' % (s.get('role', ''), s.get('text', '')) for s in plan['segments'])
        with open(os.path.join(self.out, 'script.txt'), 'w', encoding='utf-8') as f:
            f.write(script_text)
        self.save({'script_ok': True, 'script_text': script_text, 'plan': plan})
        self.log('对话稿完成：%d 段' % len(plan['segments']), 'script')

    # ---- 阶段 2：配音（豆包双人）----
    def stage_audio(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        audio_dir = os.path.join(self.out, 'audio')
        os.makedirs(audio_dir, exist_ok=True)
        wav = os.path.join(audio_dir, 'podcast.wav')
        cred = read_credentials()
        has_volc = bool(cred.get('VOLC_APP_ID') and cred.get('VOLC_ACCESS_TOKEN'))
        voice_a = getattr(self.args, 'voice', None) or self.cfg.get('voice', '')
        voice_b = getattr(self.args, 'voice_b', None) or self.cfg.get('voice_b', '')

        if has_volc:
            self.log('使用豆包双人 TTS（A=%s / B=%s）' % (
                voice_a or cred.get('VOLC_VOICE_A', '默认'),
                voice_b or cred.get('VOLC_VOICE_B', '默认')), 'audio')
        else:
            self.log('未配置 VOLC 凭据，豆包双人回落 edge-tts 双音色。', 'audio')

        _, timeline = dialogue_tts(
            [{'role': s.get('role', '主持人'), 'text': s.get('text', '')} for s in plan['segments']],
            wav, voice_a=voice_a or None, voice_b=voice_b or None, prefer='doubao',
        )
        with open(os.path.join(self.out, 'timeline.json'), 'w', encoding='utf-8') as f:
            json.dump(timeline, f, ensure_ascii=False, indent=2)
        self.save({'audio_ok': True, 'podcast_wav': wav, 'timeline': timeline})
        self.log('配音完成：%s（%.1f 秒）' % (wav, probe_duration(wav) or 0), 'audio')

    # ---- 阶段 3：画面（波形 + 说话人字幕）----
    def stage_visual(self):
        wav = self.state.get('podcast_wav', '')
        timeline = self.state.get('timeline', [])
        dur = probe_duration(wav) or float(getattr(self.args, 'duration', 180))
        size = self.aspect()
        raw = os.path.join(self.out, 'raw_video.mp4')
        make_waveform(wav, raw, dur, size=size)

        captions = [{'text': '%s：%s' % (t.get('role', ''), t.get('text', '')),
                     'start': t['start'], 'end': t['end']} for t in timeline]
        subbed = os.path.join(self.out, 'subbed.mp4')
        burn_subtitles(raw, captions, subbed)
        with open(os.path.join(self.out, 'subtitles.srt'), 'w', encoding='utf-8') as f:
            f.write(srt_from_captions(captions))
        self.save({'visual_ok': True, 'subbed_video': subbed})
        self.log('波形画面 + 说话人字幕完成', 'visual')

    # ---- 阶段 4：合成 ----
    def stage_assemble(self):
        subbed = self.state.get('subbed_video', '')
        wav = self.state.get('podcast_wav', '')
        final = os.path.join(self.out, 'final_video.mp4')
        mux_audio(subbed, wav, final)
        # 同时输出纯音频 mp3
        mp3 = os.path.join(self.out, 'podcast.mp3')
        run_ff(['-y', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', mp3])
        self.save({'assemble_ok': True, 'final_video': final, 'podcast_mp3': mp3})
        self.log('成片完成：%s / %s' % (final, mp3), 'assemble')

    # ---- 阶段 5：发布 ----
    def stage_publish(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        title = plan.get('title') or self.cfg.get('title', 'AI 播客')
        meta = make_publish_meta(title, self.state.get('script_text', ''), tags_hint=['播客', 'AI', '对话'], skip_llm=self.skip_llm())
        covers = generate_covers(self.out, '科技播客封面：麦克风、声波、双人对话氛围、深色底', self.skip_covers())
        path = write_handoff(self.out, self.state.get('final_video', ''), meta, covers=covers)
        self.save({'publish_ok': True, 'publish_meta': meta, 'covers': covers})
        self.log('发布包完成：%s' % path, 'publish')
