---
name: dsh-product-promo
description: "商品图 + 卖点 → 带货短视频。Use when the user wants to turn product images and selling points into a short promotional/带货 video。"
---

# 商品推广（图转视频）

把商品图和卖点关键词，一键做成带口播、字幕、封面的带货短视频。

## 快速开始

```bash
python scripts/run.py --images 商品1.png 商品2.png --keywords "AI剪辑神器,省时省力,一键成片" --out ./out --duration 45 --aspect 9:16
```

## 输入

| 参数 | 说明 |
| --- | --- |
| `--images` | 商品图（1-N 张，循环分配给镜头） |
| `--keywords` | 卖点关键词（逗号/顿号分隔） |
| `--voice` | 音色（可传豆包音色ID） |


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

script（卖点文案+分镜）→ audio（分镜配音）→ visual（图转视频/Ken Burns）→ assemble（字幕+配乐）→ publish（封面+发布包）

## 输出

final_video.mp4、subtitles.srt、cover_3x4/4x3/16x9.png、publish_package_handoff.json

## 凭据（`~/.dsh/.credentials.yaml`）

DEEPSEEK_API_KEY（文案/发布元数据）、DASHSCOPE_API_KEY（封面）、VOLC_APP_ID+VOLC_ACCESS_TOKEN（豆包音色，可选）

## 离线降级

无图转视频 API 时用 FFmpeg Ken Burns 推拉镜头；无任何 Key 也能用离线模板出草稿。

## 脚本

- `scripts/run.py` — CLI 入口
- `scripts/pipeline.py` — 工作流实现（继承 `_base.BaseWorkflow`）
- `scripts/_base.py` — 共享运行时（FFmpeg/TTS/LLM/状态/发布包）
- `config.example.json` — 配置示例
