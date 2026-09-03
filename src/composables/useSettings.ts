import { computed, reactive, ref } from "vue";
import { currentRuntime, isApiAuthenticated, waitForRuntime } from "@/lib/runtime";

const defaults = {
  theme: "dark",
  notifications: true,
  defaultExportDirectory: "C:\\Users\\Videos\\AI视频创作",
  localCacheEnabled: true,
  cloudModelRouting: "auto",
  generativeVideo: "自动匹配",
  digitalHuman: "自然优先",
  smartCut: "平衡",
  exportPermission: "允许导出"
};

const fallbackQuota = {
  balance: 150,
  reserved: 0,
  available: 68,
  used: 82,
  remote: false
};

const preferenceCacheKey = "settings-preferences";
const deviceSettingKeys = ["theme", "notifications", "defaultExportDirectory", "localCacheEnabled", "exportPermission"];
const accountSettingKeys = ["cloudModelRouting", "generativeVideo", "digitalHuman", "smartCut"];

export function useSettings() {
  const settings = reactive({ ...defaults });
  const loading = ref(false);
  const quotaLoading = ref(false);
  const quota = reactive({ ...fallbackQuota });
  const saving = ref(false);
  const message = ref("");
  const error = ref("");

  function resetQuota() {
    Object.assign(quota, fallbackQuota);
  }

  function applyPreference(value: Record<string, any>) {
    Object.assign(settings, normalizeSettings(value));
  }

  function collectPreference(authenticated = false) {
    return authenticated ? collectAccountPreferenceFrom(settings) : collectPreferenceFrom(settings);
  }

  async function load() {
    loading.value = true;
    error.value = "";
    resetQuota();
    try {
      const runtime = await waitForRuntime();
      if (!runtime) throw new Error("运行层尚未就绪，请稍后重试。");
      const session = runtime.session?.read?.();
      const authenticated = isApiAuthenticated(session);

      // The runtime settings service stores device defaults. Account-scoped
      // preferences are loaded from the dedicated cache and remote endpoint
      // below so one account cannot inherit another account's workflow choices.
      const runtimeSettings = normalizeSettings(runtime.modules?.settings?.get?.() || {});
      applyPreference(authenticated ? pickSettings(runtimeSettings, deviceSettingKeys) : runtimeSettings);

      const cacheKey = getPreferenceCacheKey(session, authenticated);
      const cached = cacheKey
        ? (authenticated
          ? (normalizeAccountPreference(readPreferenceCache(runtime, cacheKey)) || {})
          : readPreferenceCache(runtime, cacheKey))
        : {};
      applyPreference(cached);

      if (authenticated && runtime.http?.get) {
        const preferenceResult = await runtime.http.get("/v1/preferences/settings", { timeoutMs: 30000 });
        const remotePreference = normalizeAccountPreference(extractPreference(preferenceResult));
        if (!remotePreference) throw new Error("设置服务返回格式无效。");
        const mergedPreference = mergeAccountPreferences(cached, remotePreference);
        applyPreference(mergedPreference);
        writePreferenceCache(runtime, cacheKey, mergedPreference);
        try {
          await loadQuota(runtime);
        } catch {
          // Settings remain usable when the quota endpoint is temporarily unavailable.
        }
      }
      if (settings.theme === "light" || settings.theme === "dark") document.body.dataset.theme = settings.theme;
    } catch (cause: any) {
      error.value = cause?.message || "设置读取失败。";
    } finally {
      loading.value = false;
    }
  }

  async function save() {
    saving.value = true;
    message.value = "";
    error.value = "";
    try {
      const runtime = currentRuntime() || await waitForRuntime();
      if (!runtime) throw new Error("运行层尚未就绪，请稍后重试。");
      const service = runtime.modules?.settings;
      if (!service?.update) throw new Error("设置服务尚未就绪，请稍后重试。");
      const session = runtime.session?.read?.();
      const authenticated = isApiAuthenticated(session);
      const devicePatch = collectDeviceSettingsFrom(settings);
      const accountPatch = collectAccountSettingsFrom(settings);
      const preference = collectPreference(authenticated);

      if (authenticated) {
        // New runtimes expose explicit device/account writers. The fallback
        // keeps older injected runtimes working without changing their API.
        if (service.updateDevice) service.updateDevice(devicePatch);
        else service.update(devicePatch);
        if (service.updateAccount) service.updateAccount(accountPatch);
        else service.update(accountPatch);
      } else service.update({
        theme: settings.theme,
        notifications: settings.notifications,
        notificationsEnabled: settings.notifications,
        defaultExportDirectory: settings.defaultExportDirectory,
        localCacheEnabled: settings.localCacheEnabled,
        cloudModelRouting: settings.cloudModelRouting,
        generativeVideo: settings.generativeVideo,
        digitalHuman: settings.digitalHuman,
        smartCut: settings.smartCut,
        exportPermission: settings.exportPermission
      });
      writePreferenceCache(runtime, getPreferenceCacheKey(session, authenticated), preference);
      if (authenticated) {
        if (!runtime.http?.put) throw new Error("网络服务尚未就绪，请稍后重试。");
        await runtime.http.put("/v1/preferences/settings", { data: preference }, { timeoutMs: 30000 });
        message.value = "设置已保存到云端。";
      } else {
        message.value = "设置已保存到本机；登录正式账号后可同步云端。";
      }
    } catch (cause: any) {
      error.value = cause?.message || "设置保存失败。";
    } finally {
      saving.value = false;
    }
  }

  async function clearCache() {
    if (!window.caches?.keys) return 0;
    const keys = await window.caches.keys();
    const targets = keys.filter(key => key.toLowerCase().includes("ejiabao"));
    await Promise.all(targets.map(key => window.caches.delete(key)));
    return targets.length;
  }

  async function chooseExportDirectory() {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<{ name?: string }> }).showDirectoryPicker;
    if (!picker) throw new Error("当前环境不支持目录选择，请使用桌面端封装版本。");
    const handle = await picker();
    if (handle?.name) settings.defaultExportDirectory = handle.name;
    return handle?.name || "";
  }

  async function loadQuota(runtime: EjiabaoRuntime) {
    quotaLoading.value = true;
    try {
      const response = await runtime.http?.get?.("/v1/quota", { timeoutMs: 30000 });
      const value = normalizeQuota(extractQuota(response));
      if (!value) {
        resetQuota();
        return null;
      }
      quota.balance = value.balance;
      quota.reserved = value.reserved;
      quota.remote = true;
      return value;
    } catch (cause) {
      resetQuota();
      throw cause;
    } finally {
      quotaLoading.value = false;
    }
  }

  return { settings, quota, quotaLoading, availableQuota: computed(() => quota.remote ? Math.max(0, quota.balance - quota.reserved) : quota.available), loading, saving, message, error, load, save, clearCache, chooseExportDirectory };
}

function normalizeSettings(value: Record<string, any>) {
  const source = isRecord(value) ? value : {};
  const fields = isRecord(source.fields) ? source.fields : {};
  const candidate = {
    theme: source.theme,
    notifications: source.notifications ?? source.notificationsEnabled,
    defaultExportDirectory: source.defaultExportDirectory ?? fields.defaultExportDirectory,
    localCacheEnabled: source.localCacheEnabled ?? fields.localCacheEnabled,
    cloudModelRouting: source.cloudModelRouting ?? fields.cloudModelRouting,
    generativeVideo: source.generativeVideo ?? fields.generativeVideo,
    digitalHuman: source.digitalHuman ?? fields.digitalHuman,
    smartCut: source.smartCut ?? fields.smartCut,
    exportPermission: source.exportPermission ?? fields.exportPermission
  };
  return Object.fromEntries(Object.entries(candidate).filter(([, item]) => item !== undefined && item !== null));
}

function collectPreferenceFrom(settings: Record<string, any>) {
  return {
    theme: settings.theme,
    notificationsEnabled: settings.notifications,
    cloudModelRouting: settings.cloudModelRouting,
    fields: {
      generativeVideo: settings.generativeVideo,
      digitalHuman: settings.digitalHuman,
      smartCut: settings.smartCut,
      defaultExportDirectory: settings.defaultExportDirectory,
      localCacheEnabled: settings.localCacheEnabled,
      exportPermission: settings.exportPermission
    }
  };
}

function collectDeviceSettingsFrom(settings: Record<string, any>) {
  return pickSettings(settings, deviceSettingKeys);
}

function collectAccountSettingsFrom(settings: Record<string, any>) {
  return pickSettings(settings, accountSettingKeys);
}

function collectAccountPreferenceFrom(settings: Record<string, any>) {
  const account = collectAccountSettingsFrom(settings);
  const fields = pickSettings(account, ["generativeVideo", "digitalHuman", "smartCut"]);
  return {
    ...(account.cloudModelRouting === undefined ? {} : { cloudModelRouting: account.cloudModelRouting }),
    ...(Object.keys(fields).length ? { fields } : {})
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickSettings(value: Record<string, any>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined && value[key] !== null).map(key => [key, value[key]]));
}

function getPreferenceCacheKey(session: any, authenticated: boolean) {
  if (!authenticated) return preferenceCacheKey;
  const identity = session?.user?.id ?? session?.sub ?? session?.user?.email ?? session?.user?.phone ?? session?.user?.identifier;
  if (identity === undefined || identity === null || String(identity).trim() === "") return null;
  return `${preferenceCacheKey}:${encodeURIComponent(String(identity))}`;
}

function readPreferenceCache(runtime: EjiabaoRuntime, key: string) {
  const value = runtime.storage?.get?.(key, {});
  return isRecord(value) ? value : {};
}

function writePreferenceCache(runtime: EjiabaoRuntime, key: string | null, value: Record<string, any>) {
  if (!key) return;
  runtime.storage?.set?.(key, value);
}

function extractPreference(response: any): Record<string, any> | null {
  const body = response?.data ?? response;
  if (!isRecord(body)) return null;
  if (Object.prototype.hasOwnProperty.call(body, "data")) return isRecord(body.data) ? body.data : null;
  return body;
}

function normalizeAccountPreference(value: Record<string, any> | null): Record<string, any> | null {
  if (!isRecord(value)) return null;
  const normalized = normalizeSettings(value);
  const account = pickSettings(normalized, accountSettingKeys);
  const fields = pickSettings(account, ["generativeVideo", "digitalHuman", "smartCut"]);
  const result: Record<string, any> = {};
  if (account.cloudModelRouting !== undefined) result.cloudModelRouting = account.cloudModelRouting;
  if (Object.keys(fields).length) result.fields = fields;
  return result;
}

function mergeAccountPreferences(cached: Record<string, any>, remote: Record<string, any>) {
  const local = normalizeAccountPreference(cached) || {};
  const next = normalizeAccountPreference(remote) || {};
  const localFields = isRecord(local.fields) ? local.fields : {};
  const remoteFields = isRecord(next.fields) ? next.fields : {};
  const fields = { ...localFields, ...remoteFields };
  return {
    ...(local.cloudModelRouting === undefined && next.cloudModelRouting === undefined ? {} : { cloudModelRouting: next.cloudModelRouting ?? local.cloudModelRouting }),
    ...(Object.keys(fields).length ? { fields } : {})
  };
}

function extractQuota(response: any): Record<string, any> | null {
  const body = response?.data ?? response;
  const candidates = [body?.quota, body?.data?.quota, body?.data, body];
  for (const candidate of candidates) {
    if (isRecord(candidate) && ("balance" in candidate || "reserved" in candidate)) return candidate;
  }
  return null;
}

function normalizeQuota(value: Record<string, any> | null) {
  if (!value || !("balance" in value) || !("reserved" in value)) return null;
  const balance = parseQuotaInteger(value.balance);
  const reserved = parseQuotaInteger(value.reserved);
  if (balance === null || reserved === null || reserved > balance) return null;
  return { balance, reserved };
}

function parseQuotaInteger(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const numeric = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}
