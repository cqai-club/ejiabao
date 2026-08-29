# ============================================================
# workflows/base.py · 四个新工作流的共享底座
#
# 约定与主 pipeline 一致：
#   - 状态写进 <out>/pipeline_state.json，支持断点续跑
#   - 凭据读 ~/.dsh/.credentials.yaml（DEEPSEEK / DASHSCOPE / ARK / VOLC）
#   - 网络统一走 ProxyHandler({}) 直连，绕开本机 WinINET 死代理
#   - 任何外部依赖缺失/无 Key 都优雅降级，离线也能出一版草稿
#
# 提供：状态、凭据、HTTP、LLM(DeepSeek/豆包)、TTS(edge-tts/豆包/双人)、
#      FFmpeg(探针/拼接/Ken Burns/波形/字幕烧录/配乐) 与发布包输出。
# ============================================================
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _resolve_dh():
    cands = [os.environ.get('DSH_DIGITAL_HUMAN', ''),
             os.path.join(BASE, 'digital-human')]
    for c in cands:
        if c and os.path.isdir(c):
            return c
    return os.path.join(BASE, 'digital-human')

DH = _resolve_dh()
VENV_PY = os.path.join(DH, 'venv', 'Scripts', 'python.exe')
TTS_SCRIPT = os.path.join(DH, 'tts.py')

CRED_FILE = os.path.expanduser('~/.dsh/.credentials.yaml')


# ------------------------------------------------------------
# 路径 / 常量
# ------------------------------------------------------------
def find_ffmpeg():
    cands = [os.environ.get('DSH_FFMPEG', ''), os.path.join(DH, 'bin', 'ffmpeg.exe')]
    cands += [shutil.which('ffmpeg'), shutil.which('ffmpeg.exe')]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return 'ffmpeg'


def find_font():
    for name in ['simhei.ttf', 'Deng.ttf', 'Dengb.ttf', 'NotoSansSC-VF.ttf', 'msyh.ttc']:
        p = os.path.join(r'C:\Windows\Fonts', name)
        if os.path.isfile(p):
            return p
    return None


FFMPEG = find_ffmpeg()
FONT = find_font()
FONT_NAME = 'SimHei'


def fpath(p):
    """把 Windows 路径转成 ffmpeg filter 里可安全使用的形式。"""
    return p.replace('\\', '/').replace(':', '\\:')


def aspect_to_size(aspect):
    """'9:16' -> (1080, 1920) 等常用短视频尺寸。"""
    table = {
        '9:16': (1080, 1920),
        '16:9': (1920, 1080),
        '1:1': (1080, 1080),
        '3:4': (1080, 1440),
        '4:3': (1440, 1080),
    }
    if aspect in table:
        return table[aspect]
    m = re.match(r'^(\d+)[xX:](\d+)$', str(aspect).strip())
    if m:
        return int(m.group(1)), int(m.group(2))
    return 1080, 1920


# ------------------------------------------------------------
# 状态
# ------------------------------------------------------------
def load_state(out):
    sf = os.path.join(out, 'pipeline_state.json')
    if os.path.isfile(sf):
        with open(sf, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_state(out, patch):
    state = load_state(out)
    state.update(patch)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'pipeline_state.json'), 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    return state


# ------------------------------------------------------------
# 凭据
# ------------------------------------------------------------
def read_credentials():
    cred = {}
    if os.path.isfile(CRED_FILE):
        try:
            for line in open(CRED_FILE, encoding='utf-8', errors='ignore'):
                line = line.strip()
                if not line or line.startswith('#') or ':' not in line:
                    continue
                k, v = line.split(':', 1)
                cred[k.strip()] = v.strip().strip('"').strip("'")
        except OSError:
            pass
    for envk, key in [('DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'), ('DASHSCOPE_API_KEY', 'DASHSCOPE_API_KEY'),
                      ('ARK_API_KEY', 'ARK_API_KEY'), ('VOLC_APP_ID', 'VOLC_APP_ID'),
                      ('VOLC_ACCESS_TOKEN', 'VOLC_ACCESS_TOKEN')]:
        if envk in os.environ and key not in cred:
            cred[key] = os.environ[envk]
    return cred


# ------------------------------------------------------------
# HTTP（禁代理直连）
# ------------------------------------------------------------
def http_json(url, body=None, headers=None, method=None, timeout=120, raw=False):
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method or ('POST' if data is not None else 'GET'))
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if data is not None:
        req.add_header('Content-Type', 'application/json; charset=utf-8')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as r:
        payload = r.read()
    return payload if raw else json.loads(payload.decode('utf-8'))


# ------------------------------------------------------------
# LLM
# ------------------------------------------------------------
def call_deepseek(prompt, json_mode=True, max_tokens=4000):
    key = read_credentials().get('DEEPSEEK_API_KEY')
    if not key:
        return None
    body = {
        'model': 'deepseek-chat',
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.7,
        'max_tokens': max_tokens,
    }
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    data = http_json('https://api.deepseek.com/chat/completions', body,
                     headers={'Authorization': 'Bearer ' + key})
    return data['choices'][0]['message']['content']


def call_doubao(prompt, json_mode=True, model=None, max_tokens=4000):
    """火山方舟（豆包大模型）。缺 Key 时回落到 DeepSeek。"""
    cred = read_credentials()
    key = cred.get('ARK_API_KEY')
    if not key:
        return call_deepseek(prompt, json_mode, max_tokens)
    model = model or cred.get('ARK_MODEL') or 'doubao-1-5-pro-32k-250115'
    body = {
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.7,
        'max_tokens': max_tokens,
    }
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    data = http_json('https://ark.cn-beijing.volces.com/api/v3/chat/completions', body,
                     headers={'Authorization': 'Bearer ' + key})
    return data['choices'][0]['message']['content']


def llm(prompt, prefer='deepseek', json_mode=True, max_tokens=4000, model=None):
    if prefer == 'doubao':
        return call_doubao(prompt, json_mode, model, max_tokens)
    return call_deepseek(prompt, json_mode, max_tokens)


# ------------------------------------------------------------
# TTS
# ------------------------------------------------------------
def edge_tts(text, out_wav, voice='zh-CN-XiaoxiaoNeural'):
    """复用 digital-human/tts.py（edge-tts + ffmpeg 转 16k wav）。"""
    if not (os.path.isfile(VENV_PY) and os.path.isfile(TTS_SCRIPT)):
        return None
    tmp = out_wav + '.txt'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    try:
        r = subprocess.run(
            [VENV_PY, TTS_SCRIPT, '--script', tmp, '--out-wav', out_wav, '--voice', voice],
            capture_output=True, text=True, timeout=300,
        )
        if os.path.isfile(tmp):
            os.remove(tmp)
        if r.returncode == 0 and os.path.isfile(out_wav):
            return out_wav
    except Exception as exc:
        print('[tts] edge-tts 失败：%s' % exc)
    return None


def doubao_tts(text, out_mp3, voice=None, cluster=None):
    """火山引擎语音合成（豆包音色）。voice=音色ID，cluster=音色集群。"""
    cred = read_credentials()
    appid = cred.get('VOLC_APP_ID')
    token = cred.get('VOLC_ACCESS_TOKEN')
    if not (appid and token):
        return None
    body = {
        'app': {'appid': appid, 'token': token, 'cluster': cluster or 'volcano_tts'},
        'user': {'uid': 'dsh-pipeline'},
        'audio': {'voice_type': voice or 'zh_female_shuangkuaisisi_moon_bigtts',
                  'encoding': 'mp3', 'speed_ratio': 1.0},
        'request': {'reqid': uuid.uuid4().hex, 'text': text, 'text_type': 'plain', 'operation': 'query'},
    }
    data = http_json('https://openspeech.bytedance.com/api/v1/tts', body,
                     headers={'Authorization': 'Bearer;%s' % token})
    if data.get('code') not in (0, 3000):
        raise RuntimeError('豆包 TTS 失败：%s' % data.get('message'))
    b64 = data.get('data') or ''
    with open(out_mp3, 'wb') as f:
        f.write(base64.b64decode(b64))
    return out_mp3


def make_silence(out_wav, duration=1.0, rate=44100):
    run_ff(['-y', '-v', 'error', '-f', 'lavfi', '-i',
            'anullsrc=r=%d:cl=stereo' % rate, '-t', '%.2f' % duration, out_wav])
    return out_wav


def dialogue_tts(segments, out_wav, voice_a=None, voice_b=None, prefer='edge', gap=0.45):
    """双人对话合成。

    segments: [{'role': 'A'|'B'|str, 'text': str, 'voice': str?}, ...]
    返回 (out_wav, timeline) —— timeline 为每段 {role, text, start, end, path}。
    引擎顺序：豆包(voice 以 zh_ 开头时) -> edge-tts 双音色 -> 静音占位。
    """
    os.makedirs(os.path.dirname(out_wav), exist_ok=True)
    cred = read_credentials()
    has_volc = bool(cred.get('VOLC_APP_ID') and cred.get('VOLC_ACCESS_TOKEN'))
    has_edge = os.path.isfile(VENV_PY) and os.path.isfile(TTS_SCRIPT)

    va = voice_a or cred.get('VOLC_VOICE_A') or 'zh-CN-XiaoxiaoNeural'
    vb = voice_b or cred.get('VOLC_VOICE_B') or 'zh-CN-YunxiNeural'

    parts = []
    timeline = []
    t = 0.0

    # 角色名 -> 音色 映射：第一个出现的角色用 A 音色，第二个用 B 音色（兼容任意角色名）
    role_voices = {}

    def voice_for(role, idx):
        key = str(role)
        if key in role_voices:
            return role_voices[key]
        if len(role_voices) == 0:
            role_voices[key] = va
        elif len(role_voices) == 1:
            role_voices[key] = vb
        else:
            role_voices[key] = va if idx % 2 == 0 else vb
        return role_voices[key]

    for idx, seg in enumerate(segments):
        text = (seg.get('text') or '').strip()
        role = seg.get('role') or ('A' if idx % 2 == 0 else 'B')
        voice = seg.get('voice') or voice_for(role, idx)
        if not text:
            continue
        seg_path = os.path.join(os.path.dirname(out_wav), 'seg_%02d_%s.mp3' % (idx, role))
        made = None
        if has_volc and str(voice).startswith('zh_'):
            try:
                made = doubao_tts(text, seg_path, voice=voice)
            except Exception as exc:
                print('[tts] 豆包失败，回落：%s' % exc)
        if not made and has_edge:
            wav = seg_path[:-4] + '.wav'
            made = edge_tts(text, wav, voice=voice)
            if made:
                run_ff(['-y', '-v', 'error', '-i', made, '-c:a', 'libmp3lame', '-q:a', '4', seg_path])
                made = seg_path
        if not made:
            print('[tts] 无可用 TTS，用静音占位（%d 字）。' % len(text))
            seg_path = seg_path[:-4] + '.wav'
            make_silence(seg_path, duration=max(1.0, len(text) / 5.0))
            made = seg_path

        d = probe_duration(made) or max(1.0, len(text) / 5.0)
        timeline.append({'role': role, 'text': text, 'start': round(t, 3),
                         'end': round(t + d, 3), 'path': made})
        parts.append(made)
        t += d
        if idx < len(segments) - 1:
            sil = os.path.join(os.path.dirname(out_wav), 'gap_%02d.wav' % idx)
            make_silence(sil, duration=gap)
            parts.append(sil)
            t += gap

    concat_audio(parts, out_wav)
    return out_wav, timeline


# ------------------------------------------------------------
# FFmpeg 基础
# ------------------------------------------------------------
def run_ff(args, **kw):
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error'] + args
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError('ffmpeg 失败：%s' % (r.stderr[-300:] if r.stderr else ' '.join(cmd)))
    return r


def probe_duration(media):
    if not media or not os.path.isfile(media):
        return None
    r = subprocess.run([FFMPEG, '-hide_banner', '-i', media, '-f', 'null', '-'],
                       capture_output=True, text=True, timeout=120)
    m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', r.stderr or '')
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    return None


def concat_audio(parts, out_wav, rate=44100):
    if not parts:
        raise RuntimeError('没有可拼接的音频片段')
    lst = out_wav + '.concat.txt'
    with open(lst, 'w', encoding='utf-8') as f:
        for p in parts:
            f.write("file '%s'\n" % p.replace('\\', '/').replace("'", "'\\''"))
    run_ff(['-y', '-f', 'concat', '-safe', '0', '-i', lst,
            '-c:a', 'pcm_s16le', '-ar', str(rate), '-ac', '2', out_wav])
    if os.path.isfile(lst):
        os.remove(lst)
    return out_wav


def normalize_clip(src, out_mp4, size, fps=25):
    w, h = size
    run_ff(['-y', '-i', src,
            '-vf', 'scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%d' % (w, h, w, h, fps),
            '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out_mp4])
    return out_mp4


def concat_videos(clips, out_mp4, size=None, fps=25):
    size = size or (1080, 1920)
    if not clips:
        raise RuntimeError('没有视频片段')
    norm = []
    tmp = os.path.join(os.path.dirname(out_mp4), '.norm')
    os.makedirs(tmp, exist_ok=True)
    for i, c in enumerate(clips):
        nc = os.path.join(tmp, 'clip_%03d.mp4' % i)
        normalize_clip(c, nc, size, fps)
        norm.append(nc)
    lst = out_mp4 + '.concat.txt'
    with open(lst, 'w', encoding='utf-8') as f:
        for p in norm:
            f.write("file '%s'\n" % p.replace('\\', '/').replace("'", "'\\''"))
    run_ff(['-y', '-f', 'concat', '-safe', '0', '-i', lst,
            '-c', 'copy', '-movflags', '+faststart', out_mp4])
    if os.path.isfile(lst):
        os.remove(lst)
    shutil.rmtree(tmp, ignore_errors=True)
    return out_mp4


def trim_clip_av(src, out_mp4, start, end, size, fps=25):
    """裁剪并归一化一段素材（保留原声；无音轨则补静音轨），保证后续可 concat -c copy。"""
    w, h = size
    vf = 'scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%d' % (w, h, w, h, fps)
    dur = max(0.1, float(end) - float(start))
    if _has_audio(src):
        run_ff(['-y', '-ss', '%.2f' % start, '-i', src, '-t', '%.2f' % dur,
                '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', out_mp4])
    else:
        run_ff(['-y', '-ss', '%.2f' % start, '-i', src, '-f', 'lavfi', '-i',
                'anullsrc=r=44100:cl=stereo', '-t', '%.2f' % dur, '-vf', vf,
                '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-shortest', out_mp4])
    return out_mp4


def concat_copies(clips, out_mp4):
    """已归一化的片段用 concat demuxer 无损拼接（含音视频轨）。"""
    lst = out_mp4 + '.concat.txt'
    with open(lst, 'w', encoding='utf-8') as f:
        for p in clips:
            f.write("file '%s'\n" % p.replace('\\', '/').replace("'", "'\\''"))
    run_ff(['-y', '-f', 'concat', '-safe', '0', '-i', lst,
            '-c', 'copy', '-movflags', '+faststart', out_mp4])
    if os.path.isfile(lst):
        os.remove(lst)
    return out_mp4


def ken_burns(image, out_mp4, duration, size=None, fps=25, mode='in'):
    size = size or (1080, 1920)
    w, h = size
    zexpr = 'min(zoom+0.0016,1.5)' if mode == 'in' else 'if(eq(on,1),1.5,max(1.5-0.0016*on,1.0))'
    vf = ('scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,'
          'zoompan=z=\'%s\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':'
          'd=%d:s=%dx%d:fps=%d'
          % (w * 2, h * 2, w * 2, h * 2, zexpr, int(duration * fps), w, h, fps))
    run_ff(['-y', '-loop', '1', '-i', image, '-vf', vf, '-t', '%.2f' % duration,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out_mp4])
    return out_mp4


def make_waveform(audio, out_mp4, duration, size=None, fg='0x67e8f9', bg='0x101828', fps=25):
    size = size or (1080, 1920)
    w, h = size
    fc = ('[0:a]showwaves=s=%dx%d:mode=cline:rate=%d:colors=%s[wave];'
          'color=c=%s:s=%dx%d:d=%.3f:r=%d[bg];[bg][wave]overlay=0:0:shortest=1[out]'
          % (w, h, fps, fg, bg, w, h, duration, fps))
    run_ff(['-y', '-i', audio, '-filter_complex', fc, '-map', '[out]',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out_mp4])
    return out_mp4


def srt_from_captions(captions):
    lines = []
    for i, c in enumerate(captions, 1):
        lines.append(str(i))
        lines.append('%s --> %s' % (ts(c['start']), ts(c['end'])))
        lines.append(c['text'])
        lines.append('')
    return '\n'.join(lines)


def ts(sec):
    sec = max(0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec - int(sec)) * 1000))
    return '%02d:%02d:%02d,%03d' % (h, m, s, ms)


def burn_subtitles(video, captions, out_mp4, fontname=None, fontsize=20):
    if not captions:
        shutil.copyfile(video, out_mp4)
        return out_mp4
    srt = out_mp4 + '.srt'
    with open(srt, 'w', encoding='utf-8') as f:
        f.write(srt_from_captions(captions))
    fontname = fontname or FONT_NAME
    style = ("FontName=%s,FontSize=%d,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
             "BorderStyle=1,Outline=1.5,Shadow=0,MarginV=48,Alignment=2" % (fontname, fontsize))
    try:
        run_ff(['-y', '-i', video, '-vf',
                "subtitles='%s':force_style='%s'" % (fpath(srt), style),
                '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out_mp4])
        return out_mp4
    except Exception as exc:
        print('[subs] 字幕烧录失败，保留无字幕版：%s' % exc)
        shutil.copyfile(video, out_mp4)
        return out_mp4


def mix_bgm(video, bgm, out_mp4, bgm_volume=0.18, voice_volume=1.0):
    has_audio = False
    try:
        has_audio = _has_audio(video)
    except Exception:
        has_audio = False
    dur = probe_duration(video) or 0
    if has_audio:
        fc = ("[0:a]volume=%.2f[v];[1:a]volume=%.2f,aloop=loop=-1:size=2e9,"
              "atrim=0:%.3f[m];[v][m]amix=inputs=2:duration=first:dropout_transition=3[a]"
              % (voice_volume, bgm_volume, dur))
        run_ff(['-y', '-i', video, '-stream_loop', '-1', '-i', bgm,
                '-filter_complex', fc, '-map', '0:v', '-map', '[a]',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out_mp4])
    else:
        run_ff(['-y', '-i', video, '-stream_loop', '-1', '-i', bgm,
                '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac',
                '-b:a', '192k', '-shortest', out_mp4])
    return out_mp4


def _has_audio(video):
    r = subprocess.run([FFMPEG, '-hide_banner', '-i', video], capture_output=True, text=True)
    return 'Audio:' in (r.stderr or '')


def mux_audio(video, audio, out_mp4):
    run_ff(['-y', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out_mp4])
    return out_mp4


def loudnorm(video, out_mp4):
    run_ff(['-y', '-i', video, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', out_mp4])
    return out_mp4


# ------------------------------------------------------------
# 发布包
# ------------------------------------------------------------
def wanx_image(key, prompt, size, out_path, negative='文字,字母,数字,水印,logo'):
    """通义万相文生图（异步任务 + 轮询），返回 out_path 或 None。"""
    body = {
        'model': 'wan2.2-t2i-flash',
        'input': {'prompt': prompt, 'negative_prompt': negative},
        'parameters': {'size': size, 'n': 1},
    }
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
        data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'Authorization': 'Bearer ' + key,
                 'X-DashScope-Async': 'enable'},
    )
    with opener.open(req, timeout=60) as r:
        task_id = json.loads(r.read().decode('utf-8'))['output']['task_id']
    for _ in range(80):
        time.sleep(3)
        req2 = urllib.request.Request(
            'https://dashscope.aliyuncs.com/api/v1/tasks/' + task_id,
            headers={'Authorization': 'Bearer ' + key},
        )
        with opener.open(req2, timeout=60) as r2:
            st = json.loads(r2.read().decode('utf-8'))['output']
        if st.get('task_status') == 'SUCCEEDED':
            with opener.open(st['results'][0]['url'], timeout=120) as r3:
                data = r3.read()
            with open(out_path, 'wb') as f:
                f.write(data)
            return out_path
        if st.get('task_status') == 'FAILED':
            return None
    return None


def generate_covers(out, base_prompt, skip_covers=False):
    """通义万相生成 3:4 / 4:3 / 16:9 网感封面，返回 {name: path}。"""
    covers = {}
    if skip_covers:
        return covers
    key = read_credentials().get('DASHSCOPE_API_KEY')
    if not key:
        print('[covers] 未找到 DASHSCOPE_API_KEY，跳过封面生成。')
        return covers
    jobs = [
        ('cover_3x4.png', '768*1024', base_prompt + '竖版3:4构图，上方留出干净深色区域用于放标题。'),
        ('cover_4x3.png', '1024*768', base_prompt + '横版4:3构图，主体偏右，左侧留白。'),
        ('cover_16x9.png', '1280*720', base_prompt + '宽屏16:9构图，主体位于右侧三分之一，左侧干净深色背景。'),
    ]
    for name, size, prompt in jobs:
        path = os.path.join(out, name)
        try:
            got = wanx_image(key, prompt, size, path)
            covers[name] = path if got else None
            print('[covers] %s：%s' % (name, 'ok' if got else '失败'))
        except Exception as exc:
            print('[covers] %s：失败 %s' % (name, exc))
            covers[name] = None
    return {k: v for k, v in covers.items() if v}


def make_publish_meta(title, script_text, tags_hint=None, skip_llm=False):
    meta = {'title': title or 'AI 短视频', 'description': '', 'tags': (tags_hint or [])[:8], 'source': 'offline'}
    if skip_llm:
        return meta
    try:
        prompt = (
            '为这条短视频生成发布元数据，只输出 JSON：'
            '{"title": "抖音/小红书标题（≤30字，带网感钩子）",'
            '"description": "简介（≤100字，含 1-2 个 emoji 和行动号召）",'
            '"tags": ["话题1","话题2","话题3","话题4","话题5"]}。\n'
            '视频主题：%s\n口播稿开头：%s'
        ) % (title, (script_text or '')[:200])
        data = json.loads(call_deepseek(prompt))
        meta = {'title': data['title'], 'description': data['description'],
                'tags': data.get('tags', [])[:8], 'source': 'deepseek'}
    except Exception as exc:
        print('[publish] 元数据生成失败，使用离线默认：%s' % exc)
    return meta


def write_handoff(out, video, meta, platforms=None, note='', covers=None):
    handoff = {
        'video': video,
        'title': meta['title'],
        'description': meta['description'],
        'tags': meta['tags'],
        'covers': covers or {},
        'platforms': platforms or ['douyin', 'xiaohongshu'],
        'ai_generated_disclosure': '本视频包含 AI 生成内容',
        'note': note or '交给 publish-video-multiplatform 技能完成账号登录与发布。',
    }
    path = os.path.join(out, 'publish_package_handoff.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(handoff, f, ensure_ascii=False, indent=2)
    return path


# ------------------------------------------------------------
# BaseWorkflow
# ------------------------------------------------------------
class BaseWorkflow:
    name = ''
    description = ''
    stages = []

    def __init__(self, out, cfg, args):
        self.out = out
        self.cfg = cfg or {}
        self.args = args
        os.makedirs(out, exist_ok=True)
        self.state = load_state(out)
        self.state.setdefault('config', self.cfg)

    def save(self, patch=None):
        if patch:
            self.state.update(patch)
        save_state(self.out, self.state)
        return self.state

    def log(self, msg, stage=''):
        print('[%s] %s' % (stage or self.name, msg))

    def skip_llm(self):
        return bool(getattr(self.args, 'skip_llm', False))

    def skip_covers(self):
        return bool(getattr(self.args, 'skip_covers', False))

    def aspect(self):
        return aspect_to_size(getattr(self.args, 'aspect', '') or self.cfg.get('aspect', '9:16'))

    def run_stage(self, stage_name):
        fn = getattr(self, 'stage_' + stage_name, None)
        if fn is None:
            raise RuntimeError('未知阶段：%s' % stage_name)
        self.log('开始（%s）' % stage_name)
        fn()
        self.save()

    def run_all(self):
        for s in self.stages:
            self.run_stage(s)
        self.log('全部阶段完成 → %s' % os.path.join(self.out, 'final_video.mp4'))
