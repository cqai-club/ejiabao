-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CREATOR', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PLANNING', 'GENERATING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('CREDIT', 'RESERVE', 'RELEASE', 'DEBIT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'CLOSED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "nickname" TEXT NOT NULL DEFAULT '个人创作者',
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CREATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaAccount" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "QuotaLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "creditsReserved" INTEGER NOT NULL DEFAULT 0,
    "remoteTaskId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalUserId" TEXT,
    "accessTokenCiphertext" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "usbFingerprint" TEXT,
    "publicKey" TEXT,
    "licenseKeyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'wechat-native',
    "packageKey" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "quotaAmount" INTEGER NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "codeUrl" TEXT,
    "notifyId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningEffort" TEXT,
    "apiKeyCiphertext" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaLedger_idempotencyKey_key" ON "QuotaLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "QuotaLedger_userId_createdAt_idx" ON "QuotaLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_userId_updatedAt_idx" ON "Project"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationTask_userId_status_updatedAt_idx" ON "GenerationTask"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "GenerationTask_remoteTaskId_idx" ON "GenerationTask"("remoteTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConnection_userId_platform_key" ON "PlatformConnection"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_state_key" ON "OAuthState"("state");

-- CreateIndex
CREATE INDEX "OAuthState_userId_platform_expiresAt_idx" ON "OAuthState"("userId", "platform", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseBinding_licenseKeyId_key" ON "LicenseBinding"("licenseKeyId");

-- CreateIndex
CREATE INDEX "LicenseBinding_userId_status_idx" ON "LicenseBinding"("userId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_outTradeNo_key" ON "PaymentOrder"("outTradeNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_transactionId_key" ON "PaymentOrder"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_notifyId_key" ON "PaymentOrder"("notifyId");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_status_createdAt_idx" ON "PaymentOrder"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_outTradeNo_status_idx" ON "PaymentOrder"("outTradeNo", "status");

-- CreateIndex
CREATE INDEX "ProviderConfig_enabled_updatedAt_idx" ON "ProviderConfig"("enabled", "updatedAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaAccount" ADD CONSTRAINT "QuotaAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaLedger" ADD CONSTRAINT "QuotaLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaLedger" ADD CONSTRAINT "QuotaLedger_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformConnection" ADD CONSTRAINT "PlatformConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseBinding" ADD CONSTRAINT "LicenseBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
