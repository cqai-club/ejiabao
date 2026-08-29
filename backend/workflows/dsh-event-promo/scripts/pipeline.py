# ============================================================
# workflows/event_promo.py · 工作流 5：活动预告（快宣物料）
#
# 输入：活动信息（标题/时间/地点/费用/亮点）+ 海报素材 + 报名二维码
# 流程：活动信息解析 -> 倒计时/亮点/报名引导分段画面（海报 Ken Burns + 大字）
#       ->（可选配音）-> 配乐合成 -> 封面/发布包
# 输出：final_video.mp4 + publish_package_handoff.json
# ============================================================
import datetime
import json
import os
import re
import shutil

from _base import (
    BaseWorkflow, concat_videos, generate_covers, ken_burns, make_publish_meta,
    mix_bgm, mux_audio, llm, probe_duration, run_ff, write_handoff,
    FONT, fpath,
)

HIGHLIGHT_PROMPT = """你是活动宣传编导。请根据下面的活动信息，提炼 3-5 个「亮点」和一句「报名引导」，
只输出 JSON（不要任何解释）：

{{
  "highlights": ["亮点1（6-12字，有吸引力）", "亮点2", "亮点3"],
  "cta": "报名引导一句话（含行动号召）"
}}

活动信息：
{info}"""


def _parse_days(event_time, days_arg):
    """计算距活动的天数；无法解析或未提供时返回 days_arg 或默认 3。"""
    if days_arg is not None:
        return int(days_arg)
    if not event_time:
        return 3
    text = str(event_time).strip()
    today = datetime.date.today()
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y-%m-%d %H:%M', '%Y/%m/%d %H:%M'):
        try:
            dt = datetime.datetime.strptime(text, fmt)
            return max(0, (dt.date() - today).days)
        except ValueError:
            pass
    m = re.match(r'(\d{1,2})月(\d{1,2})日', text)
    if m:
        y = today.year
        dt = datetime.date(y, int(m.group(1)), int(m.group(2)))
        if dt < today:
            dt = datetime.date(y + 1, int(m.group(1)), int(m.group(2)))
        return max(0, (dt - today).days)
    return 3


def _esc(t):
    return (t.replace('\\', '/').replace("'", '')
             .replace('%', '\\%').replace(':', '\\:').replace(',', '\\,'))


class EventPromoWorkflow(BaseWorkflow):
    name = 'event'
    description = '活动预告（快宣物料）：活动信息 + 海报 → 倒计时/亮点/报名引导视频'
    stages = ['script', 'visual', 'audio', 'assemble', 'publish']

    def poster(self):
        p = getattr(self.args, 'poster', None) or self.cfg.get('poster', '')
        return os.path.abspath(p) if p and os.path.isfile(p) else ''

    def qr(self):
        q = getattr(self.args, 'qr', None) or self.cfg.get('qr', '')
        return os.path.abspath(q) if q and os.path.isfile(q) else ''

    def _info_text(self):
        return '标题：%s；时间：%s；地点：%s；费用：%s' % (
            self.cfg.get('title', ''), self.cfg.get('event_time', ''),
            self.cfg.get('location', ''), self.cfg.get('fee', ''))

    # ---- 阶段 1：活动信息 -> 分段计划 ----
    def stage_script(self):
        if self.state.get('script_ok') and os.path.isfile(os.path.join(self.out, 'plan.json')):
            self.log('plan.json 已存在，跳过。', 'script')
            return
        title = self.cfg.get('title', '') or getattr(self.args, 'title', '') or '重磅活动'
        event_time = self.cfg.get('event_time', '')
        days = _parse_days(event_time, getattr(self.args, 'days', None))
        countdown_text = '今天开课' if days <= 0 else '倒计时 %d 天' % days

        highlights = list(getattr(self.args, 'highlights', None) or [])
        if highlights:
            highlights = [h.strip() for h in highlights if h.strip()]
        cta = ''
        if not highlights or not self.cfg.get('cta', ''):
            if not self.skip_llm():
                try:
                    content = llm(HIGHLIGHT_PROMPT.format(info=self._info_text()))
                    data = json.loads(content)
                    if data.get('highlights'):
                        highlights = highlights or data['highlights']
                    cta = cta or data.get('cta', '')
                except Exception as exc:
                    self.log('LLM 亮点生成失败，使用离线默认：%s' % exc, 'script')
        if not highlights:
            highlights = ['现场实操干货', '导师面对面', '名额有限先到先得']
        if not cta:
            cta = '扫码报名，以支付成功为准'

        plan = {
            'title': title,
            'event_time': event_time,
            'location': self.cfg.get('location', ''),
            'fee': self.cfg.get('fee', ''),
            'days': days,
            'countdown_text': countdown_text,
            'highlights': highlights,
            'cta': cta,
            'source': 'offline',
        }
        with open(os.path.join(self.out, 'plan.json'), 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        script_text = '%s，%s。%s。%s' % (title, countdown_text, '、'.join(highlights), cta)
        with open(os.path.join(self.out, 'script.txt'), 'w', encoding='utf-8') as f:
            f.write(script_text)
        self.save({'script_ok': True, 'script_text': script_text, 'plan': plan})
        self.log('计划完成：倒计时「%s」，%d 个亮点' % (countdown_text, len(highlights)), 'script')

    # ---- 阶段 2：分段画面 ----
    def stage_visual(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        poster = self.poster() or self._placeholder_poster()
        size = self.aspect()
        shots_dir = os.path.join(self.out, 'shots')
        os.makedirs(shots_dir, exist_ok=True)

        clips = []
        idx = 0
        # 1) 倒计时段
        ct = os.path.join(shots_dir, 'seg_%02d_countdown.mp4' % idx)
        self._make_segment(poster, ct, 3.5, size,
                           [('倒计时', 44, 0.22), (plan['countdown_text'], 92, 0.44),
                            (plan['title'][:20], 40, 0.70)])
        clips.append(ct)
        idx += 1
        # 2) 亮点段
        for h in plan['highlights']:
            out = os.path.join(shots_dir, 'seg_%02d_hl.mp4' % idx)
            self._make_segment(poster, out, 3.0, size, [('亮点', 40, 0.28), (h[:18], 72, 0.46)])
            clips.append(out)
            idx += 1
        # 3) 报名引导段（含二维码）
        cta_text = '%s · %s' % (plan['cta'][:20], plan['event_time'] or '')
        if plan['location']:
            cta_text += ' · ' + plan['location'][:12]
        out = os.path.join(shots_dir, 'seg_%02d_cta.mp4' % idx)
        self._make_segment(poster, out, 4.5, size,
                           [('报名方式', 40, 0.24), ('扫码报名', 88, 0.44), (cta_text[:26], 40, 0.72)],
                           qr=self.qr())
        clips.append(out)

        concat_videos(clips, os.path.join(self.out, 'raw_video.mp4'), size=size)
        self.save({'visual_ok': True, 'raw_video': os.path.join(self.out, 'raw_video.mp4')})
        self.log('分段画面完成：倒计时 + %d 亮点 + 报名引导' % len(plan['highlights']), 'visual')

    def _make_segment(self, poster, out, duration, size, texts, qr=''):
        w, h = size
        tmp = out + '.base.mp4'
        ken_burns(poster, tmp, duration, size=size, mode='in')
        # 叠加多行文本（居中 + 半透明底）
        vf_parts = []
        fontfile = ("fontfile='%s':" % fpath(FONT)) if FONT else ''
        for text, fontsize, yf in texts:
            vf_parts.append(
                "drawtext=%stext='%s':fontcolor=white:fontsize=%d:"
                "box=1:boxcolor=black@0.5:boxborderw=22:x=(w-text_w)/2:y=(h-text_h)*%s"
                % (fontfile, _esc(text), fontsize, yf)
            )
        vf = ','.join(vf_parts)
        try:
            if qr and os.path.isfile(qr):
                qr_w = max(120, int(w * 0.26))
                vf += (";[0:v]null[v];[1:v]scale=%d:-1[qr];[v][qr]overlay=W-w-%d:H-h-%d"
                       % (qr_w, int(w * 0.06), int(h * 0.06)))
                run_ff(['-y', '-i', tmp, '-i', qr, '-filter_complex', vf, '-map', '[v]',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out])
            else:
                run_ff(['-y', '-i', tmp, '-vf', vf,
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out])
        except Exception as exc:
            print('[event-visual] 文字/二维码滤镜不可用，保留静态海报画面：%s' % exc)
            shutil.copyfile(tmp, out)
        if os.path.isfile(tmp):
            os.remove(tmp)
        return out

    def _placeholder_poster(self):
        p = os.path.join(self.out, 'poster.png')
        if not os.path.isfile(p):
            bundled = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'event-poster.png')
            if os.path.isfile(bundled):
                shutil.copyfile(bundled, p)
            else:
                raise RuntimeError('未提供海报，且未找到内置活动预告画布。')
        return p

    # ---- 阶段 3：可选配音 ----
    def stage_audio(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        text = '%s，%s。%s。%s' % (plan['title'], plan['countdown_text'],
                                   '、'.join(plan['highlights']), plan['cta'])
        voice_wav = ''
        if getattr(self.args, 'voice', None) or self.cfg.get('voice', ''):
            from _base import dialogue_tts
            audio_dir = os.path.join(self.out, 'audio')
            os.makedirs(audio_dir, exist_ok=True)
            voice_wav = os.path.join(audio_dir, 'voiceover.wav')
            dialogue_tts([{'role': 'A', 'text': text}], voice_wav, prefer='edge', gap=0.0)
        self.save({'audio_ok': True, 'voiceover': voice_wav})
        self.log('配音：%s' % (voice_wav or '(未启用，纯配乐/静音)'), 'audio')

    # ---- 阶段 4：合成 ----
    def stage_assemble(self):
        raw = os.path.join(self.out, 'raw_video.mp4')
        voice = self.state.get('voiceover', '')
        with_audio = os.path.join(self.out, 'with_audio.mp4')
        if voice and os.path.isfile(voice):
            mux_audio(raw, voice, with_audio)
        else:
            shutil.copyfile(raw, with_audio)
        final = os.path.join(self.out, 'final_video.mp4')
        bgm = getattr(self.args, 'bgm', None) or self.cfg.get('bgm', '')
        if bgm and os.path.isfile(bgm):
            mix_bgm(with_audio, bgm, final)
        else:
            shutil.copyfile(with_audio, final)
        self.save({'assemble_ok': True, 'final_video': final})
        self.log('成片完成：%s' % final, 'assemble')

    # ---- 阶段 5：发布 ----
    def stage_publish(self):
        plan = json.load(open(os.path.join(self.out, 'plan.json'), encoding='utf-8'))
        title = plan.get('title') or self.cfg.get('title', '活动预告')
        meta = make_publish_meta(title, self.state.get('script_text', ''),
                                 tags_hint=['活动预告', '报名', '倒计时'], skip_llm=self.skip_llm())
        covers = generate_covers(self.out, '活动宣传封面：醒目大标题、倒计时元素、报名按钮氛围', self.skip_covers())
        path = write_handoff(self.out, self.state.get('final_video', ''), meta, covers=covers)
        self.save({'publish_ok': True, 'publish_meta': meta, 'covers': covers})
        self.log('发布包完成：%s' % path, 'publish')
