-- 用户可选的自定义模型 API 配置。密钥字段只保存后端加密密文。
CREATE TABLE "UserProviderConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessMode" TEXT NOT NULL DEFAULT 'PLATFORM',
    "baseUrl" TEXT,
    "model" TEXT,
    "reasoningEffort" TEXT,
    "apiKeyCiphertext" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProviderConfig_userId_provider_key" ON "UserProviderConfig"("userId", "provider");
CREATE INDEX "UserProviderConfig_userId_updatedAt_idx" ON "UserProviderConfig"("userId", "updatedAt");

ALTER TABLE "UserProviderConfig"
  ADD CONSTRAINT "UserProviderConfig_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
