---
name: dsh-vlog-edit
description: "实拍素材 → 高光剪辑成片。Use when the user wants to auto-edit real footage clips into a highlight VLOG with cuts, captions and music。"
---

# VLOG（实拍精剪）

扫描实拍素材，自动高光裁剪、拼接，保留原声，加字幕和配乐。

## 快速开始

```bash
python scripts/run.py --clips ./footage --out ./out --duration 60 --aspect 9:16 --bgm ./bgm.mp3
```

## 输入

| 参数 | 说明 |
| --- | --- |
| `--clips` | 素材目录（自动扫 mp4/mov/m4v/mkv/avi/webm）或视频文件列表 |
| `--script` | 主题/文案（可选，用于高光字幕） |


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

ingest（扫描素材+探针）→ plan（高光剪辑计划）→ cut（裁剪+拼接，保留原声）→ polish（字幕+配乐）→ publish（封面+发布包）

## 输出

final_video.mp4、subtitles.srt、cover_3x4/4x3/16x9.png、publish_package_handoff.json

## 凭据（`~/.dsh/.credentials.yaml`）

DEEPSEEK_API_KEY（高光字幕/发布元数据）、DASHSCOPE_API_KEY（封面）

## 离线降级

无 LLM 用离线剪辑计划（剪头去尾 + 按目标时长分配），仍能快速出成片。

## 脚本

- `scripts/run.py` — CLI 入口
- `scripts/pipeline.py` — 工作流实现（继承 `_base.BaseWorkflow`）
- `scripts/_base.py` — 共享运行时（FFmpeg/TTS/LLM/状态/发布包）
- `config.example.json` — 配置示例
