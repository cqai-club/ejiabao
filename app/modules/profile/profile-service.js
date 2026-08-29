const DEFAULT_PROFILE = {
  name: "个人创作者",
  avatar: "",
  bio: "把灵感交给云端，把时间留给表达。",
  email: "",
  phone: "",
  stats: { works: 0, published: 0, minutes: 68 }
};

/** 个人资料与头像的本地状态服务。 */
export function createProfileService({ storage, eventBus }) {
  const KEY = "profile";

  function get() {
    return { ...DEFAULT_PROFILE, ...storage.get(KEY, {}), stats: { ...DEFAULT_PROFILE.stats, ...storage.get(KEY, {}).stats } };
  }

  function update(patch = {}) {
    const next = { ...get(), ...patch };
    storage.set(KEY, next);
    eventBus.emit("profile:updated", next);
    return next;
  }

  function setAvatar(dataUrl) {
    if (dataUrl && !String(dataUrl).startsWith("data:image/")) throw new Error("头像必须是图片数据。");
    return update({ avatar: dataUrl || "" });
  }

  function clear() {
    storage.remove(KEY);
    eventBus.emit("profile:cleared");
    return get();
  }

  return { get, update, setAvatar, clear };
}
