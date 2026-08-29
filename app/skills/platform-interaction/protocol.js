/**
 * 平台交互协议层。
 *
 * 这里定义的是 e剪宝自己的稳定协议，而不是某一家模型服务商的私有格式。
 * 服务端代理可以把该协议翻译成 Codex、DeepSeek Harness 或未来其他执行器的请求。
 */
export const PLATFORM_PROVIDERS = Object.freeze({
  CODEX: "codex",
  DEEPSEEK_HARNESS: "deepseek-harness"
});

export const PLATFORM_OPERATIONS = Object.freeze({
  CHAT: "chat",
  PLAN_VIDEO: "video.plan",
  CREATE_VIDEO: "video.create",
  TASK_STATUS: "task.status",
  TASK_CANCEL: "task.cancel"
});

export function normalizeCreativeIntent({ instruction, typeKey = "", assets = [], options = {}, output = {}, metadata = {} } = {}) {
  const text = String(instruction || "").trim();
  if (!text) throw new Error("创作指令不能为空。");
  return {
    instruction: text,
    typeKey: typeKey || null,
    assets: Array.isArray(assets) ? assets : [],
    options: options && typeof options === "object" ? options : {},
    output: output && typeof output === "object" ? output : {},
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };
}

export function buildPlatformRequest({ provider, operation, messages = [], intent = null, context = {}, taskId = "" } = {}) {
  return {
    protocol: "ejiabao.platform.v1",
    provider,
    operation,
    messages,
    intent,
    context,
    taskId: taskId || null,
    client: {
      product: "e剪宝",
      surface: "desktop-workbench"
    }
  };
}

export function normalizePlatformResult({ provider, operation, result, fallbackText = "" } = {}) {
  const data = result?.data ?? result;
  return {
    ok: result?.ok !== false,
    provider,
    operation,
    status: result?.status || "success",
    taskId: data?.task_id || data?.taskId || data?.id || result?.taskId || null,
    phase: data?.phase || data?.status || "completed",
    text: result?.text || data?.output_text || data?.text || fallbackText,
    plan: data?.plan || data?.storyboard || data?.steps || null,
    data
  };
}
