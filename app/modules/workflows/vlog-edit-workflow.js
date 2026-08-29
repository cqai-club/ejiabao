const ASPECTS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

export function createVlogEditWorkflow({ http, eventBus } = {}) {
  function normalize(input = {}) {
    const videoAssetIds = toAssetIds(input.videoAssetIds || input.clipAssetIds || input.videoAssets || input.clips || input.assets);
    const bgmAssetId = toAssetIds(input.bgmAssetId || input.musicAssetId || input.bgm || input.music || input.audioAssets)[0];
    return {
      projectId: input.projectId || undefined,
      title: String(input.title || input.name || input.instruction || "VLOG").trim(),
      videoAssetIds,
      script: String(input.script || input.caption || input.topic || input.instruction || "").trim(),
      durationSeconds: Number(input.durationSeconds || input.duration || input.targetDuration || 60),
      aspect: input.aspect || input.ratio || "9:16",
      bgmAssetId: bgmAssetId || undefined,
      skipLlm: Boolean(input.skipLlm),
      skipCovers: Boolean(input.skipCovers)
    };
  }

  function validate(input = {}) {
    const value = normalize(input);
    const missing = [];
    if (!value.title) missing.push("title");
    if (!value.videoAssetIds.length) missing.push("videoAssetIds");
    if (!ASPECTS.includes(value.aspect)) missing.push("aspect");
    if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 15 || value.durationSeconds > 300) missing.push("durationSeconds");
    return { valid: missing.length === 0, missing, value, typeKey: "vlog" };
  }

  function assertValid(input) {
    const validation = validate(input);
    if (!validation.valid) throw new Error(`VLOG 工作流缺少或包含无效输入：${validation.missing.join("、")}`);
    return validation.value;
  }

  async function getStatus() {
    const response = await http.get("/v1/workflows/vlog-edit/status");
    return response.data;
  }

  async function estimate(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/vlog-edit/estimate", value);
    eventBus?.emit("workflow:estimated", { typeKey: "vlog", input: value, quote: response.data.quote });
    return response.data.quote;
  }

  async function create(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/vlog-edit/tasks", value, { timeoutMs: 45_000 });
    eventBus?.emit("workflow:created", { typeKey: "vlog", input: value, task: response.data.task, quote: response.data.quote });
    return response.data;
  }

  return {
    typeKey: "vlog",
    title: "VLOG",
    status: "implemented",
    required: ["videoAssetIds"],
    optional: ["projectId", "title", "script", "durationSeconds", "aspect", "bgmAssetId", "skipLlm", "skipCovers"],
    validate,
    toIntent(input = {}) {
      return { typeKey: "vlog", input: assertValid(input), workflowVersion: "dsh-vlog-edit-v1" };
    },
    getStatus,
    estimate,
    create,
    buildSteps() {
      return ["扫描实拍素材", "规划高光剪辑", "裁剪并拼接", "字幕与配乐", "封面与发布包"];
    }
  };
}

function toAssetIds(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map(item => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      return String(item.id || item.assetId || item.mediaAssetId || "").trim();
    })
    .filter(Boolean);
}
