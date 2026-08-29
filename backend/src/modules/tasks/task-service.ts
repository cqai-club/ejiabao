import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { createQuotaService } from "../quota/quota-service.js";

export function createTaskService() {
  const quota = createQuotaService();

  async function create({ userId, projectId, provider, workflowKey, title, credits, payload }: { userId: string; projectId?: string; provider: string; workflowKey: string; title: string; credits: number; payload: Record<string, unknown> }) {
    const task = await prisma.$transaction(async (tx: any) => {
      const created = await tx.generationTask.create({ data: { userId, projectId, provider, workflowKey, status: "QUEUED", creditsReserved: credits, payload: { title, ...payload } } });
      await quota.reserveInTransaction(tx, { userId, amount: credits, reason: `任务 ${created.id} 预留额度`, taskId: created.id });
      return created;
    });
    return task;
  }

  async function get(userId: string, id: string) {
    const task = await prisma.generationTask.findFirst({ where: { id, userId } });
    if (!task) throw new AppError("找不到任务。", "TASK_NOT_FOUND", 404);
    return task;
  }

  async function list(userId: string, options: { limit?: number; status?: string } = {}) {
    const limit = Math.max(1, Math.min(100, Math.round(Number(options.limit || 50))));
    const status = options.status && ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"].includes(options.status)
      ? options.status as any
      : undefined;
    return prisma.generationTask.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  async function cancel(userId: string, id: string) {
    const task = await get(userId, id);
    if (!["QUEUED", "PROCESSING"].includes(task.status)) throw new AppError("当前任务不可取消。", "TASK_NOT_CANCELLABLE", 409);
    const updated = await prisma.generationTask.update({ where: { id }, data: { status: "CANCELLED" } });
    await quota.release(userId, task.creditsReserved, id, "用户取消任务释放额度");
    return updated;
  }

  /** 仅由服务端工作流执行器调用，避免客户端篡改任务进度。 */
  async function markProcessing(id: string) {
    const result = await prisma.generationTask.updateMany({ where: { id, status: "QUEUED" }, data: { status: "PROCESSING", progress: 1 } });
    return result.count === 1;
  }

  /** 仅更新运行中的任务；取消后的后台子进程不能再改写任务状态。 */
  async function updateProgress(id: string, progress: number) {
    await prisma.generationTask.updateMany({
      where: { id, status: "PROCESSING" },
      data: { progress: Math.max(1, Math.min(99, Math.round(progress))) }
    });
  }

  async function markCompleted(id: string, result: Record<string, unknown>) {
    const task = await prisma.generationTask.findUnique({ where: { id } });
    if (!task) throw new AppError("找不到任务。", "TASK_NOT_FOUND", 404);
    if (task.status === "CANCELLED") return task;
    if (task.status === "COMPLETED") return task;
    if (task.status !== "PROCESSING") throw new AppError("任务当前不处于可完成状态。", "TASK_STATE_INVALID", 409);
    const updated = await prisma.generationTask.update({ where: { id }, data: { status: "COMPLETED", progress: 100, result: result as any } });
    await quota.settle(task.userId, task.creditsReserved, id);
    return updated;
  }

  async function markFailed(id: string, errorCode: string, errorMessage: string) {
    const task = await prisma.generationTask.findUnique({ where: { id } });
    if (!task) throw new AppError("找不到任务。", "TASK_NOT_FOUND", 404);
    if (task.status === "CANCELLED") return task;
    if (task.status === "FAILED") return task;
    if (task.status !== "PROCESSING") throw new AppError("任务当前不处于可失败状态。", "TASK_STATE_INVALID", 409);
    const updated = await prisma.generationTask.update({ where: { id }, data: { status: "FAILED", errorCode, errorMessage } });
    await quota.release(task.userId, task.creditsReserved, id, "生成失败释放额度");
    return updated;
  }

  return { create, get, list, cancel, markProcessing, updateProgress, markCompleted, markFailed };
}
