import { AppError } from "../../lib/errors.js";
import { randomUUID } from "node:crypto";
import type { RuntimeProviderConfig } from "../provider-config/provider-config-service.js";

/** InferFlow 只在后端调用，浏览器永远不会接触 X-API-Key。 */
export function createInferFlowService() {
  async function requestJson(runtime: RuntimeProviderConfig, path: string, init: RequestInit = {}) {
    if (!runtime.enabled) throw new AppError("InferFlow 服务已在后台配置中心停用。", "INFERFLOW_DISABLED", 503);
    if (!runtime.apiKey) throw new AppError("InferFlow API 尚未配置。", "INFERFLOW_NOT_CONFIGURED", 503);
    const endpoint = `${runtime.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        ...init,
        headers: {
          Accept: "application/json",
          "X-API-Key": runtime.apiKey,
          ...(init.headers || {})
        },
        signal: init.signal || AbortSignal.timeout(60_000)
      });
    } catch (error) {
      throw new AppError("InferFlow 服务暂时不可达，请检查接口地址或网络连接。", "INFERFLOW_UPSTREAM_UNAVAILABLE", 502, {
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) throw mapUpstreamError(response.status, payload);
    return payload;
  }

  async function uploadMaterial(runtime: RuntimeProviderConfig, kind: "avatar" | "voice", file: { data: Buffer; filename: string; mimeType: string }) {
    if (!runtime.enabled) throw new AppError("InferFlow 服务已在后台配置中心停用。", "INFERFLOW_DISABLED", 503);
    if (!runtime.apiKey) throw new AppError("InferFlow API 尚未配置。", "INFERFLOW_NOT_CONFIGURED", 503);
    const form = new FormData();
    form.append("file", new Blob([file.data as any], { type: file.mimeType }), file.filename);
    form.append("name", file.filename);
    form.append("authorization_confirmed", "true");
    const payload = await requestJson(runtime, `/digital-human/${kind}s`, {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": `${kind}-upload-${randomUUID()}` }
    });
    const id = payload?.[`${kind}_id`] || payload?.asset_id || payload?.id || payload?.[kind]?.id || payload?.asset?.id;
    if (!id) throw new AppError(`InferFlow 未返回${kind === "avatar" ? "人像" : "音频"}素材 ID。`, "INFERFLOW_ASSET_ID_MISSING", 502);
    return { id: String(id), reusedExisting: Boolean(payload?.reused_existing) };
  }

  async function createRun(runtime: RuntimeProviderConfig, inputs: Record<string, unknown>) {
    const payload = await requestJson(runtime, `/skills/${encodeURIComponent(runtime.model || "digital_human_standard")}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `ejiabao-${randomUUID()}`
      },
      body: JSON.stringify({ inputs })
    });
    const runId = payload?.run_id || payload?.id || payload?.run?.id;
    if (!runId) throw new AppError("InferFlow 未返回生成任务 ID。", "INFERFLOW_RUN_ID_MISSING", 502);
    return { runId: String(runId), raw: payload };
  }

  async function getRun(runtime: RuntimeProviderConfig, runId: string) {
    return requestJson(runtime, `/runs/${encodeURIComponent(runId)}`);
  }

  async function getOutputs(runtime: RuntimeProviderConfig, runId: string) {
    return requestJson(runtime, `/runs/${encodeURIComponent(runId)}/outputs`);
  }

  async function downloadOutput(runtime: RuntimeProviderConfig, runId: string, output: any) {
    const path = output?.download_url || output?.downloadUrl || output?.url;
    if (!path) return null;
    const endpoint = resolveEndpoint(runtime.baseUrl, String(path));
    let response: Response;
    try {
      response = await fetch(endpoint, { headers: { "X-API-Key": runtime.apiKey }, signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      throw new AppError("InferFlow 输出下载失败，请检查网络连接。", "INFERFLOW_OUTPUT_UNAVAILABLE", 502, { cause: error instanceof Error ? error.message : String(error) });
    }
    if (!response.ok) throw mapUpstreamError(response.status, await response.json().catch(() => null));
    return Buffer.from(await response.arrayBuffer());
  }

  async function cancelRun(runtime: RuntimeProviderConfig, runId: string) {
    return requestJson(runtime, `/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }

  async function testConnection(runtime: RuntimeProviderConfig) {
    if (!runtime.enabled) throw new AppError("InferFlow 服务已在后台配置中心停用。", "INFERFLOW_DISABLED", 503);
    if (!runtime.apiKey) throw new AppError("InferFlow API 尚未配置。", "INFERFLOW_NOT_CONFIGURED", 503);

    const endpoint = `${runtime.baseUrl.replace(/\/$/, "")}/credits`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json", "X-API-Key": runtime.apiKey },
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new AppError("InferFlow 服务暂时不可达，请检查接口地址或网络连接。", "INFERFLOW_UPSTREAM_UNAVAILABLE", 502, {
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppError("InferFlow API 鉴权失败，请检查服务端密钥。", "INFERFLOW_AUTH_FAILED", 502);
      }
      if (response.status === 429) {
        throw new AppError("InferFlow API 请求过于频繁，请稍后重试。", "INFERFLOW_RATE_LIMITED", 429);
      }
      throw new AppError("InferFlow 服务返回异常，请稍后重试。", "INFERFLOW_UPSTREAM_ERROR", 502, {
        upstreamStatus: response.status,
        upstreamCode: payload?.error?.code || payload?.code || null
      });
    }

    return {
      provider: "inferflow",
      model: runtime.model,
      text: "连接成功",
      credits: payload?.credits ?? payload?.balance ?? null
    };
  }

  return { testConnection, uploadMaterial, createRun, getRun, getOutputs, downloadOutput, cancelRun };
}

function mapUpstreamError(status: number, payload: any) {
  if (status === 401 || status === 403) return new AppError("InferFlow API 鉴权失败，请检查服务端密钥。", "INFERFLOW_AUTH_FAILED", 502);
  if (status === 429) return new AppError("InferFlow API 请求过于频繁，请稍后重试。", "INFERFLOW_RATE_LIMITED", 429);
  const message = payload?.error?.message || payload?.message || "InferFlow 服务返回异常，请稍后重试。";
  return new AppError(String(message).slice(0, 500), "INFERFLOW_UPSTREAM_ERROR", 502, { upstreamStatus: status, upstreamCode: payload?.error?.code || payload?.code || null });
}

function resolveEndpoint(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) {
    try { return `${new URL(baseUrl).origin}${path}`; } catch { /* fall through */ }
  }
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
