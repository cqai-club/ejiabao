/**
 * 带命名空间的 localStorage 封装。
 * 所有序列化和异常处理集中在这里，业务模块不再散落 JSON.parse/stringify。
 */
export function createStorage(namespace = "ejiabao") {
  const prefix = `${namespace}:`;

  function key(name) {
    return `${prefix}${name}`;
  }

  function get(name, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key(name));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      console.warn(`[e剪宝] 读取存储失败：${name}`, error);
      return fallback;
    }
  }

  function set(name, value) {
    try {
      window.localStorage.setItem(key(name), JSON.stringify(value));
      return value;
    } catch (error) {
      console.error(`[e剪宝] 写入存储失败：${name}`, error);
      throw error;
    }
  }

  function remove(name) {
    window.localStorage.removeItem(key(name));
  }

  function clear() {
    const keys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const current = window.localStorage.key(index);
      if (current?.startsWith(prefix)) keys.push(current);
    }
    keys.forEach(current => window.localStorage.removeItem(current));
  }

  return { key, get, set, remove, clear };
}
