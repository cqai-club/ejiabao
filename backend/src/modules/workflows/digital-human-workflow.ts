import { access, mkdir, readFile, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import type { AppConfig } from "../../config.js";
import type { RuntimeProviderConfig } from "../provider-config/provider-config-service.js";
import type { createInferFlowService } from "../inferflow/inferflow-service.js";
import { createObjectStorage } from "../storage/object-storage.js";
import { createTaskService } from "../tasks/task-service.js";

const digitalHumanInputSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().trim().min(1).max(120).default("知识口播"),
  script: z.string().trim().min(2).max(20_000),
  avatarAssetId: z.string().min(1).optional(),
  presenterAssetId: z.string().min(1).optional(),
  voiceAssetId: z.string().min(1).optional(),
  voiceReferenceAssetId: z.string().min(1).optional(),
  aspect: z.enum(["9:16", "16:9", "1:1", "3:4", "4:3"]).default("9:16"),
  segmentationMode: z.enum(["fast_segments", "long_segments"]).default("fast_segments")
});

type DigitalHumanInput = z.infer<typeof digitalHumanInputSchema>;
type DigitalHumanDependencies = {
  config: AppConfig;
  storage: ReturnType<typeof createObjectStorage>;
  tasks: ReturnType<typeof createTaskService>;
  inferflow: ReturnType<typeof createInferFlowService>;
  getInferFlowRuntime: () => Promise<RuntimeProviderConfig>;
};

export function createDigitalHumanWorkflowService({ config, storage, tasks, inferflow, getInferFlowRuntime }: DigitalHumanDependencies) {
  const pending: string[] = [];
  const running = new Set<string>();
  const maxConcurrent = 1;
  const dataDir = resolve(config.WORKFLOW_DATA_DIR || join(process.cwd(), "runtime", "workflows"));

  function parseInput(rawInput: unknown) {
    const raw = asRecord(rawInput);
    const source = { ...raw, ...asRecord(raw.options), ...asRecord(raw.input), ...asRecord(raw.output) };
    const assets = Array.isArray(source.assets) ? source.assets.map(asRecord) : [];
    const image = assets.find(asset => asset.kind === "image" || asset.role === "avatar");
    const audio = assets.find(asset => asset.kind === "audio" || asset.role === "voice-reference");
    return digitalHumanInputSchema.parse({
      ...source,
      title: source.title || "知识口播",
      script: source.script ?? source.scriptText ?? source.instruction ?? "",
      avatarAssetId: source.avatarAssetId || source.presenterAssetId || image?.id,
      presenterAssetId: source.presenterAssetId || source.avatarAssetId || image?.id,
      voiceAssetId: source.voiceAssetId || source.voiceReferenceAssetId || audio?.id,
      voiceReferenceAssetId: source.voiceReferenceAssetId || source.voiceAssetId || audio?.id,
      segmentationMode: source.segmentationMode || source.segmentation_mode || "fast_segments"
    });
  }

  function quote(rawInput: unknown) {
    const input = parseInput(rawInput);
    const estimatedContentSeconds = Math.max(10, Math.ceil(input.script.length / 4.2));
    const credits = Math.max(10, estimatedContentSeconds * 3);
    return {
      credits,
      estimatedContentSeconds,
      estimatedProcessingSeconds: Math.max(180, estimatedContentSeconds * 5),
      detail: `知识口播预计 ${estimatedContentSeconds} 秒，按 InferFlow 数字人生成计费`
    };
  }

  async function checkRuntime() {
    const runtime = await getInferFlowRuntime();
    const checks = {
      enabled: runtime.enabled,
      apiKey: Boolean(runtime.apiKey),
      endpoint: Boolean(runtime.baseUrl),
      storage: storage.configured,
      workflowSource: true
    };
    return { ready: Object.values(checks).every(Boolean), checks, workflowDir: "inferflow:digital_human_standard", dataDir, concurrency: maxConcurrent };
  }

  async function create(userId: string, rawInput: unknown) {
    const input = parseInput(rawInput);
    const runtime = await checkRuntime();
    if (!runtime.ready) throw new AppError("数字人口播执行器尚未就绪，请检查 InferFlow 启用状态、API Key 和素材存储。", "DIGITAL_HUMAN_RUNTIME_UNAVAILABLE", 503, runtime);
    const avatar = await resolveAsset(userId, input.avatarAssetId || input.presenterAssetId || "", "image", "人像图片");
    const voice = await resolveAsset(userId, input.voiceAssetId || input.voiceReferenceAssetId || "", "audio", "参考音频");
    const pricing = quote(input);
    const task = await tasks.create({
      userId,
      projectId: input.projectId,
      provider: "inferflow",
      workflowKey: "talking-head",
      title: input.title,
      credits: pricing.credits,
      payload: { input, inputAssets: { avatar: assetPayload(avatar), voice: assetPayload(voice) }, quote: pricing }
    });
    schedule(task.id);
    return { task, quote: pricing };
  }

  function schedule(taskId: string) {
    if (!pending.includes(taskId) && !running.has(taskId)) pending.push(taskId);
    drain();
  }

  async function resumeQueued() {
    const runtime = await checkRuntime();
    if (!runtime.ready) return 0;
    const rows = await prisma.generationTask.findMany({ where: { workflowKey: "talking-head", status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
    rows.forEach(row => schedule(row.id));
    return rows.length;
  }

  function cancel(taskId: string) {
    const index = pending.indexOf(taskId);
    if (index >= 0) { pending.splice(index, 1); return true; }
    void cancelRemote(taskId);
    return running.has(taskId);
  }

  function drain() {
    while (running.size < maxConcurrent && pending.length) {
      const taskId = pending.shift();
      if (!taskId) return;
      running.add(taskId);
      void execute(taskId).finally(() => { running.delete(taskId); drain(); });
    }
  }

  async function execute(taskId: string) {
    if (!await tasks.markProcessing(taskId)) return;
    try {
      const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
      if (!task) throw new AppError("找不到待执行的数字人口播任务。", "TASK_NOT_FOUND", 404);
      const payload = asRecord(task.payload);
      const input = parseInput(payload.input);
      const assets = asRecord(payload.inputAssets);
      const workspace = join(dataDir, "digital-human", task.id);
      await mkdir(workspace, { recursive: true });
      const avatarPath = join(workspace, `avatar${extensionFor(asRecord(assets.avatar).mimeType, asRecord(assets.avatar).key)}`);
      const voicePath = join(workspace, `voice${extensionFor(asRecord(assets.voice).mimeType, asRecord(assets.voice).key)}`);
      await storage.downloadToFile(String(asRecord(assets.avatar).key), avatarPath);
      await storage.downloadToFile(String(asRecord(assets.voice).key), voicePath);
      await tasks.updateProgress(task.id, 12);

      const runtime = await getInferFlowRuntime();
      const avatarData = await readFile(avatarPath);
      const voiceData = await readFile(voicePath);
      const avatarRemote = await inferflow.uploadMaterial(runtime, "avatar", { data: avatarData, filename: "avatar" + extname(avatarPath), mimeType: String(asRecord(assets.avatar).mimeType || "image/png") });
      await tasks.updateProgress(task.id, 22);
      const voiceRemote = await inferflow.uploadMaterial(runtime, "voice", { data: voiceData, filename: "voice" + extname(voicePath), mimeType: String(asRecord(assets.voice).mimeType || "audio/wav") });
      const created = await inferflow.createRun(runtime, {
        avatar_id: avatarRemote.id,
        voice_id: voiceRemote.id,
        script_text: input.script,
        segmentation_mode: input.segmentationMode
      });
      await prisma.generationTask.update({ where: { id: task.id }, data: { remoteTaskId: created.runId } });
      await tasks.updateProgress(task.id, 30);

      const completed = await pollRun(task.id, runtime, created.runId);
      const outputs = await collectOutputs(runtime, created.runId, completed, task.userId, task.id);
      await tasks.markCompleted(task.id, { workflowKey: "talking-head", remoteRunId: created.runId, aspect: input.aspect, outputs: outputs.artifacts, video: outputs.video, completedAt: new Date().toISOString() });
      await rm(workspace, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "数字人口播工作流执行失败。";
      try { await tasks.markFailed(taskId, error instanceof AppError ? error.code : "DIGITAL_HUMAN_FAILED", message); } catch { /* task may have been cancelled */ }
    }
  }

  async function pollRun(taskId: string, runtime: RuntimeProviderConfig, runId: string) {
    const deadline = Date.now() + Math.max(10 * 60_000, config.PRODUCT_PROMO_TIMEOUT_SECONDS * 1_000);
    while (Date.now() < deadline) {
      const status = await inferflow.getRun(runtime, runId);
      const state = String(status?.status || status?.run?.status || "").toLowerCase();
      const progress = Number(status?.progress_percent ?? status?.progress ?? 0);
      if (Number.isFinite(progress) && progress > 0) await tasks.updateProgress(taskId, Math.min(98, Math.max(30, Math.round(progress))));
      if (["completed", "success", "succeeded"].includes(state)) return status;
      if (["failed", "canceled", "cancelled"].includes(state)) throw new AppError(String(status?.error_message || status?.error?.message || "InferFlow 数字人任务失败。"), "INFERFLOW_RUN_FAILED", 502);
      await new Promise(resolvePromise => setTimeout(resolvePromise, 3_000));
    }
    throw new AppError("InferFlow 数字人任务等待超时。", "INFERFLOW_RUN_TIMEOUT", 504);
  }

  async function collectOutputs(runtime: RuntimeProviderConfig, runId: string, status: any, userId: string, taskId: string) {
    const payload = await inferflow.getOutputs(runtime, runId).catch(() => status?.outputs || {});
    const entries = outputEntries(payload, status);
    const artifacts: Record<string, { key: string; publicUrl: string | null }> = {};
    let video: { key: string; publicUrl: string | null } | null = null;
    const workspace = join(dataDir, "digital-human", taskId, "outputs");
    await mkdir(workspace, { recursive: true });
    for (const raw of entries) {
      const output = asRecord(raw);
      const name = String(output.name || output.output_name || "output").replace(/[^a-zA-Z0-9_-]/g, "_");
      const data = await inferflow.downloadOutput(runtime, runId, output);
      if (!data) continue;
      const format = String(output.format || output.mime_type || "bin").split("/").pop() || "bin";
      const localPath = join(workspace, `${name}.${format === "mp4" ? "mp4" : format}`);
      await import("node:fs/promises").then(fs => fs.writeFile(localPath, data));
      const artifact = await storage.uploadFile({ key: `users/${userId}/tasks/${taskId}/talking-head/${name}.${format}`, filePath: localPath, contentType: String(output.mime_type || mimeForFormat(format)) });
      artifacts[name] = artifact;
      if (!video && (String(output.type || "").toLowerCase() === "video" || format === "mp4" || /video|mp4/i.test(name))) video = artifact;
    }
    return { artifacts, video };
  }

  /**
   * A completed InferFlow run may predate the output-shape fix and therefore
   * have an empty local result even though the remote run still has a video.
   * Hydrate that result on the first review request so existing tasks recover
   * without being submitted again.
   */
  async function ensureCompletedOutputs(taskId: string) {
    const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
    if (!task || task.workflowKey !== "talking-head" || task.status !== "COMPLETED" || !task.remoteTaskId) return task;
    const current = asRecord(task.result);
    if (asRecord(current.video).key) return task;

    try {
      const runtime = await getInferFlowRuntime();
      const status = await inferflow.getRun(runtime, task.remoteTaskId);
      const outputs = await collectOutputs(runtime, task.remoteTaskId, status, task.userId, task.id);
      if (!outputs.video) return task;
      const result = {
        ...current,
        workflowKey: current.workflowKey || "talking-head",
        remoteRunId: current.remoteRunId || task.remoteTaskId,
        outputs: { ...asRecord(current.outputs), ...outputs.artifacts },
        video: outputs.video,
        completedAt: current.completedAt || new Date().toISOString()
      };
      return prisma.generationTask.update({ where: { id: task.id }, data: { result: result as any } });
    } catch {
      // Keep the completed task readable even when the remote output is
      // temporarily unavailable; the next review request can retry hydration.
      return task;
    } finally {
      await rm(join(dataDir, "digital-human", task.id), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function cancelRemote(taskId: string) {
    try {
      const task = await prisma.generationTask.findUnique({ where: { id: taskId }, select: { remoteTaskId: true } });
      if (task?.remoteTaskId) await inferflow.cancelRun(await getInferFlowRuntime(), task.remoteTaskId);
    } catch { /* best effort */ }
  }

  return { create, quote, checkRuntime, cancel, resumeQueued, ensureCompletedOutputs };
}

async function resolveAsset(userId: string, id: string, kind: string, label: string) {
  if (!id) throw new AppError(`请先上传${label}。`, "DIGITAL_HUMAN_INPUT_MISSING", 422);
  const asset = await prisma.mediaAsset.findFirst({ where: { id, userId }, select: { id: true, storageKey: true, mimeType: true, kind: true, sizeBytes: true, metadata: true } });
  if (!asset || asset.kind !== kind) throw new AppError(`${label}素材无效或不属于当前账号。`, "DIGITAL_HUMAN_ASSET_INVALID", 422);
  return asset;
}

function assetPayload(asset: any) { return { id: asset.id, key: asset.storageKey, mimeType: asset.mimeType, sizeBytes: Number(asset.sizeBytes) }; }
function extensionFor(mimeType: unknown, key: unknown) { const ext = extname(String(key || "")); if (ext) return ext; const mime = String(mimeType || ""); return mime.includes("png") ? ".png" : mime.includes("jpeg") ? ".jpg" : mime.includes("mpeg") ? ".mp3" : ".bin"; }
function mimeForFormat(format: string) { if (format === "mp4") return "video/mp4"; if (format === "mp3") return "audio/mpeg"; if (format === "png") return "image/png"; if (format === "json") return "application/json"; return "application/octet-stream"; }
function asRecord(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }

function outputEntries(payload: any, status: any) {
  const candidates = [
    payload,
    payload?.items,
    payload?.outputs,
    status?.outputs,
    status?.items
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(asRecord);
  }
  const object = asRecord(payload?.outputs || payload || status?.outputs || {});
  return Object.entries(object).map(([name, value]) => ({ name, ...asRecord(value) }));
}
