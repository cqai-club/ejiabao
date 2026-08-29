---
name: dsh-event-promo
description: "活动信息 + 海报 → 倒计时/亮点/报名引导视频。Use when the user wants to turn event info + poster into a countdown/highlights/signup promo video。"
---

# 活动预告（快宣物料）

把活动信息（标题/时间/地点/费用/亮点）和海报素材，做成「倒计时 + 亮点 + 报名引导」三段式预告视频。

## 快速开始

```bash
python scripts/run.py --poster 海报.png --event-time "2026-08-23 09:00" --title "活动标题" --location "重庆渝中" --fee "599元" --highlights "现场实操" "博士导师" --qr 二维码.png --out ./out
```

## 输入

| 参数 | 说明 |
| --- | --- |
| `--poster` | 海报素材图 |
| `--event-time` | 活动时间（如 2026-08-23 09:00 或 8月23日） |
| `--location` | 地点 |
| `--fee` | 费用 |
| `--highlights` | 亮点（1-N 个） |
| `--qr` | 报名二维码图片（可选） |
| `--days` | 倒计时天数（覆盖自动计算） |
| `--voice` | 音色（传值启用配音，可选） |


| 通用参数 | 说明 |
| --- | --- |
| `--out` | 输出目录（重复运行可断点续跑） |
| `--title` | 成片标题/主题 |
| `--duration` | 目标时长秒数 |
| `--aspect` | 画幅：9:16（默认）/ 16:9 / 1:1 / 3:4 / 4:3 |
| `--bgm` | 背景音乐路径（可选） |
| `--skip-llm` | 跳过 LLM，离线模板出草稿 |
| `--skip-covers` | 跳过封面生成 |
| `--stage` | 只跑某个阶段（空=全跑） |

## 阶段

script（活动信息→计划）→ visual（倒计时/亮点/报名引导分段画面）→ audio（可选配音）→ assemble（配乐合成）→ publish（封面+发布包）

## 输出

final_video.mp4、cover_3x4/4x3/16x9.png、publish_package_handoff.json

## 凭据（`~/.dsh/.credentials.yaml`）

DEEPSEEK_API_KEY（亮点提炼/发布元数据）、DASHSCOPE_API_KEY（封面）、VOLC_APP_ID+VOLC_ACCESS_TOKEN（可选配音）

## 离线降级

无 LLM 用传入的 --highlights；无海报用纯色底；无二维码则只显示报名引导文字。倒计时天数按 --event-time 自动计算，可用 --days 覆盖。

## 脚本

- `scripts/run.py` — CLI 入口
- `scripts/pipeline.py` — 工作流实现（继承 `_base.BaseWorkflow`）
- `scripts/_base.py` — 共享运行时（FFmpeg/TTS/LLM/状态/发布包）
- `config.example.json` — 配置示例
