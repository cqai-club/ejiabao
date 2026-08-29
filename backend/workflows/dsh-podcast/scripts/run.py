# -*- coding: utf-8 -*-
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import PodcastWorkflow  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='文生播客（豆包双人） · 话题 → 双人对话播客（视频+音频）')
    ap.add_argument('--out', required=True, help='输出目录')
    ap.add_argument('--title', default='', help='成片标题/主题')
    ap.add_argument('--duration', type=int, default=0, help='目标时长秒数（0=默认）')
    ap.add_argument('--aspect', default='9:16', help='画幅 9:16/16:9/1:1/3:4/4:3')
    ap.add_argument('--bgm', default='', help='背景音乐路径（可选）')
    ap.add_argument('--skip-llm', action='store_true', help='跳过 LLM，离线模板出草稿')
    ap.add_argument('--skip-covers', action='store_true', help='跳过封面生成')
    ap.add_argument('--stage', default='', help='只跑某个阶段（空=全跑）')
    ap.add_argument('--topic', default='', help='话题（或 --script 传现成对话稿）')
    ap.add_argument('--script', default='', help='现成双人对话稿（可选）')
    ap.add_argument('--voice', default='', help='主持人音色（豆包音色ID）')
    ap.add_argument('--voice-b', default='', help='嘉宾音色（豆包音色ID）')

    args = ap.parse_args()
    out = os.path.abspath(args.out)
    cfg = {
        'title': args.title,
        'duration': args.duration,
        'aspect': args.aspect,
        'bgm': args.bgm,
        "topic": args.topic, "script": args.script, "voice": args.voice, "voice_b": args.voice_b,
    }
    wf = PodcastWorkflow(out, cfg, args)
    print('[run] %s · %s' % (wf.name, wf.description))
    print('[run] 输出目录：%s' % out)
    if args.stage:
        wf.run_stage(args.stage)
        print('[run] 阶段 %s 完成。' % args.stage)
    else:
        wf.run_all()


if __name__ == '__main__':
    main()
