const ASPECTS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

export function createTalkingHeadWorkflow({ http, eventBus } = {}) {
  function normalize(input = {}) {
    const assets = Array.isArray(input.assets) ? input.assets : [];
    const avatar = firstAssetId(input.avatarAssetId || input.presenterAssetId || input.avatar || input.presenter || input.imageAssets || assets.filter(asset => asset?.kind === "image"));
    const voice = firstAssetId(input.voiceAssetId || input.voiceReferenceAssetId || input.voice || input.voiceReference || input.audioAssets || assets.filter(asset => asset?.kind === "audio"));
    return {
      projectId: input.projectId || undefined,
      title: String(input.title || input.name || "知识口播").trim(),
      script: String(input.script || input.scriptText || input.prompt || input.instruction || "").trim(),
      avatarAssetId: avatar || undefined,
      presenterAssetId: avatar || undefined,
      voiceAssetId: voice || undefined,
      voiceReferenceAssetId: voice || undefined,
      aspect: input.aspect || input.ratio || "9:16",
      segmentationMode: input.segmentationMode || input.segmentation_mode || "fast_segments"
    };
  }

  function validate(input = {}) {
    const value = normalize(input);
    const missing = [];
    if (!value.title) missing.push("title");
    if (!value.script) missing.push("script");
    if (!value.avatarAssetId) missing.push("avatarAssetId");
    if (!value.voiceAssetId) missing.push("voiceAssetId");
    if (!ASPECTS.includes(value.aspect)) missing.push("aspect");
    if (!["fast_segments", "long_segments"].includes(value.segmentationMode)) missing.push("segmentationMode");
    return { valid: missing.length === 0, missing, value, typeKey: "talking" };
  }

  function assertValid(input) {
    const validation = validate(input);
    if (!validation.valid) throw new Error(`知识口播缺少或包含无效输入：${validation.missing.join("、")}`);
    return validation.value;
  }

  async function getStatus() {
    const response = await http.get("/v1/workflows/talking-head/status");
    return response.data;
  }

  async function estimate(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/talking-head/estimate", value);
    eventBus?.emit("workflow:estimated", { typeKey: "talking", input: value, quote: response.data.quote });
    return response.data.quote;
  }

  async function create(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/talking-head/tasks", value, { timeoutMs: 45_000 });
    eventBus?.emit("workflow:created", { typeKey: "talking", input: value, task: response.data.task, quote: response.data.quote });
    return response.data;
  }

  return {
    typeKey: "talking",
    title: "知识口播",
    status: "implemented",
    required: ["script", "avatarAssetId", "voiceAssetId"],
    optional: ["projectId", "title", "aspect", "segmentationMode"],
    validate,
    toIntent(input = {}) {
      return { typeKey: "talking", input: assertValid(input), workflowVersion: "inferflow-digital-human-v1" };
    },
    getStatus,
    estimate,
    create,
    buildSteps() {
      return ["校验人像与参考音频", "按讲稿分段", "调用 InferFlow 数字人", "回传成片与发布包"];
    }
  };
}

function firstAssetId(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  for (const item of values) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const id = String(item.id || item.assetId || item.mediaAssetId || "").trim();
      if (id) return id;
    }
  }
  return "";
}
