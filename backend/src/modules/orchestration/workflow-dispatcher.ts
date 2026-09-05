import { AppError } from "../../lib/errors.js";
import type { createProductPromoWorkflowService } from "../workflows/product-promo-workflow.js";
import type { createVlogEditWorkflowService } from "../workflows/vlog-edit-workflow.js";
import type { createDramaShortWorkflowService } from "../workflows/drama-short-workflow.js";
import type { createPodcastWorkflowService } from "../workflows/podcast-workflow.js";
import type { createEventPromoWorkflowService } from "../workflows/event-promo-workflow.js";
import type { createDigitalHumanWorkflowService } from "../workflows/digital-human-workflow.js";

type ProductPromoWorkflow = ReturnType<typeof createProductPromoWorkflowService>;
type VlogEditWorkflow = ReturnType<typeof createVlogEditWorkflowService>;
type DramaShortWorkflow = ReturnType<typeof createDramaShortWorkflowService>;
type PodcastWorkflow = ReturnType<typeof createPodcastWorkflowService>;
type EventPromoWorkflow = ReturnType<typeof createEventPromoWorkflowService>;
type DigitalHumanWorkflow = ReturnType<typeof createDigitalHumanWorkflowService>;

export type OrchestrationAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "other";
  name?: string;
};

export type OrchestrationRequest = {
  instruction: string;
  typeKey?: string;
  assets: OrchestrationAsset[];
  options: Record<string, unknown>;
  context: Record<string, unknown>;
};

export type WorkflowCatalogItem = {
  workflowKey: string;
  typeKey: string;
  name: string;
  description: string;
  installed: boolean;
  ready: boolean;
  requiredInputs: readonly string[];
  optionalInputs: readonly string[];
  runtime?: Record<string, unknown>;
};

type PreparedPlan = {
  workflowKey: string;
  typeKey: string;
  title: string;
  summary: string;
  steps: Array<{ id: string; title: string; description: string }>;
  workflowInput: Record<string, unknown>;
  missingInputs: string[];
  blockers: Array<{ code: string; message: string }>;
  executable: boolean;
  quote: Record<string, unknown>;
};

const WORKFLOWS = [
  {
    workflowKey: "product-promo",
    typeKey: "commerce",
    name: "商品推广",
    description: "商品图、卖点和配音驱动的推广短片。",
    installed: true,
    requiredInputs: ["productImageAssetIds", "sellingPoints"],
    optionalInputs: ["title", "durationSeconds", "aspect", "bgmAssetId", "voice"]
  },
  {
    workflowKey: "vlog-edit",
    typeKey: "vlog",
    name: "VLOG",
    description: "把用户视频素材整理为有节奏的 Vlog。",
    installed: true,
    requiredInputs: ["videoAssetIds"],
    optionalInputs: ["title", "script", "durationSeconds", "aspect", "bgmAssetId"]
  },
  {
    workflowKey: "talking-head",
    typeKey: "talking",
    name: "口播视频",
    description: "口播脚本、数字人或真人素材驱动的视频。",
    installed: true,
    requiredInputs: ["script", "avatarAssetId", "voiceAssetId"],
    optionalInputs: ["presenterAssetId", "voiceReferenceAssetId", "aspect", "segmentationMode"]
  },
  {
    workflowKey: "story-short",
    typeKey: "story",
    name: "故事短片",
    description: "故事脚本、镜头生成和剪辑合成。",
    installed: false,
    requiredInputs: ["story"],
    optionalInputs: ["style", "durationSeconds", "aspect"]
  },
  {
    workflowKey: "text-podcast",
    typeKey: "mix",
    name: "图文播客",
    description: "图文、旁白和音乐混合编排。",
    installed: false,
    requiredInputs: ["script", "visualAssetIds"],
    optionalInputs: ["voice", "bgmAssetId", "aspect"]
  },
  {
    workflowKey: "event-promo",
    typeKey: "event",
    name: "活动预告",
    description: "活动信息、海报和报名引导驱动的倒计时预告片。",
    installed: true,
    requiredInputs: ["title"],
    optionalInputs: ["eventTime", "location", "fee", "highlights", "posterAssetId", "qrAssetId", "bgmAssetId", "durationSeconds", "aspect", "days", "voice"]
  }
] as const;

const TYPE_ALIASES: Record<string, string> = {
  commerce: "product-promo",
  product: "product-promo",
  "商品推广": "product-promo",
  "product-promo": "product-promo",
  vlog: "vlog-edit",
  "vlog智能剪辑": "vlog-edit",
  "vlog-edit": "vlog-edit",
  talking: "talking-head",
  "知识口播": "talking-head",
  "数字人口播": "talking-head",
  "数字人讲解": "talking-head",
  "talking-head": "talking-head",
  story: "story-short",
  "剧情短片": "story-short",
  "story-short": "story-short",
  mix: "text-podcast",
  podcast: "text-podcast",
  "文生播客": "text-podcast",
  "text-podcast": "text-podcast",
  event: "event-promo",
  "活动预告": "event-promo",
  "event-promo": "event-promo"
};

export function createWorkflowDispatcher({ productPromo, vlogEdit, dramaShort, podcast, eventPromo, digitalHuman }: { productPromo: ProductPromoWorkflow; vlogEdit: VlogEditWorkflow; dramaShort: DramaShortWorkflow; podcast: PodcastWorkflow; eventPromo: EventPromoWorkflow; digitalHuman: DigitalHumanWorkflow }) {
  async function catalog(userId?: string): Promise<WorkflowCatalogItem[]> {
    const [productRuntime, vlogRuntime, dramaRuntime, podcastRuntime, eventRuntime, digitalHumanRuntime] = await Promise.all([
      productPromo.checkRuntime(),
      vlogEdit.checkRuntime(),
      dramaShort.checkRuntime(),
      podcast.checkRuntime(),
      eventPromo.checkRuntime(),
      digitalHuman.checkRuntime(userId)
    ]);
    return WORKFLOWS.map(workflow => {
      const runtime = workflow.workflowKey === "product-promo"
        ? productRuntime
        : workflow.workflowKey === "vlog-edit"
          ? vlogRuntime
          : workflow.workflowKey === "story-short"
            ? dramaRuntime
            : workflow.workflowKey === "text-podcast"
              ? podcastRuntime
              : workflow.workflowKey === "event-promo"
                ? eventRuntime
                : workflow.workflowKey === "talking-head"
                  ? digitalHumanRuntime
          : undefined;
      return {
        ...workflow,
        ...(workflow.workflowKey === "story-short" ? {
          name: "剧情短片",
          description: "故事梗概或剧本自动生成分镜、配音、字幕和短片。",
          installed: true,
          requiredInputs: ["story"],
          optionalInputs: ["script", "title", "durationSeconds", "aspect", "bgmAssetId", "voice", "voiceB"]
        } : workflow.workflowKey === "talking-head" ? {
          name: "知识口播",
          description: "上传人像图片、参考音频和口播脚本，生成数字人口播视频。",
          installed: true,
          requiredInputs: ["script", "avatarAssetId", "voiceAssetId"],
          optionalInputs: ["presenterAssetId", "voiceReferenceAssetId", "aspect", "segmentationMode"]
        } : workflow.workflowKey === "text-podcast" ? {
          name: "文生播客",
          description: "话题或双人对话稿自动生成配音、波形视频、字幕和播客发布包。",
          installed: true,
          requiredInputs: ["topic"],
          optionalInputs: ["script", "title", "durationSeconds", "aspect", "bgmAssetId", "voice", "voiceB"]
        } : workflow.workflowKey === "event-promo" ? {
          name: "活动预告",
          description: "活动信息、海报和报名引导驱动的倒计时预告片。",
          installed: true,
          requiredInputs: ["title"],
          optionalInputs: ["eventTime", "location", "fee", "highlights", "posterAssetId", "qrAssetId", "bgmAssetId", "durationSeconds", "aspect", "days", "voice"]
        } : {}),
        ready: Boolean((workflow.installed || String(workflow.workflowKey) === "story-short" || String(workflow.workflowKey) === "text-podcast" || String(workflow.workflowKey) === "event-promo" || String(workflow.workflowKey) === "talking-head") && runtime?.ready),
        ...(runtime ? {
          runtime: {
            ready: Boolean(runtime.ready),
            checks: runtime.checks,
            ffmpeg: (runtime as Record<string, unknown>).ffmpeg,
            concurrency: runtime.concurrency
          }
        } : {})
      };
    });
  }

  function prepare(rawPlan: unknown, request: OrchestrationRequest, workflowCatalog: WorkflowCatalogItem[]): PreparedPlan {
    const plan = asRecord(rawPlan);
    const explicitWorkflow = resolveWorkflowKey(request.typeKey);
    const workflowKey = explicitWorkflow || resolveWorkflowKey(plan.workflowKey) || resolveWorkflowKey(plan.typeKey) || inferWorkflow(request.instruction);
    const workflow = workflowCatalog.find(item => item.workflowKey === workflowKey) || workflowCatalog[0];
    const planInput = asRecord(plan.workflowInput);
    const title = cleanText(plan.title, 120) || cleanText(request.options.title, 120) || workflow.name;
    const summary = cleanText(plan.summary, 600) || `DeepSeek 已选择“${workflow.name}”工作流。`;
    const workflowInput = buildWorkflowInput(workflow.workflowKey, title, planInput, request);
    const missingInputs = findMissingInputs(workflow.requiredInputs, workflowInput);
    const blockers: Array<{ code: string; message: string }> = [];

    if (!workflow.installed) {
      blockers.push({ code: "WORKFLOW_EXECUTOR_NOT_INSTALLED", message: `“${workflow.name}”执行器尚未安装。` });
    } else if (!workflow.ready) {
      blockers.push({ code: "WORKFLOW_RUNTIME_NOT_READY", message: `“${workflow.name}”运行环境尚未就绪。` });
    }
    if (missingInputs.length) {
      blockers.push({ code: "WORKFLOW_INPUTS_MISSING", message: `还需要：${missingInputs.join("、")}。` });
    }

    let quote: Record<string, unknown> = {};
    if (!blockers.length) {
      quote = workflow.workflowKey === "product-promo"
        ? productPromo.quote(workflowInput)
        : workflow.workflowKey === "vlog-edit"
          ? vlogEdit.quote(workflowInput)
          : workflow.workflowKey === "story-short"
            ? dramaShort.quote(workflowInput)
          : workflow.workflowKey === "text-podcast"
            ? podcast.quote(workflowInput)
            : workflow.workflowKey === "event-promo"
              ? eventPromo.quote(workflowInput)
              : digitalHuman.quote(workflowInput);
    }

    return {
      workflowKey: workflow.workflowKey,
      typeKey: workflow.typeKey,
      title,
      summary,
      steps: normalizeSteps(plan.steps, workflow.workflowKey),
      workflowInput,
      missingInputs,
      blockers,
      executable: blockers.length === 0,
      quote
    };
  }

  async function dispatch(userId: string, workflowKey: string, workflowInput: unknown) {
    if (workflowKey === "product-promo") return productPromo.create(userId, workflowInput);
    if (workflowKey === "vlog-edit") return vlogEdit.create(userId, workflowInput);
    if (workflowKey === "story-short" || workflowKey === "drama-short") return dramaShort.create(userId, workflowInput);
    if (workflowKey === "text-podcast") return podcast.create(userId, workflowInput);
    if (workflowKey === "event-promo") return eventPromo.create(userId, workflowInput);
    if (workflowKey === "talking-head") return digitalHuman.create(userId, workflowInput);
    throw new AppError("该工作流执行器尚未安装。", "WORKFLOW_EXECUTOR_NOT_INSTALLED", 409, { workflowKey });
  }

  function cancel(workflowKey: string, taskId: string) {
    if (workflowKey === "product-promo") return productPromo.cancel(taskId);
    if (workflowKey === "vlog-edit") return vlogEdit.cancel(taskId);
    if (workflowKey === "story-short" || workflowKey === "drama-short") return dramaShort.cancel(taskId);
    if (workflowKey === "text-podcast") return podcast.cancel(taskId);
    if (workflowKey === "event-promo") return eventPromo.cancel(taskId);
    if (workflowKey === "talking-head") return digitalHuman.cancel(taskId);
    return false;
  }

  return { catalog, prepare, dispatch, cancel };
}

function buildWorkflowInput(workflowKey: string, title: string, planInput: Record<string, unknown>, request: OrchestrationRequest) {
  const optionInput = asRecord(request.options);
  const allowedAssets = new Map(request.assets.map(asset => [asset.id, asset]));
  const firstAudioId = request.assets.find(asset => asset.kind === "audio")?.id;
  const aspect = normalizeAspect(optionInput.aspect ?? planInput.aspect);

  if (workflowKey === "product-promo") {
    const imageIds = request.assets.filter(asset => asset.kind === "image").map(asset => asset.id);
    return compactObject({
      projectId: cleanText(optionInput.projectId, 200) || undefined,
      title,
      productImageAssetIds: imageIds,
      sellingPoints: cleanText(optionInput.sellingPoints ?? planInput.sellingPoints, 2_000) || request.instruction,
      durationSeconds: normalizeInteger(optionInput.durationSeconds ?? planInput.durationSeconds, 15, 90, 45),
      aspect,
      bgmAssetId: allowedAssetId(optionInput.bgmAssetId ?? planInput.bgmAssetId, allowedAssets, "audio") || firstAudioId,
      voice: cleanText(optionInput.voice ?? planInput.voice, 120) || undefined
    });
  }

  if (workflowKey === "vlog-edit") {
    const videoIds = request.assets.filter(asset => asset.kind === "video").map(asset => asset.id);
    return compactObject({
      projectId: cleanText(optionInput.projectId, 200) || undefined,
      title,
      videoAssetIds: videoIds,
      script: cleanText(optionInput.script ?? planInput.script, 2_000) || request.instruction,
      durationSeconds: normalizeInteger(optionInput.durationSeconds ?? planInput.durationSeconds, 15, 300, 60),
      aspect,
      bgmAssetId: allowedAssetId(optionInput.bgmAssetId ?? planInput.bgmAssetId, allowedAssets, "audio") || firstAudioId
    });
  }

  if (workflowKey === "talking-head") {
    const avatar = request.assets.find(asset => asset.kind === "image" && (String((asset as any).role || "") === "avatar" || !String((asset as any).role || "")));
    const voice = request.assets.find(asset => asset.kind === "audio" && (String((asset as any).role || "") === "voice-reference" || !String((asset as any).role || "")));
    const avatarAssetId = allowedAssetId(optionInput.avatarAssetId ?? planInput.avatarAssetId ?? planInput.presenterAssetId ?? avatar?.id, allowedAssets, "image");
    const voiceAssetId = allowedAssetId(optionInput.voiceAssetId ?? optionInput.voiceReferenceAssetId ?? planInput.voiceAssetId ?? planInput.voiceReferenceAssetId ?? voice?.id, allowedAssets, "audio");
    return compactObject({
      projectId: cleanText(optionInput.projectId, 200) || undefined,
      title,
      script: cleanText(optionInput.script ?? planInput.script ?? planInput.scriptText, 20_000) || request.instruction,
      avatarAssetId,
      presenterAssetId: avatarAssetId,
      voiceAssetId,
      voiceReferenceAssetId: voiceAssetId,
      aspect,
      segmentationMode: String(optionInput.segmentationMode ?? planInput.segmentationMode ?? "fast_segments")
    });
  }

  if (workflowKey === "story-short") {
    return compactObject({
      projectId: cleanText(optionInput.projectId, 200) || undefined,
      title,
      story: cleanText(optionInput.story ?? optionInput.storyIdea ?? planInput.story ?? planInput.storyIdea, 8_000) || request.instruction,
      script: cleanText(optionInput.script ?? planInput.script, 12_000) || undefined,
      durationSeconds: normalizeInteger(optionInput.durationSeconds ?? planInput.durationSeconds, 15, 300, 40),
      aspect,
      bgmAssetId: allowedAssetId(optionInput.bgmAssetId ?? planInput.bgmAssetId, allowedAssets, "audio") || firstAudioId,
      voice: cleanText(optionInput.voice ?? planInput.voice, 120) || undefined,
      voiceB: cleanText(optionInput.voiceB ?? optionInput.voice_b ?? planInput.voiceB ?? planInput.voice_b, 120) || undefined
    });
  }

  if (workflowKey === "text-podcast") {
    return compactObject({
      projectId: cleanText(optionInput.projectId, 200) || undefined,
      title,
      topic: cleanText(optionInput.topic ?? optionInput.subject ?? planInput.topic ?? planInput.subject, 12_000) || request.instruction,
      script: cleanText(optionInput.script ?? optionInput.dialogue ?? planInput.script ?? planInput.dialogue, 20_000) || undefined,
      durationSeconds: normalizeInteger(optionInput.durationSeconds ?? planInput.durationSeconds, 30, 1_800, 180),
      aspect,
      bgmAssetId: allowedAssetId(optionInput.bgmAssetId ?? planInput.bgmAssetId, allowedAssets, "audio") || firstAudioId,
      voice: cleanText(optionInput.voice ?? planInput.voice, 120) || undefined,
      voiceB: cleanText(optionInput.voiceB ?? optionInput.voice_b ?? planInput.voiceB ?? planInput.voice_b, 120) || undefined
    });
  }

  if (workflowKey === "event-promo") {
    const highlights = Array.isArray(optionInput.highlights ?? planInput.highlights)
      ? (optionInput.highlights ?? planInput.highlights) as unknown[]
      : [];
    return compactObject({
      projectId: cleanText(optionInput.projectId, 200) || undefined,
      title,
      eventTime: cleanText(optionInput.eventTime ?? optionInput.event_time ?? planInput.eventTime ?? planInput.event_time, 120) || undefined,
      location: cleanText(optionInput.location ?? planInput.location, 240) || undefined,
      fee: cleanText(optionInput.fee ?? optionInput.price ?? planInput.fee ?? planInput.price, 120) || undefined,
      highlights: highlights.map(value => cleanText(value, 120)).filter(Boolean),
      posterAssetId: allowedAssetId(optionInput.posterAssetId ?? planInput.posterAssetId, allowedAssets, "image"),
      qrAssetId: allowedAssetId(optionInput.qrAssetId ?? planInput.qrAssetId, allowedAssets, "image"),
      bgmAssetId: allowedAssetId(optionInput.bgmAssetId ?? planInput.bgmAssetId, allowedAssets, "audio") || firstAudioId,
      durationSeconds: normalizeInteger(optionInput.durationSeconds ?? planInput.durationSeconds, 15, 300, 20),
      aspect,
      days: optionInput.days ?? planInput.days,
      voice: cleanText(optionInput.voice ?? planInput.voice, 120) || undefined
    });
  }

  return compactObject({ title, instruction: request.instruction, ...planInput });
}

function findMissingInputs(requiredInputs: readonly string[], input: Record<string, unknown>) {
  return requiredInputs.filter(key => {
    const value = input[key];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

function normalizeSteps(value: unknown, workflowKey: string) {
  if (Array.isArray(value)) {
    const steps = value.slice(0, 8).map((entry, index) => {
      const item = asRecord(entry);
      const title = cleanText(item.title, 80);
      if (!title) return null;
      return { id: cleanText(item.id, 40) || `step-${index + 1}`, title, description: cleanText(item.description, 240) };
    }).filter(Boolean) as Array<{ id: string; title: string; description: string }>;
    if (steps.length) return steps;
  }
  if (workflowKey === "story-short") {
    return ["扩写剧情脚本", "生成分镜画面", "多角色配音", "字幕配乐与发布包"]
      .map((title, index) => ({ id: `step-${index + 1}`, title, description: "" }));
  }
  if (workflowKey === "text-podcast") {
    return ["生成双人对话稿", "双人配音", "波形画面与说话人字幕", "合成音视频与发布包"]
      .map((title, index) => ({ id: `step-${index + 1}`, title, description: "" }));
  }
  if (workflowKey === "event-promo") {
    return ["整理活动信息", "生成倒计时与亮点画面", "报名引导与配音", "合成并生成发布包"]
      .map((title, index) => ({ id: `step-${index + 1}`, title, description: "" }));
  }
  const defaults = workflowKey === "vlog-edit"
    ? ["解析素材", "规划节奏", "剪辑与配音", "合成并质检"]
    : ["整理商品卖点", "生成脚本与分镜", "合成画面与配音", "质检并导出"];
  return defaults.map((title, index) => ({ id: `step-${index + 1}`, title, description: "" }));
}

function resolveWorkflowKey(value: unknown) {
  const normalized = normalizeInstruction(value);
  const compact = normalized.replace(/[\s_-]+/g, "");
  return TYPE_ALIASES[normalized]
    || TYPE_ALIASES[normalized.replace(/\s+/g, "-")]
    || TYPE_ALIASES[compact]
    || "";
}

function inferWorkflow(instruction: string) {
  const normalized = normalizeInstruction(instruction);
  const compact = normalized.replace(/[\s_-]+/g, "");

  // Match Chinese full-width text, mixed casing, extra whitespace and common
  // English aliases so the controller does not reject otherwise equivalent prompts.
  if (/(剧情|短剧|故事|分镜|剧本|剧情短片|drama|story)/i.test(compact)) return "story-short";
  if (/(知识口播|数字人口播|数字人讲解|口播|talkinghead|presenter|digitalhuman)/i.test(compact)) return "talking-head";
  if (/(文生播客|播客|播音|双人对话|podcast|audiotalk)/i.test(compact)) return "text-podcast";
  if (/(活动预告|活动宣传|倒计时|报名|eventpromo)/i.test(compact)) return "event-promo";
  if (/(vlog|旅行|探店|日常|剪辑素材|实拍精剪|vlogedit)/i.test(compact)) return "vlog-edit";
  return "product-promo";
}

function normalizeInstruction(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function allowedAssetId(value: unknown, assets: Map<string, OrchestrationAsset>, kind: OrchestrationAsset["kind"]) {
  const id = cleanText(value, 200);
  return id && assets.get(id)?.kind === kind ? id : undefined;
}

function normalizeAspect(value: unknown) {
  const aspect = String(value || "9:16");
  return ["9:16", "16:9", "1:1", "3:4", "4:3"].includes(aspect) ? aspect : "9:16";
}

function normalizeInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
