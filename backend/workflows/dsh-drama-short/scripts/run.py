# -*- coding: utf-8 -*-
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import DramaShortWorkflow  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='剧情短片（文案生成剧情） · 故事梗概 → 分镜剧本 → 短片')
    ap.add_argument('--out', required=True, help='输出目录')
    ap.add_argument('--title', default='', help='成片标题/主题')
    ap.add_argument('--duration', type=int, default=0, help='目标时长秒数（0=默认）')
    ap.add_argument('--aspect', default='9:16', help='画幅 9:16/16:9/1:1/3:4/4:3')
    ap.add_argument('--bgm', default='', help='背景音乐路径（可选）')
    ap.add_argument('--skip-llm', action='store_true', help='跳过 LLM，离线模板出草稿')
    ap.add_argument('--skip-covers', action='store_true', help='跳过封面生成')
    ap.add_argument('--stage', default='', help='只跑某个阶段（空=全跑）')
    ap.add_argument('--story', default='', help='故事梗概（或 --script 传完整剧本）')
    ap.add_argument('--script', default='', help='完整剧本（可选，与 --story 二选一）')
    ap.add_argument('--voice', default='', help='音色A（第一角色）')
    ap.add_argument('--voice-b', default='', help='音色B（第二角色）')

    args = ap.parse_args()
    out = os.path.abspath(args.out)
    cfg = {
        'title': args.title,
        'duration': args.duration,
        'aspect': args.aspect,
        'bgm': args.bgm,
        "story": args.story, "script": args.script, "voice": args.voice, "voice_b": args.voice_b,
    }
    wf = DramaShortWorkflow(out, cfg, args)
    print('[run] %s · %s' % (wf.name, wf.description))
    print('[run] 输出目录：%s' % out)
    if args.stage:
        wf.run_stage(args.stage)
        print('[run] 阶段 %s 完成。' % args.stage)
    else:
        wf.run_all()


if __name__ == '__main__':
    main()
