# 正式接入清单

## 已确定的首发方案

- 部署位置：云服务器。
- 数据库：PostgreSQL + Prisma。
- 对象存储：阿里云 OSS，桌面端通过后端拿预签名 URL 直传，不经过 API 中转大文件。
- 登录：邮箱或手机号 + 密码；首发不接入短信、邮箱验证码、找回密码验证码。
- 额度：自有账户系统管理；首发只做额度扣除、失败释放和后台人工充值。
- 桌面形态：Windows U 盘即插即用；不要求产品域名。云端 API 仍建议使用固定 HTTPS 地址或 IP + HTTPS 证书。
- 社交平台发布：抖音、小红书、视频号、B 站 OAuth 与发布能力延后到 OTA。

## 密钥与权限边界

- OpenAI、Codex、DeepSeek Harness 的密钥只保存在云端服务端或密钥管理器，不写入 HTML、桌面端配置或 U 盘。
- DeepSeek 官方 API 使用 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 和云端 `DEEPSEEK_API_KEY`，桌面端只访问 `/v1/ai/deepseek`。
- Codex 默认使用你提供的 ZroCode OpenAI-compatible Responses 通道，模型为 `gpt-5.3-codex`，桌面端只访问 `/v1/ai/codex`；不使用 Codex CLI 或 App Server 作为公网服务。若改用官方 OpenAI API，只需将 `CODEX_BASE_URL` 改为 `https://api.openai.com/v1`。
- InferFlow 数字人口播工作流使用 `INFERFLOW_BASE_URL`、`INFERFLOW_API_KEY` 和 `INFERFLOW_ENABLED`，仅由后端调用；桌面端只提交人像图片、参考音频和口播文案。
- OSS 建议创建最小权限 RAM 用户，仅允许指定 Bucket 和前缀的 `PutObject`、`GetObject`、`HeadObject`。
- `JWT_SECRET`、`JWT_REFRESH_SECRET`、`PLATFORM_TOKEN_ENCRYPTION_KEY` 必须由随机数生成并分环境保存。
- 生产环境数据库不要暴露公网，只允许 API 容器或私网访问。

## 仍需你提供的真实协议

### Codex / DeepSeek Harness

请提供接口文档或一组脱敏示例：

- endpoint 与 HTTP 方法；
- 鉴权方式（Bearer、签名、网关 token 等）；
- 请求字段和最小可用示例；
- 同步返回与异步任务返回格式；
- 查询任务状态、取消任务、错误码和重试规则；
- 是否支持流式输出。

适配层已经按 `chat`、`video.plan`、`video.create`、`task.status`、`task.cancel` 预留，工作流实现不会和供应商协议耦合。

### NetShield_Protector / 加密优盘

目前只保留设备绑定接口，没有猜测授权协议。请提供：

- SDK、CLI 或可调用 DLL/EXE；
- 设备读取方式、设备 ID、挑战响应或签名字段；
- 授权文件格式、有效期和撤销机制；
- 是否支持离线校验，以及设备更换流程。

建议的最终边界是：NetShield 负责程序保护，Windows 原生桥接层读取优盘并完成挑战响应，云端使用 Ed25519 签发短期授权票据；账号授权和设备授权分开撤销。

## 额度规则

## 模型服务配置中心

打开云端地址 `/admin/provider-config`，使用 `ADMIN` 或 `SUPPORT` 账号登录。页面可以修改 DeepSeek Harness 与 Codex 的接口地址、模型、推理强度、API Key 和启停状态，并调用测试连接接口。

API Key 通过 `PLATFORM_TOKEN_ENCRYPTION_KEY` 使用 AES-256-GCM 加密后写入 PostgreSQL；列表接口只返回掩码，不返回明文。配置存入数据库后，新的中控请求立即读取最新配置，不需要重启服务。

生成流程采用“预留 → 成功扣除 / 失败释放”状态机。当前已提供：

微信支付 Native 扫码充值实现与商户材料清单见 `WECHAT-PAY-INTEGRATION.md`。支付成功回调只会通过服务端验签后写入 `CREDIT` 账本；不会相信桌面端传来的“支付成功”状态。

`POST /v1/admin/users/:userId/quota/credit`

该接口只允许 `ADMIN` 或 `SUPPORT` 角色调用，带幂等键，避免后台重复充值。真实视频生成 worker 接入后，再把远端任务回调映射到 `COMPLETED`、`FAILED`、`CANCELLED`。

## U 盘桌面端网络约束

桌面端从 `file://` 加载时，浏览器 Origin 常见为 `null`。服务端默认允许 `null,file://`，实际部署时仍应限制来源和接口权限。由于不使用域名，桌面端配置应由 Windows 壳层在启动时注入：

```js
window.EJIBAO_SECURE_CONFIG = {
  apiBaseUrl: "https://YOUR_CLOUD_SERVER_IP:8787",
  platforms: {
    codex: { transport: "backend", path: "/v1/ai/codex" },
    deepseekHarness: { transport: "backend", path: "/v1/ai/deepseek" }
  },
  device: { requiredForGeneration: true }
};
```

这段配置不应包含任何 OpenAI、Codex、DeepSeek 或 OSS 私钥。

## 现在可以验收的功能

- 注册/登录/刷新/退出；
- 查询当前用户和额度；
- 管理员充值并检查账本幂等；
- OSS 上传预签名 URL；
- OpenAI 计划接口（配置 API Key 后）；
- 任务额度预留、取消释放和完成扣除；
- 设备绑定接口的协议占位和明确失败提示。

没有真实供应商协议、OSS 凭据、云服务器环境和设备授权 SDK 前，不会宣称“已经接通”生成或授权能力。
