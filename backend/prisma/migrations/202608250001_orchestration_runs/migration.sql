CREATE TYPE "OrchestrationStatus" AS ENUM (
  'PLANNED',
  'BLOCKED',
  'DISPATCHING',
  'DISPATCHED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TABLE "OrchestrationRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'deepseek-harness',
  "instruction" TEXT NOT NULL,
  "typeKey" TEXT,
  "workflowKey" TEXT NOT NULL,
  "status" "OrchestrationStatus" NOT NULL DEFAULT 'PLANNED',
  "plan" JSONB NOT NULL,
  "workflowInput" JSONB NOT NULL DEFAULT '{}',
  "quote" JSONB NOT NULL DEFAULT '{}',
  "blockers" JSONB NOT NULL DEFAULT '[]',
  "taskId" TEXT,
  "model" TEXT,
  "responseId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "dispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrchestrationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrchestrationRun_taskId_key" ON "OrchestrationRun"("taskId");
CREATE INDEX "OrchestrationRun_userId_status_updatedAt_idx" ON "OrchestrationRun"("userId", "status", "updatedAt");

ALTER TABLE "OrchestrationRun"
  ADD CONSTRAINT "OrchestrationRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrchestrationRun"
  ADD CONSTRAINT "OrchestrationRun_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "GenerationTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
