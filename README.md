# e剪宝 AI 视频创作工作台

一个面向短视频创作的工作台原型：用户可以从文字、图片、视频或音频开始，通过 Codex / DeepSeek Harness 进行创作规划，再进入商品推广、知识口播、剧情短片、VLOG、文生播客和活动预告等工作流。

## 项目结构

- `index.html`：单页工作台 UI 与页面交互
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

4. 浏览器打开 `http://127.0.0.1:8787/`，或直接打开根目录的 `index.html` 做静态预览。

## 隐私与密钥

- 实际配置只放在 `backend/.env`，不会提交到 Git。
- 对外分享时只提交 `backend/.env.example`。
- API Key、JWT 密钥、OSS 密钥、微信支付私钥、设备授权私钥只能保存在服务端或本地安全环境中。
- `backend/runtime/`、日志、编译产物、上传文件和本地调试脚本均属于非源码文件，已加入 `.gitignore`。

## 当前边界

社交平台 OAuth、真实发布 worker、数字人 InferFlow 和部分云端模型能力需要额外的生产配置；工作流是否可执行，以后端运行时检查结果为准。
