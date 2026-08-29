# e剪宝业务运行层

## 目录约定

```text
app/
├─ core/                         # 与具体业务无关的基础设施
│  ├─ event-bus.js               # 模块间事件
│  ├─ storage.js                 # 命名空间存储
│  ├─ session-service.js         # 登录态生命周期
│  ├─ module-registry.js         # 模块启动/停止
│  └─ logger.js                  # 统一日志入口
├─ modules/                      # 产品业务模块
│  ├─ auth/                      # 邮箱/手机/微信认证契约
│  ├─ profile/                   # 用户资料、头像
│  ├─ library/                   # 作品索引、收藏、最近使用
│  ├─ queue/                     # 云端任务状态机、重试、取消
│  ├─ settings/                  # 设置持久化
│  ├─ media/                     # 素材格式/大小校验
│  ├─ publishing/                # 抖音、小红书、视频号等发布状态
│  └─ console/                   # 中控对话与创作编排
├─ skills/platform-interaction/ # Codex / DeepSeek Harness 平台适配层
└─ main.js                      # 运行时组装入口
```

## 页面侧调用

模块启动后会暴露：

```js
window.ejiabaoRuntime.modules.auth
window.ejiabaoRuntime.modules.library
window.ejiabaoRuntime.modules.queue
window.ejiabaoRuntime.modules.console
```

模块之间通过 `window.ejiabaoRuntime.eventBus` 发布和订阅状态变化，不直接依赖页面 DOM。

## 中控调用示例

```js
const consoleService = window.ejiabaoRuntime.modules.console;
consoleService.use("deepseek-harness");

const result = await consoleService.sendMessage({
  text: "请把这段创意拆成脚本和分镜",
  context: { typeKey: "story" }
});
```

视频创作推荐走两阶段流程：

```js
const orchestrator = window.ejiabaoRuntime.modules.creativeOrchestrator;
const plan = await orchestrator.plan({
  instruction: "把这段想法整理成一支 20 秒视频",
  typeKey: "story",
  context: { source: "dashboard-console" }
});

// 用户确认后调用 orchestrator.create({ intent: plan.intent, plan: plan.plan })。
// 只有远端创建成功，才会写入本地队列和作品库。
```

未配置真实服务端时，结果会是 `status: "unconfigured"`，不会伪造模型成功。真实通道应由桌面端安全注入配置。

## 六类视频工作流边界

前端已注册商品推广、知识口播、剧情短片、VLOG、文生播客、活动预告六类工作流的输入契约和后端调用入口。具体生成逻辑仍在后端工作流执行器中完成，浏览器端只提交素材 ID、脚本和参数，不保存模型密钥或执行本地 Python。
