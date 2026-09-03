import { reactive, ref } from "vue";
import { currentRuntime, isApiAuthenticated, waitForRuntime } from "@/lib/runtime";

export type Provider = "codex" | "deepseek-harness";
export type AccessMode = "custom" | "platform";

const fallbackProviders = [
  { provider: "codex", label: "Codex", accessMode: "PLATFORM", baseUrl: "", model: "", reasoningEffort: "medium", enabled: true, apiKeyConfigured: false, apiKeyMasked: "平台托管" },
  { provider: "deepseek-harness", label: "DeepSeek Harness", accessMode: "PLATFORM", baseUrl: "", model: "", reasoningEffort: "", enabled: true, apiKeyConfigured: false, apiKeyMasked: "平台托管" }
];

export function useModelConfig() {
  const mode = ref<AccessMode>("platform");
  const available = ref(false);
  const loading = ref(false);
  const savingProvider = ref<Provider | "platform" | "">("");
  const testingProvider = ref<Provider | "">("");
  const message = ref("");
  const error = ref("");
  const providers = reactive<Record<Provider, any>>({
    codex: { ...fallbackProviders[0], apiKey: "" },
    "deepseek-harness": { ...fallbackProviders[1], apiKey: "" }
  });

  function syncConfigs(configs: any[] = [], isAvailable = false) {
    available.value = isAvailable;
    for (const fallback of fallbackProviders) {
      const next = configs.find(item => item.provider === fallback.provider) || fallback;
      Object.assign(providers[fallback.provider as Provider], next, { apiKey: "" });
    }
    mode.value = configs.some(item => item.accessMode === "CUSTOM") ? "custom" : "platform";
  }

  async function load() {
    loading.value = true;
    error.value = "";
    try {
      const runtime = await waitForRuntime();
      if (!runtime) throw new Error("运行层尚未就绪，请稍后重试。");
      const service = runtime.modules?.modelConfig;
      if (!service?.list) throw new Error("模型配置服务尚未就绪，请稍后重试。");
      if (!isApiAuthenticated(runtime.session?.read?.())) {
        syncConfigs(fallbackProviders, false);
        return;
      }
      const result = await service.list();
      syncConfigs(result?.configs || [], Boolean(result?.available));
    } catch (cause: any) {
      syncConfigs(fallbackProviders, false);
      error.value = cause?.message || "模型配置读取失败。";
    } finally {
      loading.value = false;
    }
  }

  async function save(provider: Provider) {
    const config = providers[provider];
    savingProvider.value = provider;
    message.value = "";
    error.value = "";
    try {
      if (!config.baseUrl.trim() || !config.model.trim()) {
        throw new Error("请先填写接口地址和模型名称。");
      }
      const runtime = currentRuntime() || await waitForRuntime();
      assertApiReady(runtime, "保存模型配置");
      const service = runtime.modules?.modelConfig;
      const payload = {
        accessMode: "CUSTOM",
        baseUrl: config.baseUrl.trim(),
        model: config.model.trim(),
        reasoningEffort: provider === "codex" ? config.reasoningEffort || "medium" : undefined,
        apiKey: config.apiKey.trim() || undefined,
        enabled: true
      };
      if (!service?.save) throw new Error("模型配置服务尚未就绪，请稍后重试。");
      const next = await service.save(provider, payload);
      Object.assign(config, next || payload, { apiKey: "" });
      mode.value = "custom";
      message.value = `${config.label} 配置已安全保存。`;
    } catch (cause: any) {
      error.value = cause?.message || "模型配置保存失败。";
    } finally {
      savingProvider.value = "";
    }
  }

  async function test(provider: Provider) {
    testingProvider.value = provider;
    message.value = "";
    error.value = "";
    try {
      const runtime = currentRuntime() || await waitForRuntime();
      assertApiReady(runtime, "测试模型连接");
      const service = runtime.modules?.modelConfig;
      if (!service?.test) throw new Error("模型配置服务尚未就绪，请稍后重试。");
      const result = await service.test(provider);
      message.value = `${providers[provider].label} 连接成功${result?.model ? ` · ${result.model}` : ""}。`;
    } catch (cause: any) {
      error.value = cause?.message || "连接测试失败。";
    } finally {
      testingProvider.value = "";
    }
  }

  async function usePlatform() {
    savingProvider.value = "platform";
    message.value = "";
    error.value = "";
    try {
      const runtime = currentRuntime() || await waitForRuntime();
      assertApiReady(runtime, "切换平台积分调用");
      const service = runtime.modules?.modelConfig;
      if (!service?.save) throw new Error("模型配置服务尚未就绪，请稍后重试。");
      await Promise.all((Object.keys(providers) as Provider[]).map(provider => service.save(provider, { accessMode: "PLATFORM" })));
      mode.value = "platform";
      await load();
      message.value = "已切换为平台积分调用。";
    } catch (cause: any) {
      error.value = cause?.message || "切换平台调用失败。";
    } finally {
      savingProvider.value = "";
    }
  }

  return { mode, available, loading, savingProvider, testingProvider, message, error, providers, load, save, test, usePlatform };
}

function assertApiReady(runtime: EjiabaoRuntime | null, action: string): asserts runtime is EjiabaoRuntime {
  if (!runtime) throw new Error("运行层尚未就绪，请稍后重试。");
  if (!isApiAuthenticated(runtime.session?.read?.())) {
    throw new Error(`请登录正式账号后再${action}。`);
  }
}
