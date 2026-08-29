import OpenAI from "openai";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import type { RuntimeProviderConfig } from "../provider-config/provider-config-service.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * DeepSeek OpenAI-compatible Chat Completions adapter.
 *
 * The platform uses DeepSeek's supported /chat/completions interface here.
 * This keeps its protocol isolated from the Responses-based Codex adapter.
 */
export function createDeepSeekService({ config, getSettings }: { config: AppConfig; getSettings?: () => Promise<RuntimeProviderConfig> }) {
  async function settings(): Promise<RuntimeProviderConfig> {
    return getSettings ? getSettings() : {
      provider: "deepseek-harness",
      baseUrl: config.DEEPSEEK_BASE_URL,
      model: config.DEEPSEEK_MODEL,
      apiKey: config.DEEPSEEK_API_KEY,
      enabled: true
    };
  }

  async function chat({ messages, context = {}, runtime: runtimeOverride }: { messages: ChatMessage[]; context?: Record<string, unknown>; runtime?: RuntimeProviderConfig }) {
    const runtime = runtimeOverride || await settings();
    assertUsable(runtime);
    const normalized = normalizeMessages(messages);
    if (!normalized.length) throw new AppError("中控消息不能为空。", "CREATIVE_INSTRUCTION_EMPTY", 400);
    try {
      const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
      const response = await client.chat.completions.create({
        model: runtime.model,
        messages: appendContext(normalized, context)
      });
      return { provider: "deepseek-harness", model: runtime.model, responseId: response.id, text: completionText(response), usage: response.usage || null, raw: response };
    } catch (error: any) {
      throw mapDeepSeekError(error);
    }
  }

  async function planCreativeTask({ instruction, typeKey, context = {}, runtime: runtimeOverride }: { instruction: string; typeKey?: string; context?: Record<string, unknown>; runtime?: RuntimeProviderConfig }) {
    const runtime = runtimeOverride || await settings();
    assertUsable(runtime);
    const text = String(instruction || "").trim();
    if (!text) throw new AppError("创作指令不能为空。", "CREATIVE_INSTRUCTION_EMPTY", 400);
    try {
      const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
      const response = await client.chat.completions.create({
        model: runtime.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是视频创作中控。只输出合法 JSON，字段必须包含 title、summary、steps、requiredInputs、estimateSeconds、estimatedCredits。不要执行视频生成。"
          },
          {
            role: "user",
            content: JSON.stringify({ instruction: text, typeKey: typeKey || null, context })
          }
        ]
      });
      return { provider: "deepseek-harness", model: runtime.model, responseId: response.id, plan: parseJsonObject(completionText(response), response.id), usage: response.usage || null };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw mapDeepSeekError(error);
    }
  }

  async function planWorkflowTask({
    instruction,
    typeKey,
    assets = [],
    options = {},
    context = {},
    catalog,
    runtime: runtimeOverride
  }: {
    instruction: string;
    typeKey?: string;
    assets?: Array<{ id: string; kind: string; name?: string }>;
    options?: Record<string, unknown>;
    context?: Record<string, unknown>;
    catalog: Array<Record<string, unknown>>;
    runtime?: RuntimeProviderConfig;
  }) {
    const runtime = runtimeOverride || await settings();
    assertUsable(runtime);
    const text = String(instruction || "").trim();
    if (!text) throw new AppError("创作指令不能为空。", "CREATIVE_INSTRUCTION_EMPTY", 400);
    try {
      const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
      const response = await client.chat.completions.create({
        model: runtime.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是 e剪宝 DeepSeek Harness 的受控工作流规划器。",
              "你只负责选择工作流、整理参数和生成步骤，不执行命令、不调用工具、不编造素材 ID。",
              "workflowKey 必须严格来自 catalog；用户指定 typeKey 时优先服从。",
              "只输出一个 JSON 对象，字段为 title、summary、typeKey、workflowKey、steps、workflowInput。",
              "steps 是最多 8 项的数组，每项包含 id、title、description。",
              "workflowInput 只能使用请求里真实存在的素材 ID；缺少素材时保留空数组，由服务器负责拦截。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ instruction: text, typeKey: typeKey || null, assets, options, context, catalog })
          }
        ]
      });
      return {
        provider: "deepseek-harness",
        model: runtime.model,
        responseId: response.id,
        plan: parseJsonObject(completionText(response), response.id),
        usage: response.usage || null
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw mapDeepSeekError(error);
    }
  }

  async function polishCopy({
    text,
    label,
    typeKey,
    guidance,
    runtime: runtimeOverride
  }: {
    text: string;
    label?: string;
    typeKey?: string;
    guidance?: string;
    runtime?: RuntimeProviderConfig;
  }) {
    const runtime = runtimeOverride || await settings();
    assertUsable(runtime);
    const source = String(text || "").trim();
    if (!source) throw new AppError("请先填写需要润色的文案。", "COPY_POLISH_TEXT_EMPTY", 400);
    try {
      const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
      const response = await client.chat.completions.create({
        model: runtime.model,
        messages: [
          {
            role: "system",
            content: [
              "你是 e剪宝的视频文案润色助手。",
              "只输出润色后的中文正文，不要解释、不要标题、不要 Markdown。",
              "保留用户原意、事实、数字、时间、地点、报名方式和限制条件；不要编造新卖点或新素材。",
              "让表达更清楚、更有画面感，更适合短视频脚本、卖点文案、剧情描述、剪辑要求、播客文案或活动信息。",
              "如果原文很短，可以适度补足语气和行动号召，但不要偏离原文。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `文案类型：${label || "文案"}`,
              `创作类型：${typeKey || "通用"}`,
              guidance ? `字数与写作提示：${guidance}` : "",
              "请直接润色下面的原文，并只输出润色后的完整正文：",
              "",
              source
            ].filter(Boolean).join("\n")
          }
        ]
      });
      const polished = cleanPolishedText(completionText(response));
      if (!polished) throw new AppError("DeepSeek 未返回可用润色文案。", "COPY_POLISH_EMPTY_RESULT", 502, { responseId: response.id });
      return { provider: "deepseek-harness", model: runtime.model, responseId: response.id, text: polished, usage: response.usage || null };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw mapDeepSeekError(error);
    }
  }

  async function testConnection(runtime?: RuntimeProviderConfig) {
    const result = await chat({ messages: [{ role: "user", content: "请只回复：连接成功" }], context: { source: "provider-test" }, runtime });
    return { provider: "deepseek-harness", model: result.model, responseId: result.responseId, text: result.text };
  }

  return { configured: true, chat, planCreativeTask, planWorkflowTask, polishCopy, testConnection };
}

function assertUsable(runtime: RuntimeProviderConfig) {
  if (!runtime.enabled) throw new AppError("DeepSeek 服务已在后台配置中心停用。", "DEEPSEEK_DISABLED", 503);
  if (!runtime.apiKey) throw new AppError("DeepSeek API 尚未配置。", "DEEPSEEK_NOT_CONFIGURED", 503);
}

function normalizeMessages(messages: ChatMessage[]) {
  return (Array.isArray(messages) ? messages : []).filter(message => message && ["system", "user", "assistant"].includes(message.role) && String(message.content || "").trim()).map(message => ({ role: message.role, content: String(message.content) }));
}

/** Adds non-conversational UI context without creating a fake user message. */
function appendContext(messages: ReturnType<typeof normalizeMessages>, context: Record<string, unknown>) {
  if (!context || !Object.keys(context).length) return messages;
  const serialized = JSON.stringify(context).slice(0, 2000);
  return [{ role: "system" as const, content: `平台上下文（仅供参考）：${serialized}` }, ...messages];
}

function completionText(response: { choices?: Array<{ message?: { content?: string | null } }> }) {
  return response.choices?.[0]?.message?.content?.trim() || "";
}

function parseJsonObject(text: string, responseId: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new AppError("DeepSeek 返回的创作计划不是合法 JSON。", "DEEPSEEK_INVALID_PLAN", 502, { responseId }); }
}

function cleanPolishedText(text: string) {
  return String(text || "")
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

function mapDeepSeekError(error: any) {
  const status = Number(error?.status || error?.statusCode || 502);
  if (status === 401 || status === 403) return new AppError("DeepSeek API 鉴权失败，请检查云端密钥。", "DEEPSEEK_AUTH_FAILED", 502);
  if (status === 429) return new AppError("DeepSeek API 请求过于频繁，请稍后重试。", "DEEPSEEK_RATE_LIMITED", 429);
  return new AppError("DeepSeek 服务暂时不可用，请稍后重试。", "DEEPSEEK_UPSTREAM_ERROR", 502, { upstreamStatus: status });
}
