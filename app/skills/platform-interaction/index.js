import { createCodexAdapter } from "./codex-adapter.js";
import { createDeepSeekHarnessAdapter } from "./deepseek-harness-adapter.js";
import { normalizeCreativeIntent } from "./protocol.js";

const CONFIG_STORAGE_KEY = "ejiabao-platform-config";

function readConfig() {
  const secureConfig = window.EJIBAO_SECURE_CONFIG?.platforms || window.ejiabaoSecureConfig?.platforms;
  if (secureConfig) return secureConfig;
  const runtimeConfig = window.EJIBAO_CONFIG?.platforms;
  if (runtimeConfig) return runtimeConfig;
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONFIG_STORAGE_KEY) || "{}") || {};
    // 本地存储只允许保存端点等非敏感配置，长期密钥必须由桌面端安全注入。
    return {
      codex: { endpoint: stored.codex?.endpoint, endpoints: stored.codex?.endpoints },
      deepseekHarness: { endpoint: stored.deepseekHarness?.endpoint, endpoints: stored.deepseekHarness?.endpoints }
    };
  } catch {
    return {};
  }
}

/**
 * 创建平台交互技能。
 * 业务模块只调用 sendMessage，不关心 Codex/DeepSeek Harness 的请求格式。
 */
export function createPlatformInteractionSkill(options = {}) {
  // 兼容早期 createPlatformInteractionSkill({ codex, deepseekHarness }) 调用方式。
  const isDirectConfig = Boolean(options.codex || options.deepseekHarness || options.deepseek);
  const config = isDirectConfig ? options : (options.config || readConfig());
  const eventBus = isDirectConfig ? null : (options.eventBus || null);
  const logger = isDirectConfig ? console : (options.logger || console);
  const http = isDirectConfig ? null : (options.http || null);
  const platformConfig = config.platforms || config;
  const requestClient = http && config.apiBaseUrl
    ? ({ path, payload, signal, headers }) => http.post(path, payload, { signal, headers })
    : null;
  const adapters = {
    codex: createCodexAdapter(platformConfig.codex || {}, requestClient),
    "deepseek-harness": createDeepSeekHarnessAdapter(platformConfig.deepseekHarness || platformConfig.deepseek || {}, requestClient)
  };
  let activeProvider = "codex";

  function use(provider) {
    if (!adapters[provider]) throw new Error(`不支持的平台：${provider}`);
    activeProvider = provider;
    eventBus?.emit("platform:provider-changed", getStatus(provider));
    return adapters[provider];
  }

  function current() {
    return adapters[activeProvider];
  }

  async function sendMessage(request = {}) {
    const provider = current().provider;
    eventBus?.emit("platform:request-start", { provider, operation: "chat" });
    try {
      const result = await current().sendMessage(request);
      eventBus?.emit("platform:request-complete", { provider, operation: "chat", result });
      return result;
    } catch (error) {
      logger.error?.("平台聊天请求失败", error);
      eventBus?.emit("platform:request-error", { provider, operation: "chat", error });
      throw error;
    }
  }

  async function planCreativeTask({ instruction, typeKey, assets, options, output, metadata, messages, context, signal } = {}) {
    const provider = current().provider;
    const intent = normalizeCreativeIntent({ instruction, typeKey, assets, options, output, metadata });
    eventBus?.emit("platform:request-start", { provider, operation: "video.plan", intent });
    try {
      const result = await current().planVideo({ intent, messages, context, signal });
      eventBus?.emit("platform:request-complete", { provider, operation: "video.plan", result, intent });
      return { ...result, intent };
    } catch (error) {
      logger.error?.("视频任务规划失败", error);
      eventBus?.emit("platform:request-error", { provider, operation: "video.plan", error, intent });
      throw error;
    }
  }

  async function createCreativeTask({ intent, plan = null, messages, context, signal } = {}) {
    if (!intent) throw new Error("创建视频任务缺少创作意图。");
    const provider = current().provider;
    eventBus?.emit("platform:request-start", { provider, operation: "video.create", intent });
    try {
      const result = await current().createVideo({ intent, plan, messages, context, signal });
      eventBus?.emit("platform:request-complete", { provider, operation: "video.create", result, intent });
      return { ...result, intent };
    } catch (error) {
      logger.error?.("视频任务创建失败", error);
      eventBus?.emit("platform:request-error", { provider, operation: "video.create", error, intent });
      throw error;
    }
  }

  async function orchestrateCreativeTask({ autoCreate = false, ...request } = {}) {
    const planned = await planCreativeTask(request);
    if (!autoCreate || planned.ok === false || planned.status === "unconfigured") return planned;
    return createCreativeTask({
      ...request,
      intent: planned.intent,
      plan: planned.plan,
      messages: request.messages,
      context: request.context,
      signal: request.signal
    });
  }

  async function getTaskStatus({ taskId, signal } = {}) {
    return current().getTaskStatus({ taskId, signal });
  }

  async function cancelTask({ taskId, signal } = {}) {
    return current().cancelTask({ taskId, signal });
  }

  function supports(capability, provider = activeProvider) {
    return Boolean(adapters[provider]?.capabilities.includes(capability));
  }

  function getStatus(provider = activeProvider) {
    const adapter = adapters[provider];
    return {
      provider,
      label: adapter.label,
      configured: adapter.isConfigured,
      capabilities: [...adapter.capabilities]
    };
  }

  return {
    use,
    current,
    sendMessage,
    planCreativeTask,
    createCreativeTask,
    orchestrateCreativeTask,
    getTaskStatus,
    cancelTask,
    supports,
    getStatus,
    adapters: { ...adapters }
  };
}
