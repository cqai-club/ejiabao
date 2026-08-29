# 平台交互技能：Codex / DeepSeek Harness

## 目标

为工作台提供稳定的中控对话接口，把平台调用与页面、六类视频工作流解耦。

## 调用契约

```js
const result = await platform.sendMessage({
  messages: [{ role: "user", content: "请拆解这支视频任务" }],
  context: { typeKey: "commerce" },
  signal
});
```

视频创作通过统一的两阶段协议调用：

```js
const plan = await platform.planCreativeTask({
  instruction: "做一支 15 秒的清爽防晒霜种草视频",
  typeKey: "commerce",
  assets: [{ id: "asset_01", kind: "image" }],
  options: { ratio: "9:16" }
});

// 用户确认计划后再创建远端任务，避免误扣额度。
const task = await platform.createCreativeTask({
  intent: plan.intent,
  plan: plan.plan
});
```

返回值包含 `provider`、`operation`、`status`、`ok`；成功时包含 `text`、`plan`、`taskId` 和原始 `data`，未配置时返回 `status: "unconfigured"`，不会伪造成功结果。

任务创建后使用 `getTaskStatus({ taskId })` 查询状态，使用 `cancelTask({ taskId })` 取消远端任务。

## 配置原则

正式版应由本地桌面端或服务端代理注入 `window.EJIBAO_SECURE_CONFIG.platforms`，或由 `window.ejiabaoSecureConfig` 提供运行时配置。优先使用 `{ transport: "backend", path: "/v1/ai/deepseek" }` 通过产品后端代理；不要把长期 API 密钥写进页面源码或 localStorage。当前页面没有配置真实通道时，技能只负责校验和返回明确状态。

## 与业务层的边界

- Codex：负责规划、执行、校验的通用中控能力。
- DeepSeek Harness：负责脚本、分镜与调度编排。
- 创作编排器：负责把远端 taskId 映射到本地队列和作品库，不负责视频生成细节。
- 六大视频类型的具体工作流暂不在本技能中实现，待产品定义后由独立 workflow 模块调用本技能。
