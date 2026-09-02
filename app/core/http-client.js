import { PlatformInteractionError } from "../skills/platform-interaction/errors.js";

/** 浏览器端 API 客户端；真实接口地址来自桌面端注入配置。 */
export function createHttpClient({ config, session, eventBus, fetchImpl = window.fetch.bind(window) }) {
  const baseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");

  async function request(path, { method = "GET", body, headers = {}, signal, timeoutMs = 30000, retry = true } = {}) {
    if (!baseUrl) throw new PlatformInteractionError("产品后端 API 尚未配置。", { code: "API_NOT_CONFIGURED" });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const abortHandler = () => controller.abort();
    signal?.addEventListener("abort", abortHandler, { once: true });
    const currentSession = session.read();
    const hasAuthenticatedSession = Boolean(
      currentSession
        && !currentSession.virtual
        && !currentSession.user?.virtual
        && (currentSession.accessToken || currentSession.refreshToken)
    );

    try {
      const response = await fetchImpl(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(currentSession?.accessToken ? { Authorization: `Bearer ${currentSession.accessToken}` } : {}),
          ...headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const data = await parseResponse(response);

      if (response.status === 401 && retry && hasAuthenticatedSession && currentSession.refreshToken) {
        const refreshed = await refresh(currentSession.refreshToken);
        if (refreshed) return request(path, { method, body, headers, signal, timeoutMs, retry: false });
      }
      // An anonymous/virtual request can legitimately receive 401 from a
      // protected endpoint. Do not turn that into a global logout event.
      if (response.status === 401 && hasAuthenticatedSession) {
        session.clear("expired");
        eventBus.emit("auth:expired", { status: response.status, data });
      }
      if (!response.ok) throw new PlatformInteractionError(data?.error?.message || data?.message || `请求失败（${response.status}）。`, { code: data?.error?.code || "API_HTTP_ERROR", status: response.status });
      return { ok: true, status: response.status, data };
    } catch (error) {
      if (error instanceof PlatformInteractionError) throw error;
      if (error?.name === "AbortError") throw new PlatformInteractionError("请求超时或已取消。", { code: "API_ABORTED", cause: error });
      throw new PlatformInteractionError("网络连接失败，请稍后重试。", { code: "API_NETWORK_ERROR", cause: error });
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
    }
  }

  async function refresh(refreshToken) {
    try {
      const response = await fetchImpl(`${baseUrl}${config.auth?.refreshPath || "/v1/auth/refresh"}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
      if (!response.ok) return false;
      const payload = await parseResponse(response);
      const data = payload?.data || payload;
      if (!data?.accessToken) return false;
      session.save({ ...session.read(), accessToken: data.accessToken, refreshToken: data.refreshToken || refreshToken });
      eventBus.emit("auth:refreshed", data);
      return true;
    } catch {
      return false;
    }
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: "GET" }),
    post: (path, body, options) => request(path, { ...options, method: "POST", body }),
    put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
    patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
    delete: (path, options) => request(path, { ...options, method: "DELETE" })
  };
}

async function parseResponse(response) {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { raw }; }
}
