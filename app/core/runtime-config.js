/**
 * 生产运行时配置。
 *
 * 配置由 Windows 桌面壳或服务端启动器注入，不写死在 HTML，也不把敏感字段放进 localStorage。
 * 约定：window.EJIBAO_SECURE_CONFIG 优先，其次是 window.EJIBAO_CONFIG。
 */
const DEFAULT_CONFIG = Object.freeze({
  mode: "production",
  apiBaseUrl: "",
  allowDemo: false,
  auth: { refreshPath: "/v1/auth/refresh", loginPath: "/v1/auth/login", registerPath: "/v1/auth/register" },
  platforms: {
    codex: { endpoint: "", endpoints: {}, transport: "backend", path: "/v1/ai/codex" },
    deepseekHarness: { endpoint: "", endpoints: {}, transport: "backend", path: "/v1/ai/deepseek" }
  },
  uploads: { maxImageBytes: 20 * 1024 * 1024, maxVideoBytes: 500 * 1024 * 1024 },
  device: { requiredForGeneration: true }
});

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object") return { ...base };
  const result = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(base[key] && typeof base[key] === "object" ? base[key] : {}, value)
      : value;
  });
  return result;
}

export function readRuntimeConfig() {
  const injected = window.EJIBAO_SECURE_CONFIG || window.ejiabaoSecureConfig || window.EJIBAO_CONFIG || {};
  const config = deepMerge(DEFAULT_CONFIG, injected);
  if (config.apiBaseUrl && config.platforms.deepseekHarness?.transport === "backend" && !config.platforms.deepseekHarness.path) {
    config.platforms.deepseekHarness.path = "/v1/ai/deepseek";
  }
  return config;
}

export function validateRuntimeConfig(config = readRuntimeConfig()) {
  const issues = [];
  if (!config.apiBaseUrl) issues.push({ code: "API_BASE_URL_MISSING", message: "缺少产品后端 API 地址。" });
  if (config.apiBaseUrl && config.platforms.codex?.transport === "backend") {
    // Codex 使用产品后端代理，不在桌面端暴露 OpenAI endpoint 或 API Key。
  } else if (!config.platforms.codex?.endpoint && !config.platforms.codex?.endpoints?.chat) {
    issues.push({ code: "CODEX_ENDPOINT_MISSING", message: "缺少 Codex 服务端代理地址。" });
  }
  if (config.apiBaseUrl && config.platforms.deepseekHarness?.transport === "backend") {
    // 后端代理模式不需要把 DeepSeek endpoint 暴露到桌面端。
  } else if (!config.platforms.deepseekHarness?.endpoint && !config.platforms.deepseekHarness?.endpoints?.chat) {
    issues.push({ code: "DEEPSEEK_ENDPOINT_MISSING", message: "缺少 DeepSeek Harness 服务端代理地址。" });
  }
  return { valid: issues.length === 0, issues };
}

export function getRuntimeStatus(config = readRuntimeConfig()) {
  const validation = validateRuntimeConfig(config);
  return {
    mode: config.mode,
    allowDemo: Boolean(config.allowDemo),
    apiConfigured: Boolean(config.apiBaseUrl),
    codexConfigured: Boolean((config.apiBaseUrl && config.platforms.codex?.transport === "backend") || config.platforms.codex?.endpoint || config.platforms.codex?.endpoints?.chat),
    deepseekConfigured: Boolean((config.apiBaseUrl && config.platforms.deepseekHarness?.transport === "backend") || config.platforms.deepseekHarness?.endpoint || config.platforms.deepseekHarness?.endpoints?.chat),
    valid: validation.valid,
    issues: validation.issues
  };
}
