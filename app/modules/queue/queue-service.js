const ALLOWED_TRANSITIONS = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["queued"],
  completed: [],
  cancelled: [],
  paused: ["queued", "processing"]
};

/** 云端任务队列服务。不会包含任何一种视频类型的生成细节。 */
export function createQueueService({ storage, eventBus }) {
  const KEY = "queue";

  function list() { return storage.get(KEY, []); }

  function createTask(input = {}) {
    if (!input.typeKey) throw new Error("任务缺少创作类型。");
    const task = {
      id: input.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      typeKey: input.typeKey,
      title: input.title || "未命名创作",
      status: "queued",
      estimateSeconds: Number(input.estimateSeconds || 0),
      estimatedCredits: Number(input.estimatedCredits || 0),
      createdAt: new Date().toISOString(),
      metadata: input.metadata || {}
    };
    const next = [task, ...list()];
    storage.set(KEY, next);
    eventBus.emit("queue:created", task);
    return task;
  }

  function transition(id, nextStatus, patch = {}) {
    const items = list();
    const item = items.find(task => task.id === id);
    if (!item) throw new Error("找不到对应任务。");
    if (!ALLOWED_TRANSITIONS[item.status]?.includes(nextStatus)) {
      throw new Error(`任务不能从 ${item.status} 变更为 ${nextStatus}。`);
    }
    Object.assign(item, patch, { status: nextStatus, updatedAt: new Date().toISOString() });
    storage.set(KEY, items);
    eventBus.emit("queue:updated", item);
    return item;
  }

  /** 更新远端任务同步字段；不改变任务状态机时也可以使用。 */
  function update(id, patch = {}) {
    const items = list();
    const item = items.find(task => task.id === id);
    if (!item) throw new Error("找不到对应任务。");
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    storage.set(KEY, items);
    eventBus.emit("queue:updated", item);
    return item;
  }

  function retry(id) {
    const task = list().find(item => item.id === id);
    if (!task || task.status !== "failed") throw new Error("只有失败任务可以重试。");
    return transition(id, "queued", { retryCount: Number(task.retryCount || 0) + 1, failureReason: "" });
  }

  function cancel(id) {
    const task = list().find(item => item.id === id);
    if (!task || !["queued", "processing"].includes(task.status)) throw new Error("当前任务不可取消。");
    return transition(id, "cancelled");
  }

  return { list, createTask, transition, update, retry, cancel };
}
