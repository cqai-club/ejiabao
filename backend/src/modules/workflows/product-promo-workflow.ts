import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { createObjectStorage } from "../storage/object-storage.js";
import { createTaskService } from "../tasks/task-service.js";
import type { RuntimeProviderConfig } from "../provider-config/provider-config-service.js";
import { checkWorkflowFfmpeg, resolveFfmpeg } from "./runtime-checks.js";

const productPromoInputSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  productImageAssetIds: z.array(z.string().min(1)).min(1).max(12),
  sellingPoints: z.string().trim().min(2).max(2_000),
  durationSeconds: z.coerce.number().int().min(15).max(90).default(45),
  aspect: z.enum(["9:16", "16:9", "1:1", "3:4", "4:3"]).default("9:16"),
  bgmAssetId: z.string().min(1).optional(),
  voice: z.string().trim().max(120).optional(),
  skipLlm: z.boolean().optional().default(false),
  skipCovers: z.boolean().optional().default(false)
});

type ProductPromoInput = z.infer<typeof productPromoInputSchema>;

type ProductPromoDependencies = {
  config: AppConfig;
  storage: ReturnType<typeof createObjectStorage>;
  tasks: ReturnType<typeof createTaskService>;
  getDeepSeekRuntime: (userId: string) => Promise<RuntimeProviderConfig>;
};

/**
 * 商品推广工作流的服务器端适配层。
 *
 * 外部 Python 流程只运行在云端：桌面端只能提交素材 ID 与创作参数，不能提交命令、路径或密钥。
 */
export function createProductPromoWorkflowService({ config, storage, tasks, getDeepSeekRuntime }: ProductPromoDependencies) {
  const running = new Map<string, ChildProcess>();
  const pending: string[] = [];
  let activeCount = 0;
  const maxConcurrent = 1;

  const workflowDir = resolve(config.PRODUCT_PROMO_WORKFLOW_DIR || join(process.cwd(), "workflows", "dsh-product-promo"));
  const dataDir = resolve(config.WORKFLOW_DATA_DIR || join(process.cwd(), "runtime", "workflows"));

  function quote(input: ProductPromoInput) {
    const units = Math.ceil(input.durationSeconds / 15);
    const credits = units * config.PRODUCT_PROMO_CREDITS_PER_15_SECONDS;
    return {
      credits,
      estimatedContentSeconds: input.durationSeconds,
      estimatedProcessingSeconds: Math.max(75, input.durationSeconds * 3),
      detail: `${input.durationSeconds} 秒成片 · 预计消耗 ${credits} 积分`
    };
  }

  async function checkRuntime() {
    const checks: Record<string, boolean> = {
      enabled: config.PRODUCT_PROMO_ENABLED,
      storage: storage.configured,
      workflowSource: false,
      python: false,
      ffmpeg: false
    };
    try { await access(join(workflowDir, "scripts", "run.py")); checks.workflowSource = true; } catch { /* reported below */ }
    checks.python = await commandAvailable(config.PRODUCT_PROMO_PYTHON_BIN, ["--version"]);
    const ffmpeg = await checkWorkflowFfmpeg(resolveFfmpeg(config));
    checks.ffmpeg = ffmpeg.ok;
    const ready = Object.values(checks).every(Boolean);
    return { ready, checks, ffmpeg, workflowDir, dataDir, concurrency: maxConcurrent };
  }

  async function create(userId: string, rawInput: unknown) {
    const input = productPromoInputSchema.parse(rawInput);
    const runtime = await checkRuntime();
    if (!runtime.ready) throw new AppError("商品推广工作流尚未具备运行条件。", "PRODUCT_PROMO_RUNTIME_UNAVAILABLE", 503, runtime);

    const images = await resolveImageAssets(userId, input.productImageAssetIds);
    const bgm = input.bgmAssetId ? await resolveBgmAsset(userId, input.bgmAssetId) : null;
    const pricing = quote(input);
    const task = await tasks.create({
      userId,
      projectId: input.projectId,
      provider: "dsh-product-promo",
      workflowKey: "product-promo",
      title: input.title,
      credits: pricing.credits,
      payload: {
        input,
        inputAssets: { images: images.map(asset => ({ id: asset.id, key: asset.storageKey, mimeType: asset.mimeType })), bgm: bgm ? { id: bgm.id, key: bgm.storageKey, mimeType: bgm.mimeType } : null },
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
      where: { workflowKey: "product-promo", status: "QUEUED" },
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
      if (!task) throw new AppError("找不到待执行的商品推广任务。", "TASK_NOT_FOUND", 404);
      const payload = task.payload as unknown as { input?: ProductPromoInput; inputAssets?: { images?: Array<{ id: string; key: string; mimeType: string }>; bgm?: { id: string; key: string; mimeType: string } | null } };
      const input = productPromoInputSchema.parse(payload.input);
      const workspace = join(dataDir, "product-promo", task.id);
      const inputDir = join(workspace, "input");
      await mkdir(inputDir, { recursive: true });

      const imageAssets = payload.inputAssets?.images || [];
      if (!imageAssets.length) throw new AppError("任务没有可用的商品图片。", "PRODUCT_IMAGES_MISSING", 422);
      const images: string[] = [];
      for (const [index, asset] of imageAssets.entries()) {
        const target = join(inputDir, `product-${String(index + 1).padStart(2, "0")}${extensionFor(asset.mimeType, asset.key)}`);
        await storage.downloadToFile(asset.key, target);
        images.push(target);
      }
      const bgmPath = payload.inputAssets?.bgm
        ? join(inputDir, `bgm${extensionFor(payload.inputAssets.bgm.mimeType, payload.inputAssets.bgm.key)}`)
        : "";
      if (bgmPath && payload.inputAssets?.bgm) await storage.downloadToFile(payload.inputAssets.bgm.key, bgmPath);
      await tasks.updateProgress(task.id, 8);

      // 商品推广工作流会继承当前用户的模型选择：自定义 API 优先，未配置则使用平台积分算力。
      const deepseek = await getDeepSeekRuntime(task.userId);
      const args = [
        join(workflowDir, "scripts", "run.py"),
        "--out", workspace,
        "--title", input.title,
        "--duration", String(input.durationSeconds),
        "--aspect", input.aspect,
        "--keywords", input.sellingPoints,
        "--images", ...images
      ];
      if (bgmPath) args.push("--bgm", bgmPath);
      if (input.voice) args.push("--voice", input.voice);
      if (input.skipLlm || !deepseek.enabled || !deepseek.apiKey) args.push("--skip-llm");
      if (input.skipCovers) args.push("--skip-covers");

      await runPythonTask({
        taskId: task.id,
        args,
        env: {
          ...process.env,
          DSH_FFMPEG: resolveFfmpeg(config),
          DSH_DIGITAL_HUMAN: config.DSH_DIGITAL_HUMAN || "",
          DSH_TTS_PYTHON: config.DSH_TTS_PYTHON || "",
          DSH_TTS_SCRIPT: config.DSH_TTS_SCRIPT || "",
          DSH_DEEPSEEK_BASE_URL: deepseek.baseUrl,
          DSH_DEEPSEEK_MODEL: deepseek.model,
          DEEPSEEK_API_KEY: deepseek.enabled ? deepseek.apiKey : ""
        }
      });

      const result = await uploadOutputs({ taskId: task.id, userId: task.userId, workspace });
      if (!result.video) throw new AppError("工作流未产出 final_video.mp4。", "PRODUCT_PROMO_OUTPUT_MISSING", 502);
      await tasks.markCompleted(task.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品推广工作流执行失败。";
      try { await tasks.markFailed(taskId, error instanceof AppError ? error.code : "PRODUCT_PROMO_FAILED", message); } catch { /* 任务可能已被用户取消 */ }
    } finally {
      running.delete(taskId);
    }
  }

  async function runPythonTask({ taskId, args, env }: { taskId: string; args: string[]; env: NodeJS.ProcessEnv }) {
    return await new Promise<void>((resolvePromise, reject) => {
      let output = "";
      let settled = false;
      let lastProgress = 8;
      const child = spawn(config.PRODUCT_PROMO_PYTHON_BIN, args, { cwd: workflowDir, env, windowsHide: true, shell: false });
      running.set(taskId, child);
      const timeout = setTimeout(() => child.kill(), config.PRODUCT_PROMO_TIMEOUT_SECONDS * 1_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolvePromise();
      };
      const onLog = (chunk: Buffer) => {
        output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
        const progress = output.includes("[publish]") ? 95
          : output.includes("[assemble]") ? 82
            : output.includes("[visual]") ? 58
              : output.includes("[audio]") ? 34
                : output.includes("[script]") ? 16 : 8;
        if (progress > lastProgress) {
          lastProgress = progress;
          void tasks.updateProgress(taskId, progress);
        }
      };
      child.stdout?.on("data", onLog);
      child.stderr?.on("data", onLog);
      child.once("error", error => finish(new AppError(`无法启动商品推广执行器：${error.message}`, "PRODUCT_PROMO_SPAWN_FAILED", 503)));
      child.once("close", code => {
        if (code === 0) finish();
        else finish(new AppError(`商品推广工作流退出异常（${code ?? "未知"}）：${output.slice(-1_500) || "未返回日志"}`, "PRODUCT_PROMO_PROCESS_FAILED", 502));
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
      ["plan", "plan.json", "application/json"]
    ] as const;
    for (const [name, fileName, contentType] of definitions) {
      const source = join(workspace, fileName);
      if (!(await fileExists(source))) continue;
      outputs[name] = await storage.uploadFile({ key: `users/${userId}/tasks/${taskId}/product-promo/${fileName}`, filePath: source, contentType });
    }
    const handoff = await readJsonIfPresent(join(workspace, "publish_package_handoff.json"));
    return { workflowKey: "product-promo", artifacts: outputs, video: outputs.video || null, publishHandoff: handoff, completedAt: new Date().toISOString() };
  }

  async function resolveImageAssets(userId: string, ids: string[]) {
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, userId }, select: { id: true, storageKey: true, mimeType: true, kind: true } });
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean) as typeof assets;
    if (ordered.length !== ids.length || ordered.some(asset => asset.kind !== "image" || !asset.mimeType.startsWith("image/"))) {
      throw new AppError("商品推广只接受当前账号上传的图片素材。", "PRODUCT_IMAGE_ASSET_INVALID", 422);
    }
    return ordered;
  }

  async function resolveBgmAsset(userId: string, id: string) {
    const asset = await prisma.mediaAsset.findFirst({ where: { id, userId }, select: { id: true, storageKey: true, mimeType: true, kind: true } });
    if (!asset || asset.kind !== "audio" || !asset.mimeType.startsWith("audio/")) throw new AppError("背景音乐必须是当前账号上传的音频素材。", "PRODUCT_BGM_ASSET_INVALID", 422);
    return asset;
  }

  return { create, quote: (rawInput: unknown) => quote(productPromoInputSchema.parse(rawInput)), checkRuntime, cancel, resumeQueued };
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
  const table: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a" };
  return table[mimeType] || ".bin";
}
