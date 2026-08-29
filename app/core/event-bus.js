/**
 * 轻量事件总线。
 *
 * 业务模块只通过事件总线沟通，避免模块之间直接互相引用 DOM。
 * 这样后续把 HTML 换成桌面端壳（例如 WebView / Electron）时，业务层可以继续复用。
 */
export function createEventBus() {
  const listeners = new Map();

  function on(eventName, handler) {
    if (typeof handler !== "function") throw new TypeError("事件处理器必须是函数");
    const handlers = listeners.get(eventName) || new Set();
    handlers.add(handler);
    listeners.set(eventName, handlers);
    return () => off(eventName, handler);
  }

  function off(eventName, handler) {
    const handlers = listeners.get(eventName);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) listeners.delete(eventName);
  }

  function emit(eventName, payload) {
    const handlers = listeners.get(eventName);
    if (!handlers) return;
    [...handlers].forEach(handler => {
      try {
        handler(payload);
      } catch (error) {
        // 单个订阅者出错时不能阻断其他模块。
        console.error(`[e剪宝] 事件处理失败：${eventName}`, error);
      }
    });
  }

  function clear() {
    listeners.clear();
  }

  return { on, off, emit, clear };
}
