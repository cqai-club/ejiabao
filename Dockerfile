# 生产镜像（自包含）：构建 Vite/Vue 前端 + Fastify 后端，并放入 dist/。
# 在仓库根执行： docker build -t ejiabao:latest .
FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js tsconfig.json components.json ./
COPY assets ./assets
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS backend-build

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/prisma ./prisma
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
# Prisma CLI is required at container startup for `prisma migrate deploy`.
RUN npm ci
COPY backend/prisma ./prisma
# Regenerate the Prisma Client in the runtime image so binaries match.
RUN npx prisma generate
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/dist ./frontend/dist
COPY backend/workflows ./workflows
ENV FRONTEND_DIR=/app/frontend
EXPOSE 8787
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]