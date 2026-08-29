import OpenAI from "openai";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import type { RuntimeProviderConfig } from "../provider-config/provider-config-service.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Codex Responses API 云端适配层；API Key 只在后端，支持后台动态配置。 */
export function createCodexService({ config, getSettings }: { config: AppConfig; getSettings?: () => Promise<RuntimeProviderConfig> }) {
  async function settings(): Promise<RuntimeProviderConfig> {
    return getSettings ? getSettings() : {
      provider: "codex",
      baseUrl: config.CODEX_BASE_URL,
      model: config.CODEX_MODEL,
      reasoningEffort: config.CODEX_REASONING_EFFORT,
      apiKey: config.CODEX_API_KEY || config.OPENAI_API_KEY,
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
      const response = await client.responses.create({
        model: runtime.model,
        reasoning: { effort: runtime.reasoningEffort as any },
        input: normalized,
        metadata: { product: "ejiabao", surface: "desktop-workbench", context: JSON.stringify(context).slice(0, 2000) }
      });
      return { provider: "codex", model: runtime.model, responseId: response.id, text: response.output_text || "", usage: response.usage || null, raw: response };
    } catch (error: any) {
      throw mapCodexError(error);
    }
  }

  async function planCreativeTask({ instruction, typeKey, context = {}, runtime: runtimeOverride }: { instruction: string; typeKey?: string; context?: Record<string, unknown>; runtime?: RuntimeProviderConfig }) {
    const runtime = runtimeOverride || await settings();
    assertUsable(runtime);
    const text = String(instruction || "").trim();
    if (!text) throw new AppError("创作指令不能为空。", "CREATIVE_INSTRUCTION_EMPTY", 400);
    try {
      const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
      const response = await client.responses.create({
        model: runtime.model,
        reasoning: { effort: runtime.reasoningEffort as any },
        input: [
          { role: "system", content: [{ type: "input_text", text: "你是视频创作中控。只输出合法 JSON，字段必须包含 title、summary、steps、requiredInputs、estimateSeconds、estimatedCredits。不要执行视频生成。" }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({ instruction: text, typeKey: typeKey || null, context }) }] }
        ],
        text: { format: { type: "json_object" } }
      });
      return { provider: "codex", model: runtime.model, responseId: response.id, plan: parseJsonObject(response.output_text || "{}", response.id), usage: response.usage || null };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw mapCodexError(error);
    }
  }

  async function testConnection(runtime?: RuntimeProviderConfig) {
    const result = await chat({ messages: [{ role: "user", content: "请只回复：连接成功" }], context: { source: "provider-test" }, runtime });
    return { provider: "codex", model: result.model, responseId: result.responseId, text: result.text };
  }

  return { configured: true, chat, planCreativeTask, testConnection };
}

function assertUsable(runtime: RuntimeProviderConfig) {
  if (!runtime.enabled) throw new AppError("Codex 服务已在后台配置中心停用。", "CODEX_DISABLED", 503);
  if (!runtime.apiKey) throw new AppError("Codex API 尚未配置。", "CODEX_NOT_CONFIGURED", 503);
}

function normalizeMessages(messages: ChatMessage[]) {
  return (Array.isArray(messages) ? messages : []).filter(message => message && ["system", "user", "assistant"].includes(message.role) && String(message.content || "").trim()).map(message => ({ role: message.role, content: String(message.content) }));
}

function parseJsonObject(text: string, responseId: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new AppError("Codex 返回的创作计划不是合法 JSON。", "CODEX_INVALID_PLAN", 502, { responseId }); }
}

function mapCodexError(error: any) {
  const status = Number(error?.status || error?.statusCode || 502);
  if (status === 401 || status === 403) return new AppError("Codex API 鉴权失败，请检查云端密钥。", "CODEX_AUTH_FAILED", 502);
  if (status === 429) return new AppError("Codex API 请求过于频繁，请稍后重试。", "CODEX_RATE_LIMITED", 429);
  return new AppError("Codex 服务暂时不可用，请稍后重试。", "CODEX_UPSTREAM_ERROR", 502, { upstreamStatus: status });
}
