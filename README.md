# e剪宝 AI 视频创作工作台

一个面向短视频创作的工作台原型：用户可以从文字、图片、视频或音频开始，通过 Codex / DeepSeek Harness 进行创作规划，再进入商品推广、知识口播、剧情短片、VLOG、文生播客和活动预告等工作流。

## 项目结构

- `index.html`：legacy workspace 页面与兼容桥；Vue 壳层与已迁移页面位于 `src/`
- `app/`：浏览器端业务运行层（认证、素材、队列、作品库、中控和工作流契约）
- `backend/`：Fastify + TypeScript API 服务
- `backend/prisma/`：PostgreSQL / Prisma 数据模型与迁移
- `backend/workflows/`：Python + FFmpeg 视频工作流
- `assets/`：Logo 和示例素材

## 本地运行

1. 准备 Node.js 22、PostgreSQL，以及工作流所需的 Python / FFmpeg。
2. 复制配置模板并填写本地配置：

   ```bash
   cp backend/.env.example backend/.env
   ```

3. 安装后端依赖并初始化数据库：

   ```bash
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate dev
   npm run dev
   ```

4. 后端启动后，浏览器打开 `http://127.0.0.1:8787/`。后端会优先提供根目录 `dist/` 中的 Vite 生产产物，并在产物不存在时回退到源码入口；不要直接用 `file://` 打开 `index.html`，否则模块加载、路由和 API 请求的运行环境会与实际应用不同。

### Vite 开发调试

如果需要在页面上快速定位源码，先保持后端运行，再在项目根目录执行：

```bash
npm install
npm run dev
```

然后打开 `http://127.0.0.1:5173/`（若端口已被占用，Vite 会自动选择下一个可用端口，并在终端输出实际地址）。开发页面按住 Windows `Alt+Shift` 并移动鼠标即可查看元素源码提示，点击后会尝试打开本机编辑器并定位到对应文件和行号。该能力只在 Vite 开发服务中启用，不影响 `backend` 的生产启动方式。

### Vite 生产预览

构建并预览当前前端产物：

```bash
npm run build
npm run preview
```

默认地址为 `http://127.0.0.1:4173/`；如果端口被占用，请使用终端输出的实际端口。

### Docker 生产部署

仓库根目录的 `Dockerfile` 会分阶段构建前端静态产物与后端服务，并把构建好的 `dist/` 放进运行镜像，由后端统一托管（无需单独部署静态站点）：

```bash
# 在仓库根目录构建
docker build -t ejiabao:latest .

# 用 backend/docker-compose.cloud.yml 启动（Postgres + API）
cd backend
docker compose -f docker-compose.cloud.yml up -d --build
```

镜像内后端通过环境变量 `FRONTEND_DIR=/app/frontend` 定位前端产物；本地开发不设置该变量时，自动回退到“后端进程工作目录的上级目录”下的 `dist/`。前端图标等静态资源已本地化构建，生产环境不依赖外网 CDN。

### GitHub Actions 自动部署

仓库内置 `.github/workflows/deploy.yml`：push 到 `main` 后自动构建镜像 → 推送到 GHCR → SSH 到服务器拉取并重启 `api` 容器。

**前置条件（首次）**

1. 在服务器执行初始化脚本，生成 `.env` 并准备部署目录：

   ```bash
   bash scripts/setup-server.sh /opt/ejiabao
   # 然后编辑 /opt/ejiabao/.env 填好所有生产密钥
   ```

2. 在 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置以下 Secrets：

   | Secret | 说明 |
   |---|---|
   | `DEPLOY_HOST` | 服务器 IP 或域名 |
   | `DEPLOY_USER` | SSH 用户名 |
   | `DEPLOY_SSH_KEY` | SSH 私钥（服务器公钥需加入 `authorized_keys`） |
   | `DEPLOY_PORT` | SSH 端口，默认 22 |
   | `DEPLOY_DIR` | 服务器部署目录（与初始化脚本一致，如 `/opt/ejiabao`） |

3. 服务器需已安装 Docker 与 Compose v2，且该用户有 Docker 权限。

**触发方式**

- push 到 `main` 自动部署；
- 也可以在 GitHub Actions 页面手动运行 `Deploy`，并指定要部署的镜像 tag（默认使用最新提交 SHA）。

镜像 tag 为提交 SHA 前 12 位；同一提交再次触发会重新拉取该 tag。回滚时手动运行 workflow 并填写上一个成功的 SHA 即可。

**密钥安全**

- 所有生产密钥只存放在服务器 `.env`，CI 通过 `DEPLOY_DIR` 读取，不会写入 GitHub Secrets 或日志。
- GitHub Secrets 只存放连接服务器所需的 `DEPLOY_*` 信息。
## 隐私与密钥

- 实际配置只放在 `backend/.env`，不会提交到 Git。
- 对外分享时只提交 `backend/.env.example`。
- API Key、JWT 密钥、OSS 密钥、微信支付私钥、设备授权私钥只能保存在服务端或本地安全环境中。
- `backend/runtime/`、日志、编译产物、上传文件和本地调试脚本均属于非源码文件，已加入 `.gitignore`。

## 当前边界

社交平台 OAuth、真实发布 worker、数字人 InferFlow 和部分云端模型能力需要额外的生产配置；工作流是否可执行，以后端运行时检查结果为准。
