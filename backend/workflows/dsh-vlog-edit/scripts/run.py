# -*- coding: utf-8 -*-
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import VlogWorkflow  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='VLOG（实拍精剪） · 实拍素材 → 高光剪辑成片')
    ap.add_argument('--out', required=True, help='输出目录')
    ap.add_argument('--title', default='', help='成片标题/主题')
    ap.add_argument('--duration', type=int, default=0, help='目标时长秒数（0=默认）')
    ap.add_argument('--aspect', default='9:16', help='画幅 9:16/16:9/1:1/3:4/4:3')
    ap.add_argument('--bgm', default='', help='背景音乐路径（可选）')
    ap.add_argument('--skip-llm', action='store_true', help='跳过 LLM，离线模板出草稿')
    ap.add_argument('--skip-covers', action='store_true', help='跳过封面生成')
    ap.add_argument('--stage', default='', help='只跑某个阶段（空=全跑）')
    ap.add_argument('--clips', nargs='*', default=[], help='素材目录或视频文件（1-N 个）')
    ap.add_argument('--script', default='', help='主题/文案（可选，用于高光字幕）')

    args = ap.parse_args()
    out = os.path.abspath(args.out)
    cfg = {
        'title': args.title,
        'duration': args.duration,
        'aspect': args.aspect,
        'bgm': args.bgm,
        "clips": args.clips, "script": args.script,
    }
    wf = VlogWorkflow(out, cfg, args)
    print('[run] %s · %s' % (wf.name, wf.description))
    print('[run] 输出目录：%s' % out)
    if args.stage:
        wf.run_stage(args.stage)
        print('[run] 阶段 %s 完成。' % args.stage)
    else:
        wf.run_all()


if __name__ == '__main__':
    main()
