import { z } from "zod";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import type { createDeepSeekService } from "../deepseek/deepseek-service.js";
import type { createProviderConfigService } from "../provider-config/provider-config-service.js";
import type { createTaskService } from "../tasks/task-service.js";
import type { createWorkflowDispatcher } from "./workflow-dispatcher.js";

const orchestrationRequestSchema = z.object({
  instruction: z.string().trim().min(2).max(8_000),
  typeKey: z.string().trim().max(80).optional(),
  assets: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    kind: z.enum(["image", "video", "audio", "other"]),
    name: z.string().trim().max(240).optional()
  })).max(40).default([]),
  options: z.record(z.string(), z.unknown()).default({}),
  context: z.record(z.string(), z.unknown()).default({})
});

type Dependencies = {
  deepseek: ReturnType<typeof createDeepSeekService>;
  providerConfigs: ReturnType<typeof createProviderConfigService>;
  dispatcher: ReturnType<typeof createWorkflowDispatcher>;
  tasks: ReturnType<typeof createTaskService>;
};

export function createOrchestrationService({ deepseek, providerConfigs, dispatcher, tasks }: Dependencies) {
  async function listWorkflows(userId: string) {
    return dispatcher.catalog(userId);
  }

  async function plan(userId: string, rawRequest: unknown) {
    const request = orchestrationRequestSchema.parse(rawRequest);
    const [workflowCatalog, runtime] = await Promise.all([
      dispatcher.catalog(userId),
      providerConfigs.getRuntimeForUser(userId, "deepseek-harness")
    ]);
    const modelResult = await deepseek.planWorkflowTask({
      ...request,
      catalog: workflowCatalog.map(({ runtime: _runtime, ...item }) => item),
      runtime
    });
    const prepared = dispatcher.prepare(modelResult.plan, request, workflowCatalog);
    const run = await prisma.orchestrationRun.create({
      data: {
        userId,
        instruction: request.instruction,
        typeKey: prepared.typeKey,
        workflowKey: prepared.workflowKey,
        status: prepared.executable ? "PLANNED" : "BLOCKED",
        plan: {
          title: prepared.title,
          summary: prepared.summary,
          steps: prepared.steps,
          missingInputs: prepared.missingInputs,
          executable: prepared.executable
        } as any,
        workflowInput: prepared.workflowInput as any,
        quote: prepared.quote as any,
        blockers: prepared.blockers as any,
        model: modelResult.model,
        responseId: modelResult.responseId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });
    return serializeRun(run);
  }

  async function get(userId: string, runId: string) {
    const run = await prisma.orchestrationRun.findFirst({
      where: { id: runId, userId },
      include: { task: true }
    });
    if (!run) throw new AppError("调度计划不存在。", "ORCHESTRATION_RUN_NOT_FOUND", 404);
    return serializeRun(run);
  }

  async function execute(userId: string, runId: string) {
    const current = await prisma.orchestrationRun.findFirst({ where: { id: runId, userId }, include: { task: true } });
    if (!current) throw new AppError("调度计划不存在。", "ORCHESTRATION_RUN_NOT_FOUND", 404);
    if (current.status === "DISPATCHED" && current.task) return serializeRun(current);
    if (current.status === "BLOCKED") throw new AppError("该计划仍缺少执行条件，请补充素材或安装执行器后重新规划。", "ORCHESTRATION_RUN_BLOCKED", 409, { blockers: current.blockers });
    if (current.expiresAt.getTime() <= Date.now()) {
      await prisma.orchestrationRun.updateMany({ where: { id: runId, userId, status: "PLANNED" }, data: { status: "EXPIRED" } });
      throw new AppError("该调度计划已过期，请重新规划。", "ORCHESTRATION_RUN_EXPIRED", 409);
    }

    const lock = await prisma.orchestrationRun.updateMany({
      where: { id: runId, userId, status: "PLANNED" },
      data: { status: "DISPATCHING", approvedAt: new Date() }
    });
    if (lock.count !== 1) {
      const latest = await prisma.orchestrationRun.findFirst({ where: { id: runId, userId }, include: { task: true } });
      if (latest?.status === "DISPATCHED" && latest.task) return serializeRun(latest);
      throw new AppError("该计划正在调度或已经处理，请稍后刷新状态。", "ORCHESTRATION_RUN_BUSY", 409, { status: latest?.status });
    }

    try {
      const created = await dispatcher.dispatch(userId, current.workflowKey, current.workflowInput);
      const updated = await prisma.orchestrationRun.updateMany({
        where: { id: runId, userId, status: "DISPATCHING" },
        data: { status: "DISPATCHED", taskId: created.task.id, dispatchedAt: new Date() }
      });
      if (updated.count !== 1) {
        await tasks.cancel(userId, created.task.id);
        dispatcher.cancel(current.workflowKey, created.task.id);
        throw new AppError("调度计划已取消，生成任务未继续执行。", "ORCHESTRATION_RUN_CANCELLED", 409);
      }
      return get(userId, runId);
    } catch (error) {
      await prisma.orchestrationRun.updateMany({
        where: { id: runId, userId, status: "DISPATCHING" },
        data: { status: "FAILED" }
      });
      throw error;
    }
  }

  async function cancel(userId: string, runId: string) {
    const current = await prisma.orchestrationRun.findFirst({ where: { id: runId, userId }, include: { task: true } });
    if (!current) throw new AppError("调度计划不存在。", "ORCHESTRATION_RUN_NOT_FOUND", 404);
    if (current.taskId && current.task && !["COMPLETED", "FAILED", "CANCELLED"].includes(current.task.status)) {
      await tasks.cancel(userId, current.taskId);
      dispatcher.cancel(current.workflowKey, current.taskId);
    }
    if (!["DISPATCHED", "FAILED", "CANCELLED", "EXPIRED"].includes(current.status)) {
      await prisma.orchestrationRun.update({ where: { id: runId }, data: { status: "CANCELLED" } });
    }
    return get(userId, runId);
  }

  return { listWorkflows, plan, get, execute, cancel };
}

function serializeRun(run: any) {
  const plan = asRecord(run.plan);
  const blockers = Array.isArray(run.blockers) ? run.blockers : [];
  return {
    id: run.id,
    provider: run.provider,
    instruction: run.instruction,
    typeKey: run.typeKey,
    workflowKey: run.workflowKey,
    status: run.status,
    title: String(plan.title || "创作调度计划"),
    summary: String(plan.summary || ""),
    steps: Array.isArray(plan.steps) ? plan.steps : [],
    missingInputs: Array.isArray(plan.missingInputs) ? plan.missingInputs : [],
    executable: Boolean(plan.executable) && run.status === "PLANNED",
    workflowInput: asRecord(run.workflowInput),
    quote: asRecord(run.quote),
    blockers,
    model: run.model,
    responseId: run.responseId,
    expiresAt: run.expiresAt,
    createdAt: run.createdAt,
    task: run.task || null
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
