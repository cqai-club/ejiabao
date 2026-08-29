/**
 * 会话生命周期服务。
 * 这里只处理登录态本身，不处理登录页 DOM；认证接口接入后只需替换 auth-service 的 provider。
 */
export function createSessionService({ storage, eventBus, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() }) {
  const SESSION_KEY = "session";

  function read() {
    return storage.get(SESSION_KEY, null);
  }

  function isExpired(session = read()) {
    if (!session?.updatedAt) return false;
    const updatedAt = Date.parse(session.updatedAt);
    return Number.isNaN(updatedAt) || now() - updatedAt > ttlMs;
  }

  function save(session) {
    const next = { ...session, updatedAt: new Date(now()).toISOString() };
    storage.set(SESSION_KEY, next);
    eventBus.emit("session:changed", next);
    return next;
  }

  function touch() {
    const session = read();
    if (!session) return null;
    if (isExpired(session)) {
      clear("expired");
      return null;
    }
    return save(session);
  }

  function start(session) {
    return save({ ...session, createdAt: session.createdAt || new Date(now()).toISOString() });
  }

  function clear(reason = "logout") {
    storage.remove(SESSION_KEY);
    eventBus.emit("session:cleared", { reason });
  }

  return { read, isExpired, save, touch, start, clear };
}
