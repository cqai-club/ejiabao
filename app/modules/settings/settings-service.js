const DEFAULT_SETTINGS = {
  theme: "dark",
  notifications: true,
  defaultExportDirectory: "",
  cloudModelRouting: "auto",
  localCacheEnabled: true,
  deviceAuthorized: false
};

/** 应用设置服务，保持设置数据与设置页面 DOM 解耦。 */
export function createSettingsService({ storage, eventBus }) {
  const KEY = "settings";

  function get() { return { ...DEFAULT_SETTINGS, ...storage.get(KEY, {}) }; }

  function update(patch = {}) {
    const next = { ...get(), ...patch };
    storage.set(KEY, next);
    eventBus.emit("settings:updated", next);
    return next;
  }

  function reset() {
    storage.set(KEY, DEFAULT_SETTINGS);
    eventBus.emit("settings:updated", DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }

  return { get, update, reset };
}
