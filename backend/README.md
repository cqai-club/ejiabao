# 云端后端

这是桌面端的真实服务端基础，不是本地演示层。

技术栈：Node.js 22、TypeScript、Fastify、PostgreSQL/Prisma、阿里云 OSS、OpenAI Responses API。

## 当前已接入

- 邮箱或手机号 + 密码注册/登录；不要求短信或邮箱验证码。
- Access Token + Refresh Token 会话管理。
- PostgreSQL 用户、项目、素材、任务、额度账本、设备授权和审计日志模型。
- 额度预留、成功扣除、失败/取消释放，以及管理员人工充值接口。
- 阿里云 OSS 直传预签名 URL。
- OpenAI 服务端计划接口；API Key 不进入桌面端。
- DeepSeek 官方 OpenAI-compatible Chat Completions 云端代理；API Key 不进入桌面端。
- Codex 默认使用你提供的 OpenAI-compatible Responses 中转通道（必须兼容 `POST /v1/responses`）；API Key 不进入桌面端。也可将 `CODEX_BASE_URL` 切回官方 OpenAI API。
- InferFlow 数字人工作流预留为后端专用通道；填写 `INFERFLOW_API_KEY` 后才允许启用知识口播执行器，密钥不进入桌面端。
- Codex / DeepSeek Harness 可在 `GET /admin/provider-config` 由配置员加密保存，并可在当页测试连接。
- 用户级模型配置：每个账户可选择自定义 Codex / DeepSeek Harness API，或回退到平台积分算力；用户 API Key 只以 AES-256-GCM 密文保存，客户端不会读取明文。
- 六大视频类型工作流只保留接口契约，暂不擅自实现具体步骤。

## 首次启动

```powershell
Copy-Item .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

## 初始化管理员

管理员不会随代码附带默认账号或密码。数据库迁移完成后，在服务器终端临时设置管理员邮箱、密码与确认标记，再执行一次初始化命令：

```powershell
$env:ADMIN_BOOTSTRAP_EMAIL="管理员邮箱"
$env:ADMIN_BOOTSTRAP_PASSWORD="管理员初始密码"
$env:ADMIN_BOOTSTRAP_CONFIRM="CREATE_OR_RESET_ADMIN"
npm run admin:bootstrap
```

同一邮箱再次执行会重置该账号密码、撤销其已有登录会话并提升为 `ADMIN`。命令完成后请关闭当前终端，或清除这三个临时环境变量。

## 云服务器部署

1. 在云服务器安装 Docker Compose。
2. 将 `.env.example` 复制为 `.env`，填写 PostgreSQL、OSS、OpenAI 和 JWT 密钥。
3. 设置强密码，尤其是 `POSTGRES_PASSWORD`、`JWT_SECRET`、`JWT_REFRESH_SECRET`。
4. 执行：

```powershell
docker compose -f docker-compose.cloud.yml up -d --build
```

商品推广工作流会随 API 镜像一并部署；镜像内已安装 Python 3 与 FFmpeg，运行过程数据放在独立 Docker 卷中，容器更新或重启不会丢失正在处理的工作目录。

部署并完成数据库迁移后，可在 API 容器内执行管理员初始化命令：

```powershell
docker compose -f docker-compose.cloud.yml exec -it api sh
```

进入容器后再输入以下内容；密码不会出现在宿主机命令历史中：

```sh
read -r -p "管理员邮箱: " ADMIN_BOOTSTRAP_EMAIL
printf "管理员密码: "; stty -echo; read -r ADMIN_BOOTSTRAP_PASSWORD; stty echo; printf "\n"
export ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_PASSWORD
export ADMIN_BOOTSTRAP_CONFIRM="CREATE_OR_RESET_ADMIN"
npm run admin:bootstrap:production
unset ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_PASSWORD ADMIN_BOOTSTRAP_CONFIRM
exit
```

U 盘桌面端不需要域名，但必须通过固定可访问的 HTTPS API 地址连接云服务器；将它写入桌面壳注入的 `window.EJIBAO_SECURE_CONFIG.apiBaseUrl`。生产环境建议在云服务器前放置 HTTPS 反向代理或云负载均衡。

## 主要 API

管理员配置页面：`GET /admin/provider-config`

- `GET /health/live`
- `GET /health/ready`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/me`
- `GET /v1/quota`
- `POST /v1/admin/users/:userId/quota/credit`
- `POST /v1/devices/bind`
- `POST /v1/uploads/presign`
- `POST /v1/ai/plan`
- `POST /v1/ai/deepseek`
- `POST /v1/ai/codex`
- `GET /v1/orchestration/workflows`
- `POST /v1/orchestration/plans`
- `POST /v1/orchestration/runs/:id/execute`
- `GET /v1/workflows/product-promo/status`
- `POST /v1/workflows/product-promo/tasks`
- `GET /v1/workflows/vlog-edit/status`
- `POST /v1/workflows/vlog-edit/tasks`
- `GET /v1/workflows/talking-head/status`
- `POST /v1/workflows/talking-head/tasks`
- `GET /v1/workflows/drama-short/status`
- `POST /v1/workflows/drama-short/tasks`
- `GET /v1/workflows/text-podcast/status`
- `POST /v1/workflows/text-podcast/tasks`
- `GET /v1/workflows/event-promo/status`
- `POST /v1/workflows/event-promo/tasks`
- `GET /v1/model-configs`
- `PUT /v1/model-configs/:provider`
- `POST /v1/model-configs/:provider/test`
- `GET /v1/admin/provider-configs`（管理员）
- `PUT /v1/admin/provider-configs/:provider`（管理员）
- `POST /v1/admin/provider-configs/:provider/test`（管理员）
- `POST /v1/tasks`
- `GET /v1/tasks/:id`
- `POST /v1/tasks/:id/retry`
- `DELETE /v1/tasks/:id`

## 明确暂缓

- 抖音、小红书、视频号、B 站 OAuth 与一键发布：后续 OTA。
- NetShield_Protector 的真实设备挑战/授权协议：需要 SDK、CLI 或授权文件格式后接入。
- 非数字人工作流依赖完整 FFmpeg。Remotion 自带的精简 ffmpeg 缺少 `color`、`overlay`、`drawtext`、`subtitles` 等滤镜，状态接口会明确返回 not ready，不能用于正式生成。
- 真实发布平台 worker：当前不会伪造发布成功状态；连接平台 OAuth 和上传协议后再开放。

微信支付 Native 扫码充值的部署材料和 API 见 [WECHAT-PAY-INTEGRATION.md](./WECHAT-PAY-INTEGRATION.md)。
