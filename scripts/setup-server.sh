#!/usr/bin/env bash
# 服务器首次初始化：在部署目录生成 .env（从模板），并准备 compose 文件。
# 用法（在服务器上）：
#   bash scripts/setup-server.sh /path/to/deploy
set -euo pipefail

DEPLOY_DIR="${1:?用法: bash scripts/setup-server.sh /path/to/deploy}"
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

if [ -f .env ]; then
  echo "** .env 已存在，保留现有配置（不会覆盖）。如需重置，先删除再重跑。 **"
else
  cp "$(dirname "$0")/../backend/.env.production.example" .env
  echo "** 已从模板生成 .env，请立即编辑并填入： **"
  echo "   - DATABASE_URL / JWT_SECRET / JWT_REFRESH_SECRET"
  echo "   - OSS / AI 通道 / 微信支付等生产密钥"
  echo "   生成随机密钥: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
fi

# 确保 compose 文件在部署目录可被 CI 使用
if [ -f docker-compose.prod.yml ]; then
  echo "** docker-compose.prod.yml 已存在 **"
else
  cp "$(dirname "$0")/../docker-compose.prod.yml" .
  echo "** 已复制 docker-compose.prod.yml **"
fi

echo "完成。接下来："
echo "  1. 编辑 $DEPLOY_DIR/.env 填好所有密钥"
echo "  2. 在 GitHub 仓库 Settings > Secrets and variables > Actions 配置："
echo "     DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY / DEPLOY_DIR"
echo "  3. 推送 main 分支触发自动部署，或手动运行 Deploy workflow"