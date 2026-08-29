---
name: dsh-drama-short
description: "故事梗概 → 分镜剧本 → 短片。Use when the user wants to turn a story idea/script into a short drama video with scenes and dialogue。"
---

# 剧情短片（文案生成剧情）

把故事梗概扩写成分镜剧本，多角色配音，做成带对白字幕的剧情短片。

## 快速开始

```bash
python scripts/run.py --story "一个深夜加班的程序员发现公司里的AI同事一直在偷偷帮他" --out ./out --duration 40 --aspect 9:16
```

## 输入

| 参数 | 说明 |
| --- | --- |
| `--story` | 故事梗概 |
| `--script` | 完整剧本（与 `--story` 二选一） |
| `--voice` / `--voice-b` | 音色A（第一角色）/ 音色B（第二角色） |


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

script（剧本扩写+分镜）→ audio（多角色配音）→ visual（分镜画面）→ assemble（对白字幕+配乐）→ publish（封面+发布包）

## 输出

final_video.mp4、subtitles.srt、cover_3x4/4x3/16x9.png、publish_package_handoff.json

## 凭据（`~/.dsh/.credentials.yaml`）

DEEPSEEK_API_KEY（剧本/分镜/发布元数据）、DASHSCOPE_API_KEY（封面）、VOLC_APP_ID+VOLC_ACCESS_TOKEN（豆包音色，可选）

## 离线降级

无文生图/文生视频 Key 时用「场景号+画面描述」占位卡 + Ken Burns，便于审阅分镜后再接生成。

## 脚本

- `scripts/run.py` — CLI 入口
- `scripts/pipeline.py` — 工作流实现（继承 `_base.BaseWorkflow`）
- `scripts/_base.py` — 共享运行时（FFmpeg/TTS/LLM/状态/发布包）
- `config.example.json` — 配置示例
