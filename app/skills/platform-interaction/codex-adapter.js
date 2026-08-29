import { createOperationAdapter } from "./adapter-core.js";
import { extractText } from "./request.js";

/**
 * Codex 适配器。
 * endpoint 由正式版服务端代理提供，浏览器端不直接暴露长期密钥。
 */
export function createCodexAdapter(config = {}, requestClient = null) {
  return createOperationAdapter({
    provider: "codex",
    label: "Codex",
    capabilities: ["plan", "execute", "validate", "task-status", "task-cancel"],
    config,
    parseText: extractText,
    requestClient
  });
}
