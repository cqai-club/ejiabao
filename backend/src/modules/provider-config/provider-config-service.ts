import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/secret-crypto.js";

export type ProviderName = "codex" | "deepseek-harness" | "inferflow";
export type ModelProviderName = Exclude<ProviderName, "inferflow">;
export type UserProviderName = ProviderName;
export type RuntimeProviderConfig = {
  provider: ProviderName;
  baseUrl: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  apiKey: string;
  enabled: boolean;
};

const ADMIN_PROVIDERS: ProviderName[] = ["codex", "deepseek-harness", "inferflow"];
const MODEL_PROVIDERS: ModelProviderName[] = ["codex", "deepseek-harness"];
const USER_PROVIDERS: UserProviderName[] = ["codex", "deepseek-harness", "inferflow"];
type AccessMode = "PLATFORM" | "CUSTOM";
type UserProviderInput = {
  accessMode: AccessMode;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: string;
  enabled?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
};

/** 管理模型服务配置，数据库优先，环境变量作为首次启动兜底。 */
export function createProviderConfigService({ config, db = prisma }: { config: AppConfig; db?: typeof prisma }) {
  function defaults(provider: ProviderName): RuntimeProviderConfig {
    if (provider === "codex") {
      return {
        provider,
        baseUrl: config.CODEX_BASE_URL,
        model: config.CODEX_MODEL,
        reasoningEffort: config.CODEX_REASONING_EFFORT,
        apiKey: config.CODEX_API_KEY || config.OPENAI_API_KEY,
        enabled: true
      };
    }
    if (provider === "deepseek-harness") {
      return {
        provider,
        baseUrl: config.DEEPSEEK_BASE_URL,
        model: config.DEEPSEEK_MODEL,
        apiKey: config.DEEPSEEK_API_KEY,
        enabled: true
      };
    }
    return {
      provider,
      baseUrl: config.INFERFLOW_BASE_URL,
      model: "digital_human_standard",
      apiKey: config.INFERFLOW_API_KEY,
      enabled: config.INFERFLOW_ENABLED
    };
  }

  function assertProvider(value: string): void {
    if (!ADMIN_PROVIDERS.includes(value as ProviderName)) throw new AppError("不支持的模型服务。", "PROVIDER_INVALID", 400);
  }

  function assertModelProvider(value: string): asserts value is ModelProviderName {
    if (!MODEL_PROVIDERS.includes(value as ModelProviderName)) throw new AppError("不支持的模型服务。", "PROVIDER_INVALID", 400);
  }

  function assertUserProvider(value: string): asserts value is UserProviderName {
    if (!USER_PROVIDERS.includes(value as UserProviderName)) throw new AppError("不支持的模型服务。", "PROVIDER_INVALID", 400);
  }

  async function getRuntime(provider: ProviderName): Promise<RuntimeProviderConfig> {
    const fallback = defaults(provider);
    const row = await db.providerConfig.findUnique({ where: { provider } });
    if (!row) return fallback;
    return {
      provider,
      baseUrl: row.baseUrl || fallback.baseUrl,
      model: row.model || fallback.model,
      reasoningEffort: normalizeReasoning(row.reasoningEffort || undefined) || fallback.reasoningEffort,
      apiKey: row.apiKeyCiphertext ? decryptSecret(row.apiKeyCiphertext, config.tokenEncryptionKey) : fallback.apiKey,
      enabled: row.enabled
    };
  }

  /**
   * 解析真正执行时应使用的模型配置。
   * 用户没有选择自定义 API 时，统一回退到平台配置，避免把平台密钥暴露到桌面端。
   */
  async function getRuntimeForUser(userId: string, provider: UserProviderName): Promise<RuntimeProviderConfig> {
    const platformRuntime = await getRuntime(provider);
    const row = await db.userProviderConfig.findUnique({ where: { userId_provider: { userId, provider } } });
    if (!row || row.accessMode !== "CUSTOM") return platformRuntime;
    const apiKey = row.apiKeyCiphertext ? decryptSecret(row.apiKeyCiphertext, config.tokenEncryptionKey) : "";
    if (!row.baseUrl || !row.model || !apiKey) {
      throw new AppError("自定义模型配置不完整，请补充接口地址、模型名称和 API Key。", "USER_PROVIDER_CONFIG_INCOMPLETE", 422, { provider });
    }
    return {
      provider,
      baseUrl: row.baseUrl,
      model: row.model,
      reasoningEffort: normalizeReasoning(row.reasoningEffort || undefined) || platformRuntime.reasoningEffort,
      apiKey,
      enabled: row.enabled
    };
  }

  async function list() {
    const rows = await db.providerConfig.findMany({ orderBy: { provider: "asc" } });
    return ADMIN_PROVIDERS.map(provider => {
      const fallback = defaults(provider);
      const row = rows.find(item => item.provider === provider);
      return {
        provider,
        baseUrl: row?.baseUrl || fallback.baseUrl,
        model: row?.model || fallback.model,
        reasoningEffort: normalizeReasoning(row?.reasoningEffort || undefined) || fallback.reasoningEffort || null,
        enabled: row?.enabled ?? fallback.enabled,
        apiKeyConfigured: Boolean(row?.apiKeyCiphertext || fallback.apiKey),
        apiKeyMasked: maskSecret(row?.apiKeyCiphertext ? "configured" : fallback.apiKey),
        source: row ? "database" : (fallback.apiKey || fallback.baseUrl ? "environment" : "unconfigured"),
        updatedAt: row?.updatedAt || null
      };
    });
  }

  async function update(providerValue: string, input: { baseUrl: string; model: string; reasoningEffort?: string; enabled: boolean; apiKey?: string; clearApiKey?: boolean }, updatedBy: string) {
    assertProvider(providerValue);
    const provider = providerValue as ProviderName;
    const current = await db.providerConfig.findUnique({ where: { provider } });
    const fallback = defaults(provider);
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const model = input.model.trim();
    if (!baseUrl || !model) throw new AppError("接口地址和模型不能为空。", "PROVIDER_CONFIG_INVALID", 400);
    const reasoningEffort = normalizeReasoning(input.reasoningEffort) || undefined;
    let apiKeyCiphertext = current?.apiKeyCiphertext || null;
    if (input.clearApiKey) apiKeyCiphertext = null;
    if (input.apiKey?.trim()) apiKeyCiphertext = encryptSecret(input.apiKey.trim(), config.tokenEncryptionKey);
    if (!apiKeyCiphertext && !fallback.apiKey && !input.clearApiKey) {
      throw new AppError("请填写 API Key，或保留已有密钥。", "PROVIDER_API_KEY_MISSING", 400);
    }
    const row = await db.providerConfig.upsert({
      where: { provider },
      create: { provider, baseUrl, model, reasoningEffort, apiKeyCiphertext, enabled: input.enabled, updatedBy },
      update: { baseUrl, model, reasoningEffort, apiKeyCiphertext, enabled: input.enabled, updatedBy }
    });
    return {
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      enabled: row.enabled,
      apiKeyConfigured: Boolean(row.apiKeyCiphertext),
      apiKeyMasked: maskSecret(row.apiKeyCiphertext ? "configured" : "")
    };
  }

  async function listForUser(userId: string) {
    const rows = await db.userProviderConfig.findMany({ where: { userId }, orderBy: { provider: "asc" } });
    return Promise.all(USER_PROVIDERS.map(async provider => {
      const platform = await getRuntime(provider);
      const row = rows.find(item => item.provider === provider);
      const custom = row?.accessMode === "CUSTOM";
      return {
        provider,
        accessMode: custom ? "CUSTOM" : "PLATFORM",
        baseUrl: custom ? (row?.baseUrl || "") : platform.baseUrl,
        model: custom ? (row?.model || "") : platform.model,
        reasoningEffort: custom ? (normalizeReasoning(row?.reasoningEffort || undefined) || null) : (platform.reasoningEffort || null),
        enabled: custom ? (row?.enabled ?? true) : platform.enabled,
        apiKeyConfigured: custom ? Boolean(row?.apiKeyCiphertext) : Boolean(platform.apiKey),
        apiKeyMasked: custom ? maskSecret(row?.apiKeyCiphertext ? "configured" : "") : "平台托管，不向客户端展示",
        source: custom ? "custom" : "platform",
        updatedAt: row?.updatedAt || null
      };
    }));
  }

  async function updateForUser(userId: string, providerValue: string, input: UserProviderInput) {
    assertUserProvider(providerValue);
    const provider = providerValue as UserProviderName;
    if (input.accessMode === "PLATFORM") {
      await db.userProviderConfig.deleteMany({ where: { userId, provider } });
      return (await listForUser(userId)).find(item => item.provider === provider)!;
    }

    const current = await db.userProviderConfig.findUnique({ where: { userId_provider: { userId, provider } } });
    const baseUrl = normalizeBaseUrl(input.baseUrl || "");
    const model = String(input.model || "").trim();
    if (!baseUrl || !model) throw new AppError("接口地址和模型名称不能为空。", "USER_PROVIDER_CONFIG_INVALID", 400);
    const reasoningEffort = normalizeReasoning(input.reasoningEffort) || undefined;
    let apiKeyCiphertext = current?.apiKeyCiphertext || null;
    if (input.clearApiKey) apiKeyCiphertext = null;
    if (input.apiKey?.trim()) apiKeyCiphertext = encryptSecret(input.apiKey.trim(), config.tokenEncryptionKey);
    if (!apiKeyCiphertext) throw new AppError("请填写 API Key，或保留已保存的密钥。", "USER_PROVIDER_API_KEY_MISSING", 400);

    const row = await db.userProviderConfig.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, accessMode: "CUSTOM", baseUrl, model, reasoningEffort, apiKeyCiphertext, enabled: input.enabled ?? true },
      update: { accessMode: "CUSTOM", baseUrl, model, reasoningEffort, apiKeyCiphertext, enabled: input.enabled ?? true }
    });
    return {
      provider: row.provider,
      accessMode: "CUSTOM" as const,
      baseUrl: row.baseUrl,
      model: row.model,
      reasoningEffort: normalizeReasoning(row.reasoningEffort || undefined) || null,
      enabled: row.enabled,
      apiKeyConfigured: Boolean(row.apiKeyCiphertext),
      apiKeyMasked: maskSecret(row.apiKeyCiphertext ? "configured" : ""),
      source: "custom",
      updatedAt: row.updatedAt
    };
  }

  return { list, getRuntime, getRuntimeForUser, update, listForUser, updateForUser, assertProvider, assertModelProvider, assertUserProvider };
}

function normalizeBaseUrl(value: string) {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return trimmed;
  } catch {
    return "";
  }
}

function normalizeReasoning(value?: string) {
  return ["low", "medium", "high", "xhigh"].includes(String(value)) ? String(value) as RuntimeProviderConfig["reasoningEffort"] : undefined;
}

function maskSecret(value: string) {
  if (!value) return "未配置";
  if (value === "configured") return "••••••••已配置";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
