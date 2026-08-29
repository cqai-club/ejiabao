const PROVIDER_DEFAULTS = Object.freeze([
  {
    provider: "codex",
    label: "Codex",
    accessMode: "PLATFORM",
    baseUrl: "",
    model: "",
    reasoningEffort: "medium",
    enabled: true,
    apiKeyConfigured: false,
    apiKeyMasked: "平台托管",
    source: "platform"
  },
  {
    provider: "deepseek-harness",
    label: "DeepSeek Harness",
    accessMode: "PLATFORM",
    baseUrl: "",
    model: "",
    reasoningEffort: null,
    enabled: true,
    apiKeyConfigured: false,
    apiKeyMasked: "平台托管",
    source: "platform"
  }
]);

/**
 * 用户级模型配置模块。
 * API Key 从不写入浏览器存储；仅通过已登录的 HTTPS 请求交给后端加密保存。
 */
export function createModelConfigService({ http, config, eventBus }) {
  function defaults() {
    return PROVIDER_DEFAULTS.map(item => ({ ...item }));
  }

  async function list() {
    if (!config.apiBaseUrl) return { available: false, configs: defaults() };
    const response = await http.get("/v1/model-configs");
    return { available: true, configs: response.data?.configs || defaults() };
  }

  async function save(provider, payload) {
    if (!config.apiBaseUrl) throw new Error("产品后端尚未连接，暂时不能安全保存 API 配置。");
    const response = await http.put(`/v1/model-configs/${encodeURIComponent(provider)}`, payload);
    eventBus.emit("model-config:updated", response.data?.config || { provider, ...payload });
    return response.data?.config;
  }

  async function test(provider) {
    if (!config.apiBaseUrl) throw new Error("产品后端尚未连接，暂时不能测试模型连接。");
    const response = await http.post(`/v1/model-configs/${encodeURIComponent(provider)}/test`, {});
    eventBus.emit("model-config:tested", { provider, result: response.data?.result });
    return response.data?.result;
  }

  return { list, save, test, defaults };
}
