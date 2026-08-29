import { createOperationAdapter } from "./adapter-core.js";
import { extractText } from "./request.js";

/**
 * DeepSeek Harness 适配器。
 * Harness 的具体脚本/分镜编排协议由服务端决定，前端只维持稳定的通用交互契约。
 */
export function createDeepSeekHarnessAdapter(config = {}, requestClient = null) {
  return createOperationAdapter({
    provider: "deepseek-harness",
    label: "DeepSeek Harness",
    capabilities: ["script", "storyboard", "dispatch", "task-status", "task-cancel"],
    config,
    parseText: extractText,
    requestClient
  });
}
