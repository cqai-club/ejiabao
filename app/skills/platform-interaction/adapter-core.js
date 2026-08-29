import { requestJson, normalizeMessages } from "./request.js";
import { buildPlatformRequest, normalizePlatformResult, PLATFORM_OPERATIONS } from "./protocol.js";

/**
 * Provider 适配器公共实现。
 * 每个 provider 只需要声明自己的 endpoint 映射和请求头，业务层不感知差异。
 */
export function createOperationAdapter({ provider, label, capabilities, config = {}, parseText, requestClient = null }) {
  const endpoints = {
    chat: config.endpoint || config.endpoints?.chat || "",
    plan: config.endpoints?.plan || config.endpoint || "",
    create: config.endpoints?.create || config.endpoint || "",
    taskStatus: config.endpoints?.taskStatus || "",
    taskCancel: config.endpoints?.taskCancel || ""
  };
  const apiKey = config.apiKey || "";
  const fetchImpl = config.fetchImpl;

  async function call(operation, payload, { signal, endpoint = "", headers = {} } = {}) {
    const target = endpoint || endpoints[operationToEndpointKey(operation)] || "";
    if (config.transport === "backend" && requestClient) {
      const backendResult = await requestClient({
        path: config.path || `/v1/ai/${provider}`,
        payload,
        signal,
        headers
      });
      const data = backendResult?.data ?? backendResult;
      const result = { ok: true, provider, status: "success", data };
      return { ...result, text: parseText ? parseText(data) : "" };
    }
    const result = await requestJson({
      provider,
      endpoint: target,
      apiKey,
      payload,
      signal,
      headers,
      ...(fetchImpl ? { fetchImpl } : {})
    });
    if (!result.ok) return result;
    const text = parseText ? parseText(result.data) : "";
    return { ...result, text };
  }

  async function sendMessage({ messages = [], context = {}, signal } = {}) {
    const payload = buildPlatformRequest({
      provider,
      operation: PLATFORM_OPERATIONS.CHAT,
      messages: normalizeMessages(messages),
      context
    });
    return call("chat", payload, { signal });
  }

  async function planVideo({ intent, messages = [], context = {}, signal } = {}) {
    const payload = buildPlatformRequest({
      provider,
      operation: PLATFORM_OPERATIONS.PLAN_VIDEO,
      messages,
      intent,
      context
    });
    const result = await call("plan", payload, { signal });
    return result.ok === false ? result : normalizePlatformResult({ provider, operation: PLATFORM_OPERATIONS.PLAN_VIDEO, result });
  }

  async function createVideo({ intent, plan = null, messages = [], context = {}, signal } = {}) {
    const payload = buildPlatformRequest({
      provider,
      operation: PLATFORM_OPERATIONS.CREATE_VIDEO,
      messages,
      intent: { ...intent, plan },
      context
    });
    const result = await call("create", payload, { signal });
    return result.ok === false ? result : normalizePlatformResult({ provider, operation: PLATFORM_OPERATIONS.CREATE_VIDEO, result });
  }

  async function getTaskStatus({ taskId, signal } = {}) {
    if (!taskId) throw new Error("查询任务状态缺少 taskId。");
    const payload = buildPlatformRequest({ provider, operation: PLATFORM_OPERATIONS.TASK_STATUS, taskId });
    const result = await call("taskStatus", payload, { signal });
    return result.ok === false ? result : normalizePlatformResult({ provider, operation: PLATFORM_OPERATIONS.TASK_STATUS, result });
  }

  async function cancelTask({ taskId, signal } = {}) {
    if (!taskId) throw new Error("取消任务缺少 taskId。");
    const payload = buildPlatformRequest({ provider, operation: PLATFORM_OPERATIONS.TASK_CANCEL, taskId });
    const result = await call("taskCancel", payload, { signal });
    return result.ok === false ? result : normalizePlatformResult({ provider, operation: PLATFORM_OPERATIONS.TASK_CANCEL, result });
  }

  return {
    provider,
    label,
    capabilities: [...capabilities],
    isConfigured: Boolean((config.transport === "backend" && requestClient && (config.path || endpoints.chat)) || endpoints.chat || endpoints.plan || endpoints.create),
    endpoints: { ...endpoints },
    sendMessage,
    planVideo,
    createVideo,
    getTaskStatus,
    cancelTask
  };
}

function operationToEndpointKey(operation) {
  if (operation === "chat") return "chat";
  if (operation === "video.plan") return "plan";
  if (operation === "video.create") return "create";
  if (operation === "task.status") return "taskStatus";
  if (operation === "task.cancel") return "taskCancel";
  return "chat";
}
