const DEFAULT_SETTINGS = {
  theme: "dark",
  notifications: true,
  defaultExportDirectory: "C:\\Users\\Videos\\AI视频创作",
  cloudModelRouting: "auto",
  localCacheEnabled: true,
  deviceAuthorized: false,
  generativeVideo: "自动匹配",
  digitalHuman: "自然优先",
  smartCut: "平衡",
  exportPermission: "允许导出"
};

const DEVICE_SETTING_KEYS = ["theme", "notifications", "defaultExportDirectory", "localCacheEnabled", "exportPermission", "deviceAuthorized"];
const ACCOUNT_SETTING_KEYS = ["cloudModelRouting", "generativeVideo", "digitalHuman", "smartCut"];

/** 应用设置服务，保持设置数据与设置页面 DOM 解耦。 */
export function createSettingsService({ storage, eventBus, session }) {
  const KEY = "settings";

  function get() {
    const deviceSettings = storage.get(KEY, {});
    const accountKey = getAccountKey(session);
    if (!isFormalSession(session) || !accountKey) return { ...DEFAULT_SETTINGS, ...deviceSettings };
    const accountSettings = pickAccount(storage.get(accountKey, {}));
    return { ...DEFAULT_SETTINGS, ...pick(deviceSettings, DEVICE_SETTING_KEYS), ...accountSettings };
  }

  function update(patch = {}) {
    const accountKey = getAccountKey(session);
    if (isFormalSession(session) && accountKey) {
      writeDeviceSettings(patch);
      writeAccountSettings(patch, accountKey);
    } else if (isFormalSession(session)) {
      // A token without a stable user identity must not write account fields
      // into the shared device store.
      writeDeviceSettings(patch);
    } else {
      storage.set(KEY, { ...get(), ...patch });
    }
    const next = get();
    eventBus.emit("settings:updated", next);
    return next;
  }

  function updateDevice(patch = {}) {
    writeDeviceSettings(patch);
    const next = get();
    eventBus.emit("settings:updated", next);
    return next;
  }

  function updateAccount(patch = {}) {
    const accountKey = getAccountKey(session);
    if (accountKey) writeAccountSettings(patch, accountKey);
    else if (!isFormalSession(session)) storage.set(KEY, { ...get(), ...pick(patch, ACCOUNT_SETTING_KEYS) });
    const next = get();
    eventBus.emit("settings:updated", next);
    return next;
  }

  function reset() {
    const accountKey = getAccountKey(session);
    if (accountKey) {
      storage.set(KEY, { ...storage.get(KEY, {}), ...pick(DEFAULT_SETTINGS, DEVICE_SETTING_KEYS) });
      storage.set(accountKey, pick(DEFAULT_SETTINGS, ["cloudModelRouting", "generativeVideo", "digitalHuman", "smartCut"]));
    } else if (isFormalSession(session)) {
      storage.set(KEY, { ...storage.get(KEY, {}), ...pick(DEFAULT_SETTINGS, DEVICE_SETTING_KEYS) });
    } else storage.set(KEY, { ...DEFAULT_SETTINGS });
    const next = get();
    eventBus.emit("settings:updated", next);
    return next;
  }

  return { get, update, updateDevice, updateAccount, reset };

  function writeDeviceSettings(patch = {}) {
    const devicePatch = pick(patch, DEVICE_SETTING_KEYS);
    if (Object.keys(devicePatch).length) storage.set(KEY, { ...storage.get(KEY, {}), ...devicePatch });
  }

  function writeAccountSettings(patch = {}, accountKey = getAccountKey(session)) {
    const accountPatch = pick(patch, ACCOUNT_SETTING_KEYS);
    if (accountKey && Object.keys(accountPatch).length) {
      storage.set(accountKey, { ...pickAccount(storage.get(accountKey, {})), ...accountPatch });
    }
  }
}

function isFormalSession(session) {
  const current = session?.read?.();
  return Boolean(
    current
      && !current.virtual
      && !current.user?.virtual
      && (current.accessToken || current.refreshToken)
      && !(session?.isExpired?.(current))
  );
}

function getAccountKey(session) {
  if (!isFormalSession(session)) return null;
  const current = session?.read?.();
  const identity = current?.user?.id ?? current?.sub ?? current?.user?.email ?? current?.user?.phone ?? current?.user?.identifier;
  if (identity === undefined || identity === null || String(identity).trim() === "") return null;
  return `settings:${encodeURIComponent(String(identity))}`;
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => value?.[key] !== undefined && value?.[key] !== null).map(key => [key, value[key]]));
}

function pickAccount(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fields = source.fields && typeof source.fields === "object" && !Array.isArray(source.fields) ? source.fields : {};
  return Object.fromEntries(ACCOUNT_SETTING_KEYS
    .map(key => [key, source[key] !== undefined && source[key] !== null ? source[key] : fields[key]])
    .filter(([, item]) => item !== undefined && item !== null));
}
