import OpenAI from "openai";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

/** OpenAI 只在后端调用，前端和桌面渲染层不接触 API key。 */
export function createOpenAIService({ config }: { config: AppConfig }) {
  if (!config.OPENAI_API_KEY) {
    return { configured: false, async planCreativeTask() { throw new AppError("OpenAI API 尚未配置。", "OPENAI_NOT_CONFIGURED", 503); } };
  }
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  async function planCreativeTask({ instruction, typeKey, context = {} }: { instruction: string; typeKey?: string; context?: Record<string, unknown> }) {
    if (!instruction?.trim()) throw new AppError("创作指令不能为空。", "CREATIVE_INSTRUCTION_EMPTY");
    const response = await client.responses.create({
      model: config.OPENAI_MODEL,
      input: [
        { role: "system", content: [{ type: "input_text", text: "你是视频创作中控。只输出结构化 JSON：title, summary, steps, requiredInputs, estimateSeconds, estimatedCredits。不要执行视频生成。" }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify({ instruction, typeKey: typeKey || null, context }) }] }
      ],
      text: { format: { type: "json_object" } }
    });
    const text = response.output_text || "{}";
    try {
      return { provider: "openai", model: config.OPENAI_MODEL, plan: JSON.parse(text), responseId: response.id };
    } catch {
      throw new AppError("OpenAI 返回的任务规划不是有效 JSON。", "OPENAI_INVALID_PLAN", 502, { responseId: response.id });
    }
  }

  return { configured: true, planCreativeTask };
}
