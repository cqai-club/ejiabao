import { PlatformInteractionError } from "./errors.js";

/**
 * 平台请求公共实现。
 * provider 适配器只负责描述端点和解析响应，不在业务模块里拼接网络请求。
 */
export async function requestJson({ provider, endpoint, apiKey, payload, signal, fetchImpl = window.fetch.bind(window), headers = {} }) {
  if (!endpoint) {
    return {
      ok: false,
      provider,
      status: "unconfigured",
      message: `尚未配置 ${provider} 的服务端通道。`
    };
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers
      },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new PlatformInteractionError("平台请求已取消。", { provider, code: "ABORTED", cause: error });
    }
    throw new PlatformInteractionError("平台暂时不可达，请稍后重试。", { provider, code: "NETWORK_ERROR", cause: error });
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new PlatformInteractionError(data?.error?.message || `平台返回错误（${response.status}）。`, {
      provider,
      code: "HTTP_ERROR",
      status: response.status
    });
  }

  return { ok: true, provider, status: "success", data };
}

export function normalizeMessages(messages = []) {
  return messages
    .filter(item => item && item.role && item.content)
    .map(item => ({ role: String(item.role), content: String(item.content) }));
}

export function extractText(data) {
  return data?.output_text
    || data?.output?.text
    || data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.message?.content
    || data?.result?.text
    || "";
}
