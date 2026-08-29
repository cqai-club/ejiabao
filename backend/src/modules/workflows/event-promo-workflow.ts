import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import type { RuntimeProviderConfig } from "../provider-config/provider-config-service.js";
import { createObjectStorage } from "../storage/object-storage.js";
import { createTaskService } from "../tasks/task-service.js";
import { checkWorkflowFfmpeg, resolveFfmpeg } from "./runtime-checks.js";

const eventPromoInputSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().trim().min(1).max(120).default("活动预告"),
  eventTime: z.string().trim().max(120).optional().default(""),
  location: z.string().trim().max(240).optional().default(""),
  fee: z.string().trim().max(120).optional().default(""),
  highlights: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  posterAssetId: z.string().min(1).optional(),
  qrAssetId: z.string().min(1).optional(),
  bgmAssetId: z.string().min(1).optional(),
  durationSeconds: z.coerce.number().int().min(15).max(300).default(20),
  aspect: z.enum(["9:16", "16:9", "1:1", "3:4", "4:3"]).default("9:16"),
  days: z.coerce.number().int().min(0).max(3650).optional(),
  voice: z.string().trim().max(120).optional(),
  skipLlm: z.boolean().optional().default(false),
  skipCovers: z.boolean().optional().default(false)
});

type EventPromoInput = z.infer<typeof eventPromoInputSchema>;
type AssetRef = { id: string; key: string; mimeType: string; kind: string };

type EventPromoDependencies = {
  config: AppConfig;
  storage: ReturnType<typeof createObjectStorage>;
  tasks: ReturnType<typeof createTaskService>;
  getDeepSeekRuntime: (userId: string) => Promise<RuntimeProviderConfig>;
};

export function createEventPromoWorkflowService({ config, storage, tasks, getDeepSeekRuntime }: EventPromoDependencies) {
  const running = new Map<string, ChildProcess>();
  const pending: string[] = [];
  let activeCount = 0;
  const maxConcurrent = 1;
  const workflowDir = resolve(config.EVENT_PROMO_WORKFLOW_DIR || join(process.cwd(), "workflows", "dsh-event-promo"));
  const dataDir = resolve(config.WORKFLOW_DATA_DIR || join(process.cwd(), "runtime", "workflows"));
  const pythonBin = config.EVENT_PROMO_PYTHON_BIN || config.PRODUCT_PROMO_PYTHON_BIN || "python";

  function parseInput(rawInput: unknown) { return eventPromoInputSchema.parse(normalizeEventInput(rawInput)); }

  function quote(input: EventPromoInput) {
    const units = Math.ceil(input.durationSeconds / 15);
    const credits = units * config.EVENT_PROMO_CREDITS_PER_15_SECONDS;
    return {
      credits,
      estimatedContentSeconds: input.durationSeconds,
      estimatedProcessingSeconds: Math.max(120, input.durationSeconds * 5),
      detail: `${input.durationSeconds} 秒活动预告，预计消耗 ${credits} 积分`
    };
  }

  async function checkRuntime() {
    const checks: Record<string, boolean> = { enabled: config.EVENT_PROMO_ENABLED, storage: storage.configured, workflowSource: false, python: false, ffmpeg: false };
    try { await access(join(workflowDir, "scripts", "run.py")); checks.workflowSource = true; } catch { /* reported below */ }
    checks.python = await commandAvailable(pythonBin, ["--version"]);
    const ffmpeg = await checkWorkflowFfmpeg(resolveFfmpeg(config));
    checks.ffmpeg = ffmpeg.ok;
    return { ready: Object.values(checks).every(Boolean), checks, ffmpeg, workflowDir, dataDir, concurrency: maxConcurrent };
  }

  async function create(userId: string, rawInput: unknown) {
    const input = parseInput(rawInput);
    const runtime = await checkRuntime();
    if (!runtime.ready) throw new AppError("活动预告工作流尚未具备运行条件。", "EVENT_PROMO_RUNTIME_UNAVAILABLE", 503, runtime);
    const [poster, qr, bgm] = await Promise.all([
      input.posterAssetId ? resolveAsset(userId, input.posterAssetId, "image", "poster") : null,
      input.qrAssetId ? resolveAsset(userId, input.qrAssetId, "image", "qr") : null,
      input.bgmAssetId ? resolveAsset(userId, input.bgmAssetId, "audio", "bgm") : null
    ]);
    const pricing = quote(input);
    const task = await tasks.create({ userId, projectId: input.projectId, provider: "dsh-event-promo", workflowKey: "event-promo", title: input.title, credits: pricing.credits, payload: { input, inputAssets: { poster, qr, bgm }, quote: pricing } });
    schedule(task.id);
    return { task, quote: pricing };
  }

  function schedule(taskId: string) { if (!pending.includes(taskId) && !running.has(taskId)) pending.push(taskId); drain(); }
  async function resumeQueued() {
    const runtime = await checkRuntime(); if (!runtime.ready) return 0;
    const queued = await prisma.generationTask.findMany({ where: { workflowKey: "event-promo", status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
    queued.forEach(task => schedule(task.id)); return queued.length;
  }
  function cancel(taskId: string) {
    const index = pending.indexOf(taskId); if (index >= 0) { pending.splice(index, 1); return true; }
    const child = running.get(taskId); if (!child) return false; child.kill(); return true;
  }
  function drain() { while (activeCount < maxConcurrent && pending.length) { const taskId = pending.shift(); if (!taskId) return; activeCount += 1; void execute(taskId).finally(() => { activeCount -= 1; drain(); }); } }

  async function execute(taskId: string) {
    const becameProcessing = await tasks.markProcessing(taskId); if (!becameProcessing) return;
    try {
      const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
      if (!task) throw new AppError("找不到待执行的活动预告任务。", "TASK_NOT_FOUND", 404);
      const payload = task.payload as unknown as { input?: EventPromoInput; inputAssets?: { poster?: AssetRef | null; qr?: AssetRef | null; bgm?: AssetRef | null } };
      const input = parseInput(payload.input);
      const workspace = join(dataDir, "event-promo", task.id);
      const inputDir = join(workspace, "input"); await mkdir(inputDir, { recursive: true });
      const files: Record<string, string> = {};
      for (const [name, asset] of Object.entries(payload.inputAssets || {})) {
        if (!asset) continue;
        const target = join(inputDir, `${name}${extensionFor(asset.mimeType, asset.key)}`);
        await storage.downloadToFile(asset.key, target); files[name] = target;
      }
      await tasks.updateProgress(task.id, 8);
      const deepseek = await getDeepSeekRuntime(task.userId);
      const args = [join(workflowDir, "scripts", "run.py"), "--out", workspace, "--title", input.title, "--duration", String(input.durationSeconds), "--aspect", input.aspect, "--event-time", input.eventTime, "--location", input.location, "--fee", input.fee];
      if (files.poster) args.push("--poster", files.poster);
      if (files.qr) args.push("--qr", files.qr);
      if (files.bgm) args.push("--bgm", files.bgm);
      if (input.highlights.length) args.push("--highlights", ...input.highlights);
      if (input.days !== undefined) args.push("--days", String(input.days));
      if (input.voice) args.push("--voice", input.voice);
      if (input.skipLlm || !deepseek.enabled || !deepseek.apiKey) args.push("--skip-llm");
      if (input.skipCovers) args.push("--skip-covers");
      await runPythonTask({ taskId: task.id, args, env: { ...process.env, DSH_FFMPEG: resolveFfmpeg(config), DSH_DIGITAL_HUMAN: config.DSH_DIGITAL_HUMAN || "", DSH_TTS_PYTHON: config.DSH_TTS_PYTHON || "", DSH_TTS_SCRIPT: config.DSH_TTS_SCRIPT || "", DSH_DEEPSEEK_BASE_URL: deepseek.baseUrl, DSH_DEEPSEEK_MODEL: deepseek.model, DEEPSEEK_API_KEY: deepseek.enabled ? deepseek.apiKey : "" } });
      const result = await uploadOutputs({ taskId: task.id, userId: task.userId, workspace });
      if (!result.video) throw new AppError("活动预告工作流未产出 final_video.mp4。", "EVENT_PROMO_OUTPUT_MISSING", 502);
      await tasks.markCompleted(task.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "活动预告工作流执行失败。";
      try { await tasks.markFailed(taskId, error instanceof AppError ? error.code : "EVENT_PROMO_FAILED", message); } catch { /* task may have been cancelled */ }
    } finally { running.delete(taskId); }
  }

  async function runPythonTask({ taskId, args, env }: { taskId: string; args: string[]; env: NodeJS.ProcessEnv }) {
    return await new Promise<void>((resolvePromise, reject) => {
      let output = ""; let settled = false; let lastProgress = 8;
      const child = spawn(pythonBin, args, { cwd: workflowDir, env, windowsHide: true, shell: false }); running.set(taskId, child);
      const timeout = setTimeout(() => child.kill(), config.EVENT_PROMO_TIMEOUT_SECONDS * 1_000);
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); error ? reject(error) : resolvePromise(); };
      const onLog = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-12_000); const progress = output.includes("[publish]") ? 95 : output.includes("[assemble]") ? 82 : output.includes("[audio]") ? 68 : output.includes("[visual]") ? 48 : output.includes("[script]") ? 20 : 8; if (progress > lastProgress) { lastProgress = progress; void tasks.updateProgress(taskId, progress); } };
      child.stdout?.on("data", onLog); child.stderr?.on("data", onLog);
      child.once("error", error => finish(new AppError(`无法启动活动预告执行器：${error.message}`, "EVENT_PROMO_SPAWN_FAILED", 503)));
      child.once("close", code => code === 0 ? finish() : finish(new AppError(`活动预告工作流退出异常（${code ?? "未知"}）：${output.slice(-1_500) || "未返回日志"}`, "EVENT_PROMO_PROCESS_FAILED", 502)));
    });
  }

  async function uploadOutputs({ taskId, userId, workspace }: { taskId: string; userId: string; workspace: string }) {
    const outputs: Record<string, { key: string; publicUrl: string | null }> = {};
    const definitions = [["video", "final_video.mp4", "video/mp4"], ["cover3x4", "cover_3x4.png", "image/png"], ["cover4x3", "cover_4x3.png", "image/png"], ["cover16x9", "cover_16x9.png", "image/png"], ["publishPackage", "publish_package_handoff.json", "application/json"], ["plan", "plan.json", "application/json"], ["script", "script.txt", "text/plain"], ["state", "pipeline_state.json", "application/json"]] as const;
    for (const [name, fileName, contentType] of definitions) { const source = join(workspace, fileName); if (await fileExists(source)) outputs[name] = await storage.uploadFile({ key: `users/${userId}/tasks/${taskId}/event-promo/${fileName}`, filePath: source, contentType }); }
    return { workflowKey: "event-promo", artifacts: outputs, video: outputs.video || null, publishHandoff: await readJsonIfPresent(join(workspace, "publish_package_handoff.json")), plan: await readJsonIfPresent(join(workspace, "plan.json")), completedAt: new Date().toISOString() };
  }

  async function resolveAsset(userId: string, id: string, kind: string, label: string) {
    const asset = await prisma.mediaAsset.findFirst({ where: { id, userId }, select: { id: true, storageKey: true, mimeType: true, kind: true } });
    if (!asset || asset.kind !== kind || !asset.mimeType.startsWith(`${kind}/`)) throw new AppError(`${label} 必须是当前账号上传的${kind === "image" ? "图片" : "音频"}素材。`, "EVENT_ASSET_INVALID", 422);
    return asset;
  }
  return { create, quote: (rawInput: unknown) => quote(parseInput(rawInput)), checkRuntime, cancel, resumeQueued };
}

function normalizeEventInput(rawInput: unknown) {
  const raw = asRecord(rawInput); const source = { ...raw, ...asRecord(raw.options), ...asRecord(raw.output), ...asRecord(raw.input) };
  const highlights = Array.isArray(source.highlights) ? source.highlights.map(value => String(value).trim()).filter(Boolean) : [];
  return { ...source, title: String(source.title ?? source.name ?? "活动预告").trim() || "活动预告", eventTime: String(source.eventTime ?? source.event_time ?? source.time ?? "").trim(), location: String(source.location ?? source.venue ?? "").trim(), fee: String(source.fee ?? source.price ?? "").trim(), highlights, posterAssetId: toAssetId(source.posterAssetId ?? source.poster ?? source.posterId), qrAssetId: toAssetId(source.qrAssetId ?? source.qr ?? source.qrCode ?? source.qrCodeAssetId), bgmAssetId: toAssetId(source.bgmAssetId ?? source.musicAssetId ?? source.bgm ?? source.music), durationSeconds: source.durationSeconds ?? source.duration ?? source.targetDuration ?? 20, aspect: source.aspect ?? source.ratio ?? "9:16", days: source.days === undefined || source.days === null || source.days === "" ? undefined : source.days, voice: String(source.voice ?? "").trim() || undefined, skipLlm: booleanish(source.skipLlm), skipCovers: booleanish(source.skipCovers) };
}
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function toAssetId(value: unknown) { if (typeof value === "string") return value.trim() || undefined; if (value && typeof value === "object") return String((value as Record<string, unknown>).id || (value as Record<string, unknown>).assetId || "").trim() || undefined; return undefined; }
function booleanish(value: unknown) { if (typeof value === "boolean") return value; if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()); return Boolean(value); }
async function commandAvailable(command: string, args: string[]) { return await new Promise<boolean>(resolvePromise => { const child = spawn(command, args, { windowsHide: true, shell: false }); const timeout = setTimeout(() => child.kill(), 8_000); child.once("error", () => { clearTimeout(timeout); resolvePromise(false); }); child.once("close", code => { clearTimeout(timeout); resolvePromise(code === 0); }); }); }
async function fileExists(filePath: string) { try { return (await stat(filePath)).isFile(); } catch { return false; } }
async function readJsonIfPresent(filePath: string) { try { return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>; } catch { return null; } }
function extensionFor(mimeType: string, storageKey: string) { const extension = extname(storageKey).toLowerCase(); if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension; return ({ "image/png": ".png", "image/jpeg": ".jpg", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/mp4": ".m4a" } as Record<string, string>)[mimeType] || ".bin"; }
