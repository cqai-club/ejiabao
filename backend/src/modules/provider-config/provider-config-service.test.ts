import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadConfig } from "../../config.js";
import { closeDatabase } from "../../db.js";
import { encryptSecret } from "../../lib/secret-crypto.js";
import { createProviderConfigService } from "./provider-config-service.js";

after(async () => {
  await closeDatabase();
});

test("listForUser exposes InferFlow alongside model providers", async () => {
  const config = createTestConfig();
  const service = createProviderConfigService({ config, db: createMockDb() });

  const configs = await service.listForUser("user-1");

  assert.deepEqual(configs.map(configItem => configItem.provider), ["codex", "deepseek-harness", "inferflow"]);
  const inferflow = configs.find(configItem => configItem.provider === "inferflow");
  assert.ok(inferflow);
  assert.equal(inferflow.accessMode, "PLATFORM");
  assert.equal(inferflow.baseUrl, "https://saas.inferflow.dev/openapi/v1");
  assert.equal(inferflow.model, "digital_human_standard");
  assert.equal(inferflow.apiKeyConfigured, true);
});

test("getRuntimeForUser uses the current account's custom InferFlow API", async () => {
  const config = createTestConfig();
  const apiKeyCiphertext = encryptSecret("tenant-inferflow-key", config.tokenEncryptionKey);
  const service = createProviderConfigService({
    config,
    db: createMockDb({
      userProviderRows: [
        {
          id: "custom-inferflow",
          userId: "user-1",
          provider: "inferflow",
          accessMode: "CUSTOM",
          baseUrl: "https://tenant.example/openapi/v1",
          model: "digital_human_plus",
          reasoningEffort: null,
          apiKeyCiphertext,
          enabled: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        }
      ]
    })
  });

  const runtime = await service.getRuntimeForUser("user-1", "inferflow");

  assert.equal(runtime.provider, "inferflow");
  assert.equal(runtime.baseUrl, "https://tenant.example/openapi/v1");
  assert.equal(runtime.model, "digital_human_plus");
  assert.equal(runtime.apiKey, "tenant-inferflow-key");
  assert.equal(runtime.enabled, true);
});

function createTestConfig() {
  return loadConfig({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8787",
    DATABASE_URL: "postgresql://ejiabao:ejiabao@localhost:5432/ejiabao?schema=public",
    JWT_SECRET: "x".repeat(32),
    JWT_REFRESH_SECRET: "y".repeat(32),
    API_PUBLIC_URL: "http://127.0.0.1:8787",
    WEB_ORIGIN: "http://127.0.0.1:5173",
    OSS_ENDPOINT: "https://oss.example.com",
    OSS_REGION: "local",
    OSS_BUCKET: "ejiabao-test",
    OSS_ACCESS_KEY_ID: "oss-key",
    OSS_ACCESS_KEY_SECRET: "oss-secret",
    LOCAL_STORAGE_ENABLED: "true",
    PLATFORM_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    OPENAI_API_KEY: "platform-openai-key",
    CODEX_API_KEY: "platform-codex-key",
    DEEPSEEK_API_KEY: "platform-deepseek-key",
    INFERFLOW_ENABLED: "true",
    INFERFLOW_API_KEY: "platform-inferflow-key"
  });
}

function createMockDb({ providerRows = [], userProviderRows = [] }: { providerRows?: any[]; userProviderRows?: any[] } = {}) {
  return {
    providerConfig: {
      findUnique: async ({ where }: any) => providerRows.find(row => row.provider === where.provider) || null,
      findMany: async () => providerRows,
      upsert: async ({ where, create, update }: any) => ({
        id: `${where.provider}-row`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...create,
        ...update
      })
    },
    userProviderConfig: {
      findUnique: async ({ where }: any) => userProviderRows.find(row => (
        row.userId === where.userId_provider.userId && row.provider === where.userId_provider.provider
      )) || null,
      findMany: async ({ where }: any) => userProviderRows.filter(row => row.userId === where.userId),
      deleteMany: async () => ({ count: 0 }),
      upsert: async ({ create, update }: any) => ({
        id: "user-provider-row",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...create,
        ...update
      })
    }
  } as any;
}
