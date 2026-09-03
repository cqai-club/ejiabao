# e剪宝 生产部署清单

> 目标：把当前单体项目（Fastify 后端 + Vue/Vite 前端，前端由后端统一托管）部署到云服务器并提供 HTTPS 公网访问。改动量小，主要是配置与环境准备。

## 0. 架构概览

- 一个容器镜像（根 `Dockerfile`）：同时包含后端运行时代码和构建好的前端静态产物（`/app/frontend/dist`）。
- 一个 PostgreSQL 容器（`postgres:16`），通过 `docker-compose.prod.yml` 一起编排。
- 前端 API 请求指向同源后端：`/api` 等接口由 Fastify 处理，静态页面由后端直接托管。
- 生产使用 `FRONTEND_DIR=/app/frontend` 定位前端产物（本地开发不设置时回退到 `cwd/..`）。

## 1. 服务器准备

| 项目 | 要求 | 备注 |
|---|---|---|
| 操作系统 | Ubuntu 22.04/24.04 x64 | Debian 系均可 |
| 规格 | 至少 2C4G | 视频工作流需 FFmpeg/Python，视负载扩容 |
| Docker | 24+ 与 Compose v2 | `docker compose version` |
| 安全组 | 放行 80/443（HTTPS）与 8787（如不需要反代可只放 443） | 5000+ 仅内网 |
| 域名 | 1 个，解析 A 记录到服务器 IP | 推荐使用域名而非裸 IP |
| HTTPS | Let's Encrypt 或云厂商证书 | 必须，微信支付回调与桌面端都要求 HTTPS |

## 2. 环境变量与密钥

1. 复制模板：

   ```bash
   cd backend
   cp .env.production.example .env
   ```

2. 生成随机密钥（必填项）：

   ```bash
   # JWT_SECRET / JWT_REFRESH_SECRET（至少 32 字符）
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   # PLATFORM_TOKEN_ENCRYPTION_KEY（64 位十六进制，32 字节）
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # POSTGRES_PASSWORD
   openssl rand -base64 24
   ```

3. 逐项核对 `.env`（对照 `backend/.env.production.example` 的注释）：
   - `DATABASE_URL`：生产数据库连接串（不要用默认口令）
   - `API_PUBLIC_URL`：`https://你的域名`
   - `WEB_ORIGIN`：`null,file://`（桌面端）+ 你的 Web 后台域名
   - `JWT_SECRET` / `JWT_REFRESH_SECRET` 必填
   - OSS、AI 通道、微信支付按需填写

## 3. 对象存储（阿里云 OSS）

1. 创建 Bucket（私有读写或公开读均可，建议私有 + 预签名）。
2. 创建 RAM 子账号，权限最小化：仅该 Bucket 的 `PutObject/GetObject/HeadObject`。
3. 配置 CORS：允许来源 `null, file://, https://你的域名`，方法 `GET/HEAD/PUT/POST/OPTIONS`。
4. 将 `OSS_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/ACCESS_KEY_SECRET/OSS_PUBLIC_BASE_URL` 填入 `.env`。
5. `LOCAL_STORAGE_ENABLED=false`。

## 4. AI 通道

按需填写 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`CODEX_API_KEY` 与对应 Base URL / Model。密钥只存在于云端 `.env`，不会进入前端产物。

## 5. 微信支付（可选，上线收款时必做）

完整材料与验签流程见 `backend/WECHAT-PAY-INTEGRATION.md`。要点：

- 商户号 + API v3 密钥 + 商户证书序列号 + 私钥
- 平台证书/公钥序列号 + 平台公钥（可先申请）
- `WECHAT_PAY_NOTIFY_URL` 必须是公网 HTTPS
- `QUOTA_PACKAGES_JSON` 配置积分套餐（金额单位分）

## 6. 构建与启动

在仓库根目录：

```bash
# 1) 准备环境
cd backend && cp .env.production.example .env && vi .env   # 填好所有配置
cd ..

# 2) 构建完整镜像（前端 + 后端）
docker build -t ejiabao:latest .

# 3) 启动 Postgres + API
docker compose -f docker-compose.prod.yml up -d --build
```

说明：
- 容器启动会自动执行 `prisma migrate deploy`（建表/迁移），然后启动服务。
- 工作目录 `/app`，前端产物在 `/app/frontend/dist`，后端通过 `FRONTEND_DIR=/app/frontend` 定位。

## 7. HTTPS 与反向代理（推荐 Nginx + Certbot）

```
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # 证书：sudo certbot --nginx -d yourdomain.com
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;   # 视频生成接口可能耗时较长
    }
}
```

- `trustProxy: true` 已在后端启用，反代头可正常解析。
- 桌面端无需域名，但若用裸 IP + 自签证书，需在客户端信任证书。

## 8. 验证

```bash
# 健康检查
curl -fsS https://yourdomain.com/health/live

# 页面与静态资源
curl -fsS https://yourdomain.com/ | head -20
curl -fsS -o /dev/null -w "%{http_code}\n" https://yourdomain.com/lucide.min.js

# 日志
docker compose -f docker-compose.prod.yml logs -f api
```

## 9. 上线前检查清单

- [ ] `NODE_ENV=production`，`ADMIN_PREVIEW_MODE=false`，`ADMIN_DIRECT_ACCESS=false`
- [ ] `JWT_SECRET`、`JWT_REFRESH_SECRET` 已替换为随机值
- [ ] PostgreSQL 口令已替换，数据库未暴露公网
- [ ] OSS 密钥为最小权限子账号，CORS 已配置
- [ ] 前端产物已本地化（无 unpkg/CDN 外链），`dist/lucide.min.js` 存在
- [ ] HTTPS 证书有效，`API_PUBLIC_URL` 与回调 URL 一致
- [ ] 微信支付（如启用）回调验签通过
- [ ] 生产运行 `prisma migrate deploy` 成功
- [ ] 备份策略：Postgres 卷、`backend/runtime`、`/data/workflows` 定期备份

## 10. 常见问题

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 页面 404 / JSON 报错 | 前端未进镜像 | 用根 `Dockerfile` 重新构建，确认 `FRONTEND_DIR=/app/frontend` |
| 图标不显示 | 旧缓存引用 unpkg | 清缓存，重新 `npm run build`（本地 lucide） |
| 迁移失败 | DATABASE_URL 错/权限不足 | 检查 `.env` 与数据库用户授权 |
| 微信回调验签失败 | 平台证书/公钥过期 | 按 WECHAT-PAY-INTEGRATION.md 更新证书 |
| 视频生成超时 | 反代超时过短 | `proxy_read_timeout` 调大 |