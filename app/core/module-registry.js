/**
 * 模块注册器。
 * 模块统一实现 start/stop 生命周期，便于未来拆成桌面端后台服务或按需加载。
 */
export function createModuleRegistry() {
  const definitions = new Map();
  const instances = new Map();

  function register(name, factory) {
    if (!name || typeof factory !== "function") throw new TypeError("模块定义无效");
    definitions.set(name, factory);
    return registry;
  }

  async function startAll(context) {
    for (const [name, factory] of definitions) {
      const instance = await factory(context);
      instances.set(name, instance || {});
      if (typeof instance?.start === "function") await instance.start();
    }
    return instances;
  }

  async function stopAll() {
    const values = [...instances.values()].reverse();
    for (const instance of values) {
      if (typeof instance?.stop === "function") await instance.stop();
    }
    instances.clear();
  }

  function get(name) {
    return instances.get(name);
  }

  const registry = { register, startAll, stopAll, get };
  return registry;
}
