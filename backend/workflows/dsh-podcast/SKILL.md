---
name: dsh-podcast
description: "话题 → 双人对话播客（视频+音频）。Use when the user wants to turn a topic into a two-person podcast (dialogue audio + waveform video) using Doubao dual-voice。"
---

# 文生播客（豆包双人）

把话题生成主持人+嘉宾双人对话稿，用豆包双人音色配音，做成波形动画+说话人字幕的播客。

## 快速开始

```bash
python scripts/run.py --topic "AI如何改变内容创作" --out ./out --duration 180 --aspect 16:9
```

## 输入

| 参数 | 说明 |
| --- | --- |
| `--topic` | 话题 |
| `--script` | 现成双人对话稿（可选） |
| `--voice` / `--voice-b` | 主持人音色 / 嘉宾音色（豆包音色ID） |


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

script（双人对话稿，豆包大模型）→ audio（豆包双人配音）→ visual（波形+说话人字幕）→ assemble（合成+mp3）→ publish（封面+发布包）

## 输出

final_video.mp4、podcast.mp3、subtitles.srt、cover_3x4/4x3/16x9.png、publish_package_handoff.json

## 凭据（`~/.dsh/.credentials.yaml`）

ARK_API_KEY（豆包大模型，对话稿）、VOLC_APP_ID+VOLC_ACCESS_TOKEN+VOLC_VOICE_A/B（豆包双人音色）、DASHSCOPE_API_KEY（封面）

## 离线降级

无豆包凭据自动回落 edge-tts 双音色（主持人女声 + 嘉宾男声）；无 TTS 用静音占位仍能出片。

## 脚本

- `scripts/run.py` — CLI 入口
- `scripts/pipeline.py` — 工作流实现（继承 `_base.BaseWorkflow`）
- `scripts/_base.py` — 共享运行时（FFmpeg/TTS/LLM/状态/发布包）
- `config.example.json` — 配置示例
