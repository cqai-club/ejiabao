import { reactive, ref } from "vue";
import { currentRuntime, isApiAuthenticated, waitForRuntime } from "@/lib/runtime";

const fallbackProfile = {
  name: "个人创作者",
  email: "",
  phone: "",
  bio: "把灵感交给云端，也把最后的判断留在自己手里。",
  avatar: ""
};

export function useProfile() {
  const profile = reactive({ ...fallbackProfile });
  const loading = ref(false);
  const saving = ref(false);
  const message = ref("");
  const error = ref("");

  async function load() {
    loading.value = true;
    error.value = "";
    try {
      const runtime = await waitForRuntime();
      if (!runtime) throw new Error("运行层尚未就绪，请稍后重试。");
      const service = runtime.modules?.profile;
      if (!service?.get) throw new Error("个人资料服务尚未就绪，请稍后重试。");
      Object.assign(profile, service.get() || fallbackProfile);
      if (!isApiAuthenticated(runtime.session?.read?.())) return;
      if (!runtime.http?.get) throw new Error("网络服务尚未就绪，请稍后重试。");
      const response = await runtime.http.get("/v1/me", { timeoutMs: 30000 });
      const user = response?.data?.user;
      if (user) {
        Object.assign(profile, {
          name: user.nickname || profile.name,
          email: user.email || profile.email,
          phone: user.phone || profile.phone,
          bio: user.bio ?? profile.bio,
          avatar: user.avatarUrl ?? profile.avatar
        });
      }
    } catch (cause: any) {
      // A local profile is still useful when the API is offline.
      error.value = cause?.message || "资料读取失败，当前显示本地缓存。";
    } finally {
      loading.value = false;
    }
  }

  async function save() {
    saving.value = true;
    error.value = "";
    message.value = "";
    try {
      const runtime = currentRuntime() || await waitForRuntime();
      if (!runtime) throw new Error("运行层尚未就绪，请稍后重试。");
      const service = runtime.modules?.profile;
      if (!service?.update) throw new Error("个人资料服务尚未就绪，请稍后重试。");
      const localPatch = {
        name: profile.name.trim() || fallbackProfile.name,
        bio: profile.bio.trim(),
        avatar: profile.avatar || ""
      };
      service.update(localPatch);
      if (!isApiAuthenticated(runtime.session?.read?.())) {
        message.value = "资料已保存到本机；登录正式账号后可同步云端。";
        return;
      }
      if (!runtime.http?.patch) throw new Error("网络服务尚未就绪，请稍后重试。");
      const response = await runtime.http.patch("/v1/me", {
        nickname: localPatch.name,
        bio: localPatch.bio,
        // Send an empty string as well so clearing the avatar is reflected remotely.
        avatarUrl: localPatch.avatar
      }, { timeoutMs: 30000 });
      const user = response?.data?.user;
      if (user) Object.assign(profile, {
        name: user.nickname || profile.name,
        bio: user.bio ?? profile.bio,
        avatar: user.avatarUrl ?? profile.avatar
      });
      message.value = "资料已保存。";
    } catch (cause: any) {
      error.value = cause?.message || "资料保存失败。";
    } finally {
      saving.value = false;
    }
  }

  function setAvatar(dataUrl: string) {
    profile.avatar = dataUrl;
    currentRuntime()?.modules?.profile?.setAvatar?.(dataUrl);
  }

  return { profile, loading, saving, message, error, load, save, setAvatar };
}
