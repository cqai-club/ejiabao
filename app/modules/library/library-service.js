/**
 * 作品库服务：负责作品元数据、筛选、收藏和最近使用。
 * 实际视频文件由桌面端文件服务或对象存储管理，本模块只维护可检索的索引。
 */
export function createLibraryService({ storage, eventBus }) {
  const KEY = "library";

  function list() {
    return storage.get(KEY, []);
  }

  function save(work) {
    if (!work?.id) throw new Error("作品缺少唯一 ID。");
    const items = list();
    const next = { ...work, updatedAt: new Date().toISOString() };
    const index = items.findIndex(item => item.id === work.id);
    if (index >= 0) items[index] = { ...items[index], ...next };
    else items.unshift({ createdAt: new Date().toISOString(), favorite: false, ...next });
    storage.set(KEY, items);
    eventBus.emit("library:changed", items);
    return next;
  }

  function remove(id) {
    const next = list().filter(item => item.id !== id);
    storage.set(KEY, next);
    eventBus.emit("library:changed", next);
  }

  function toggleFavorite(id) {
    const item = list().find(work => work.id === id);
    if (!item) return null;
    return save({ ...item, favorite: !item.favorite });
  }

  function recent(limit = 8) {
    return [...list()].sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)).slice(0, limit);
  }

  function filter({ status, typeKey, query } = {}) {
    const normalized = String(query || "").trim().toLowerCase();
    return list().filter(item => (!status || item.status === status)
      && (!typeKey || item.typeKey === typeKey)
      && (!normalized || `${item.title || ""} ${item.typeName || ""}`.toLowerCase().includes(normalized)));
  }

  return { list, save, remove, toggleFavorite, recent, filter };
}
