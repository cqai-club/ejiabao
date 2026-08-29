# -*- coding: utf-8 -*-
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import EventPromoWorkflow  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='活动预告（快宣物料） · 活动信息 + 海报 → 倒计时/亮点/报名引导视频')
    ap.add_argument('--out', required=True, help='输出目录')
    ap.add_argument('--title', default='', help='成片标题/主题')
    ap.add_argument('--duration', type=int, default=0, help='目标时长秒数（0=默认）')
    ap.add_argument('--aspect', default='9:16', help='画幅 9:16/16:9/1:1/3:4/4:3')
    ap.add_argument('--bgm', default='', help='背景音乐路径（可选）')
    ap.add_argument('--skip-llm', action='store_true', help='跳过 LLM，离线模板出草稿')
    ap.add_argument('--skip-covers', action='store_true', help='跳过封面生成')
    ap.add_argument('--stage', default='', help='只跑某个阶段（空=全跑）')
    ap.add_argument('--poster', default='', help='海报素材图')
    ap.add_argument('--event-time', default='', help='活动时间（如 2026-08-23 09:00 或 8月23日）')
    ap.add_argument('--location', default='', help='地点')
    ap.add_argument('--fee', default='', help='费用')
    ap.add_argument('--highlights', nargs='*', default=[], help='亮点（1-N 个）')
    ap.add_argument('--qr', default='', help='报名二维码图片')
    ap.add_argument('--days', type=int, default=None, help='倒计时天数（覆盖自动计算）')
    ap.add_argument('--voice', default='', help='音色（传值启用配音，可选）')

    args = ap.parse_args()
    out = os.path.abspath(args.out)
    cfg = {
        'title': args.title,
        'duration': args.duration,
        'aspect': args.aspect,
        'bgm': args.bgm,
        "poster": args.poster, "event_time": args.event_time, "location": args.location, "fee": args.fee, "highlights": args.highlights, "qr": args.qr,
    }
    wf = EventPromoWorkflow(out, cfg, args)
    print('[run] %s · %s' % (wf.name, wf.description))
    print('[run] 输出目录：%s' % out)
    if args.stage:
        wf.run_stage(args.stage)
        print('[run] 阶段 %s 完成。' % args.stage)
    else:
        wf.run_all()


if __name__ == '__main__':
    main()
