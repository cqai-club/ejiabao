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

const vlogEditInputSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().trim().min(1).max(120).default("VLOG"),
  videoAssetIds: z.array(z.string().min(1)).min(1).max(24),
  script: z.string().trim().max(2_000).optional().default(""),
  durationSeconds: z.coerce.number().int().min(15).max(300).default(60),
  aspect: z.enum(["9:16", "16:9", "1:1", "3:4", "4:3"]).default("9:16"),
  bgmAssetId: z.string().min(1).optional(),
  skipLlm: z.boolean().optional().default(false),
  skipCovers: z.boolean().optional().default(false)
});

type VlogEditInput = z.infer<typeof vlogEditInputSchema>;

type VlogEditDependencies = {
  config: AppConfig;
  storage: ReturnType<typeof createObjectStorage>;
  tasks: ReturnType<typeof createTaskService>;
  getDeepSeekRuntime: (userId: string) => Promise<RuntimeProviderConfig>;
};

export function createVlogEditWorkflowService({ config, storage, tasks, getDeepSeekRuntime }: VlogEditDependencies) {
  const running = new Map<string, ChildProcess>();
  const pending: string[] = [];
  let activeCount = 0;
  const maxConcurrent = 1;

  const workflowDir = resolve(config.VLOG_EDIT_WORKFLOW_DIR || join(process.cwd(), "workflows", "dsh-vlog-edit"));
  const dataDir = resolve(config.WORKFLOW_DATA_DIR || join(process.cwd(), "runtime", "workflows"));
  const pythonBin = config.VLOG_EDIT_PYTHON_BIN || config.PRODUCT_PROMO_PYTHON_BIN || "python";

  function parseInput(rawInput: unknown) {
    return vlogEditInputSchema.parse(normalizeVlogInput(rawInput));
  }

  function quote(input: VlogEditInput) {
    const units = Math.ceil(input.durationSeconds / 15);
    const credits = units * config.VLOG_EDIT_CREDITS_PER_15_SECONDS;
    return {
      credits,
      estimatedContentSeconds: input.durationSeconds,
      estimatedProcessingSeconds: Math.max(90, input.durationSeconds * 2),
      detail: `${input.durationSeconds} 秒 VLOG 精剪，预计消耗 ${credits} 积分`
    };
  }

  async function checkRuntime() {
    const checks: Record<string, boolean> = {
      enabled: config.VLOG_EDIT_ENABLED,
      storage: storage.configured,
      workflowSource: false,
      python: false,
      ffmpeg: false
    };
    try { await access(join(workflowDir, "scripts", "run.py")); checks.workflowSource = true; } catch { /* reported below */ }
    checks.python = await commandAvailable(pythonBin, ["--version"]);
    const ffmpeg = await checkWorkflowFfmpeg(resolveFfmpeg(config));
    checks.ffmpeg = ffmpeg.ok;
    const ready = Object.values(checks).every(Boolean);
    return { ready, checks, ffmpeg, workflowDir, dataDir, concurrency: maxConcurrent };
  }

  async function create(userId: string, rawInput: unknown) {
    const input = parseInput(rawInput);
    const runtime = await checkRuntime();
    if (!runtime.ready) throw new AppError("VLOG 工作流尚未具备运行条件。", "VLOG_EDIT_RUNTIME_UNAVAILABLE", 503, runtime);

    const videos = await resolveVideoAssets(userId, input.videoAssetIds);
    const bgm = input.bgmAssetId ? await resolveBgmAsset(userId, input.bgmAssetId) : null;
    const pricing = quote(input);
    const task = await tasks.create({
      userId,
      projectId: input.projectId,
      provider: "dsh-vlog-edit",
      workflowKey: "vlog-edit",
      title: input.title,
      credits: pricing.credits,
      payload: {
        input,
        inputAssets: {
          videos: videos.map(asset => ({ id: asset.id, key: asset.storageKey, mimeType: asset.mimeType })),
          bgm: bgm ? { id: bgm.id, key: bgm.storageKey, mimeType: bgm.mimeType } : null
        },
        quote: pricing
      }
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
    const tasksToResume = await prisma.generationTask.findMany({
      where: { workflowKey: "vlog-edit", status: "QUEUED" },
      select: { id: true },
      orderBy: { createdAt: "asc" }
    });
    tasksToResume.forEach(task => schedule(task.id));
    return tasksToResume.length;
  }

  function cancel(taskId: string) {
    const child = running.get(taskId);
    if (!child) return false;
    child.kill();
    return true;
  }

  function drain() {
    while (activeCount < maxConcurrent && pending.length) {
      const taskId = pending.shift();
      if (!taskId) return;
      activeCount += 1;
      void execute(taskId).finally(() => {
        activeCount -= 1;
        drain();
      });
    }
  }

  async function execute(taskId: string) {
    const becameProcessing = await tasks.markProcessing(taskId);
    if (!becameProcessing) return;

    try {
      const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
      if (!task) throw new AppError("找不到待执行的 VLOG 任务。", "TASK_NOT_FOUND", 404);
      const payload = task.payload as unknown as {
        input?: VlogEditInput;
        inputAssets?: {
          videos?: Array<{ id: string; key: string; mimeType: string }>;
          bgm?: { id: string; key: string; mimeType: string } | null;
        };
      };
      const input = parseInput(payload.input);
      const workspace = join(dataDir, "vlog-edit", task.id);
      const inputDir = join(workspace, "input");
      await mkdir(inputDir, { recursive: true });

      const videoAssets = payload.inputAssets?.videos || [];
      if (!videoAssets.length) throw new AppError("任务没有可用的实拍视频素材。", "VLOG_VIDEO_ASSETS_MISSING", 422);
      const clips: string[] = [];
      for (const [index, asset] of videoAssets.entries()) {
        const target = join(inputDir, `clip-${String(index + 1).padStart(2, "0")}${extensionFor(asset.mimeType, asset.key)}`);
        await storage.downloadToFile(asset.key, target);
        clips.push(target);
      }
      const bgmPath = payload.inputAssets?.bgm
        ? join(inputDir, `bgm${extensionFor(payload.inputAssets.bgm.mimeType, payload.inputAssets.bgm.key)}`)
        : "";
      if (bgmPath && payload.inputAssets?.bgm) await storage.downloadToFile(payload.inputAssets.bgm.key, bgmPath);
      await tasks.updateProgress(task.id, 8);

      const deepseek = await getDeepSeekRuntime(task.userId);
      const args = [
        join(workflowDir, "scripts", "run.py"),
        "--out", workspace,
        "--title", input.title,
        "--duration", String(input.durationSeconds),
        "--aspect", input.aspect,
        "--clips", ...clips
      ];
      if (input.script) args.push("--script", input.script);
      if (bgmPath) args.push("--bgm", bgmPath);
      if (input.skipLlm || !deepseek.enabled || !deepseek.apiKey) args.push("--skip-llm");
      if (input.skipCovers) args.push("--skip-covers");

      await runPythonTask({
        taskId: task.id,
        args,
        env: {
          ...process.env,
          DSH_FFMPEG: resolveFfmpeg(config),
          DSH_DEEPSEEK_BASE_URL: deepseek.baseUrl,
          DSH_DEEPSEEK_MODEL: deepseek.model,
          DEEPSEEK_API_KEY: deepseek.enabled ? deepseek.apiKey : ""
        }
      });

      const result = await uploadOutputs({ taskId: task.id, userId: task.userId, workspace });
      if (!result.video) throw new AppError("VLOG 工作流未产出 final_video.mp4。", "VLOG_EDIT_OUTPUT_MISSING", 502);
      await tasks.markCompleted(task.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "VLOG 工作流执行失败。";
      try { await tasks.markFailed(taskId, error instanceof AppError ? error.code : "VLOG_EDIT_FAILED", message); } catch { /* task may have been cancelled */ }
    } finally {
      running.delete(taskId);
    }
  }

  async function runPythonTask({ taskId, args, env }: { taskId: string; args: string[]; env: NodeJS.ProcessEnv }) {
    return await new Promise<void>((resolvePromise, reject) => {
      let output = "";
      let settled = false;
      let lastProgress = 8;
      const child = spawn(pythonBin, args, { cwd: workflowDir, env, windowsHide: true, shell: false });
      running.set(taskId, child);
      const timeout = setTimeout(() => child.kill(), config.VLOG_EDIT_TIMEOUT_SECONDS * 1_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolvePromise();
      };
      const onLog = (chunk: Buffer) => {
        output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
        const progress = output.includes("[publish]") ? 95
          : output.includes("[polish]") ? 78
            : output.includes("[cut]") ? 55
              : output.includes("[plan]") ? 30
                : output.includes("[ingest]") ? 15 : 8;
        if (progress > lastProgress) {
          lastProgress = progress;
          void tasks.updateProgress(taskId, progress);
        }
      };
      child.stdout?.on("data", onLog);
      child.stderr?.on("data", onLog);
      child.once("error", error => finish(new AppError(`无法启动 VLOG 执行器：${error.message}`, "VLOG_EDIT_SPAWN_FAILED", 503)));
      child.once("close", code => {
        if (code === 0) finish();
        else finish(new AppError(`VLOG 工作流退出异常（${code ?? "未知"}）：${output.slice(-1_500) || "未返回日志"}`, "VLOG_EDIT_PROCESS_FAILED", 502));
      });
    });
  }

  async function uploadOutputs({ taskId, userId, workspace }: { taskId: string; userId: string; workspace: string }) {
    const outputs: Record<string, { key: string; publicUrl: string | null }> = {};
    const definitions = [
      ["video", "final_video.mp4", "video/mp4"],
      ["subtitles", "subtitles.srt", "application/x-subrip"],
      ["cover3x4", "cover_3x4.png", "image/png"],
      ["cover4x3", "cover_4x3.png", "image/png"],
      ["cover16x9", "cover_16x9.png", "image/png"],
      ["publishPackage", "publish_package_handoff.json", "application/json"],
      ["cutPlan", "cut_plan.json", "application/json"],
      ["clips", "clips.json", "application/json"],
      ["state", "pipeline_state.json", "application/json"]
    ] as const;
    for (const [name, fileName, contentType] of definitions) {
      const source = join(workspace, fileName);
      if (!(await fileExists(source))) continue;
      outputs[name] = await storage.uploadFile({ key: `users/${userId}/tasks/${taskId}/vlog-edit/${fileName}`, filePath: source, contentType });
    }
    const handoff = await readJsonIfPresent(join(workspace, "publish_package_handoff.json"));
    const cutPlan = await readJsonIfPresent(join(workspace, "cut_plan.json"));
    return { workflowKey: "vlog-edit", artifacts: outputs, video: outputs.video || null, publishHandoff: handoff, cutPlan, completedAt: new Date().toISOString() };
  }

  async function resolveVideoAssets(userId: string, ids: string[]) {
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, userId }, select: { id: true, storageKey: true, mimeType: true, kind: true } });
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean) as typeof assets;
    if (ordered.length !== ids.length || ordered.some(asset => asset.kind !== "video" || !asset.mimeType.startsWith("video/"))) {
      throw new AppError("VLOG 只接受当前账号上传的视频素材。", "VLOG_VIDEO_ASSET_INVALID", 422);
    }
    return ordered;
  }

  async function resolveBgmAsset(userId: string, id: string) {
    const asset = await prisma.mediaAsset.findFirst({ where: { id, userId }, select: { id: true, storageKey: true, mimeType: true, kind: true } });
    if (!asset || asset.kind !== "audio" || !asset.mimeType.startsWith("audio/")) throw new AppError("背景音乐必须是当前账号上传的音频素材。", "VLOG_BGM_ASSET_INVALID", 422);
    return asset;
  }

  return { create, quote: (rawInput: unknown) => quote(parseInput(rawInput)), checkRuntime, cancel, resumeQueued };
}

function normalizeVlogInput(rawInput: unknown) {
  const raw = asRecord(rawInput);
  const source = {
    ...raw,
    ...asRecord(raw.options),
    ...asRecord(raw.output),
    ...asRecord(raw.input)
  };
  const title = String(source.title || source.name || source.instruction || "VLOG").trim() || "VLOG";
  const videoAssetIds = toAssetIds(source.videoAssetIds ?? source.clipAssetIds ?? source.videoAssets ?? source.clips ?? source.assets);
  const bgmAssetId = toAssetIds(source.bgmAssetId ?? source.musicAssetId ?? source.bgm ?? source.music ?? source.audioAssets)[0];
  return {
    ...source,
    title,
    videoAssetIds,
    script: String(source.script ?? source.caption ?? source.topic ?? source.instruction ?? "").trim(),
    durationSeconds: source.durationSeconds ?? source.duration ?? source.targetDuration ?? 60,
    aspect: source.aspect ?? source.ratio ?? "9:16",
    bgmAssetId: bgmAssetId || undefined,
    skipLlm: booleanish(source.skipLlm),
    skipCovers: booleanish(source.skipCovers)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toAssetIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map(item => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return String(record.id || record.assetId || record.mediaAssetId || "").trim();
    })
    .filter(Boolean);
}

function booleanish(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

async function commandAvailable(command: string, args: string[]) {
  return await new Promise<boolean>(resolvePromise => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    const timeout = setTimeout(() => child.kill(), 8_000);
    child.once("error", () => { clearTimeout(timeout); resolvePromise(false); });
    child.once("close", code => { clearTimeout(timeout); resolvePromise(code === 0); });
  });
}

async function fileExists(filePath: string) {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}

async function readJsonIfPresent(filePath: string) {
  try { return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>; } catch { return null; }
}

function extensionFor(mimeType: string, storageKey: string) {
  const extension = extname(storageKey).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension;
  const table: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
    "video/x-matroska": ".mkv",
    "video/x-msvideo": ".avi",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a"
  };
  return table[mimeType] || ".bin";
}
