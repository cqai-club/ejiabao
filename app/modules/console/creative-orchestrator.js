/**
 * 中控与产品业务的连接器。
 *
 * 它不实现六类视频的具体工作流，只负责：
 * 1. 把中控返回的计划交给用户确认；
 * 2. 确认后创建远端任务，并在本地队列登记；
 * 3. 同步远端状态、取消远端任务。
 */
export function createCreativeOrchestrator({ consoleService, queueService, libraryService, eventBus, logger }) {
  async function plan(request = {}) {
    const result = await consoleService.planCreativeTask(request);
    eventBus.emit("creative:planned", { request, result });
    return result;
  }

  async function create({ intent, plan: taskPlan = null, provider, title = "未命名创作", estimateSeconds = 0, estimatedCredits = 0, metadata = {} } = {}) {
    const result = await consoleService.createCreativeTask({
      intent,
      plan: taskPlan,
      context: { source: "creative-orchestrator", provider }
    });
    if (result.status === "unconfigured" || result.ok === false) return result;

    const localTask = queueService.createTask({
      typeKey: intent.typeKey || "",
      title,
      estimateSeconds,
      estimatedCredits,
      metadata: {
        ...metadata,
        provider: result.provider,
        remoteTaskId: result.taskId,
        plan: taskPlan
      }
    });

    if (libraryService) {
      libraryService.save({
        id: `work_${localTask.id}`,
        title,
        typeKey: intent.typeKey || "",
        status: "generating",
        remoteTaskId: result.taskId,
        provider: result.provider
      });
    }

    eventBus.emit("creative:created", { localTask, remote: result });
    return { ...result, localTask };
  }

  async function sync(localTaskId) {
    const localTask = queueService.list().find(task => task.id === localTaskId);
    const remoteTaskId = localTask?.metadata?.remoteTaskId;
    if (!localTask || !remoteTaskId) throw new Error("本地任务没有可同步的远端任务。");
    const result = await consoleService.getTaskStatus({ taskId: remoteTaskId });
    if (result.status === "unconfigured" || result.ok === false) return result;

    const mappedStatus = mapRemoteStatus(result.phase);
    const updated = queueService.update(localTaskId, {
      remoteStatus: result.phase,
      progress: result.data?.progress ?? localTask.progress,
      ...(mappedStatus && mappedStatus !== localTask.status ? { status: mappedStatus } : {})
    });
    eventBus.emit("creative:synced", { localTask: updated, remote: result });
    return { ...result, localTask: updated };
  }

  async function cancel(localTaskId) {
    const localTask = queueService.list().find(task => task.id === localTaskId);
    const remoteTaskId = localTask?.metadata?.remoteTaskId;
    if (!localTask || !remoteTaskId) throw new Error("本地任务没有可取消的远端任务。");
    const result = await consoleService.cancelTask({ taskId: remoteTaskId });
    if (result.status !== "unconfigured" && result.ok !== false && ["queued", "processing"].includes(localTask.status)) {
      queueService.cancel(localTaskId);
    }
    eventBus.emit("creative:cancelled", { localTaskId, remote: result });
    return result;
  }

  function mapRemoteStatus(status) {
    const normalized = String(status || "").toLowerCase();
    if (["queued", "pending", "waiting"].includes(normalized)) return "queued";
    if (["running", "processing", "generating"].includes(normalized)) return "processing";
    if (["completed", "success", "succeeded", "done"].includes(normalized)) return "completed";
    if (["failed", "error"].includes(normalized)) return "failed";
    if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
    logger.debug("未识别的远端任务状态", status);
    return null;
  }

  return { plan, create, sync, cancel };
}
