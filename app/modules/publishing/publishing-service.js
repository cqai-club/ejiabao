const DEFAULT_PLATFORMS = ["douyin", "xiaohongshu", "wechat-video", "bilibili"];

/** 多平台发布状态服务；真实平台授权和上传由桌面端/服务端 connector 接入。 */
export function createPublishingService({ storage, eventBus, connector = null }) {
  const KEY = "publishing";

  function get(workId) {
    return storage.get(KEY, {})[workId] || Object.fromEntries(DEFAULT_PLATFORMS.map(platform => [platform, { status: "not-published" }]));
  }

  function set(workId, platform, patch) {
    const all = storage.get(KEY, {});
    all[workId] = { ...get(workId), [platform]: { ...get(workId)[platform], ...patch, updatedAt: new Date().toISOString() } };
    storage.set(KEY, all);
    eventBus.emit("publishing:updated", { workId, platform, status: all[workId][platform] });
    return all[workId][platform];
  }

  async function publish(work, platforms = DEFAULT_PLATFORMS) {
    if (!work?.id) throw new Error("发布作品缺少唯一 ID。");
    const results = {};
    for (const platform of platforms) {
      set(work.id, platform, { status: "publishing", message: "正在提交" });
      try {
        const result = connector?.publish
          ? await connector.publish({ work, platform })
          : { status: "connected", message: "等待正式平台连接" };
        results[platform] = set(work.id, platform, result);
      } catch (error) {
        results[platform] = set(work.id, platform, { status: "failed", message: error.message });
      }
    }
    eventBus.emit("publishing:completed", { workId: work.id, results });
    return results;
  }

  return { get, set, publish, platforms: [...DEFAULT_PLATFORMS], configured: Boolean(connector?.publish) };
}
