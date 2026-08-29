const ASPECTS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

export function createDramaShortWorkflow({ http, eventBus } = {}) {
  function normalize(input = {}) {
    const story = String(input.story || input.storyIdea || input.synopsis || input.prompt || input.instruction || "").trim();
    const script = String(input.script || input.screenplay || "").trim();
    return {
      projectId: input.projectId || undefined,
      title: String(input.title || input.name || "剧情短片").trim(),
      story: story || script,
      script,
      durationSeconds: Number(input.durationSeconds || input.duration || input.targetDuration || 40),
      aspect: input.aspect || input.ratio || "9:16",
      bgmAssetId: toAssetIds(input.bgmAssetId || input.musicAssetId || input.bgm || input.music || input.audioAssets)[0] || undefined,
      voice: input.voice || undefined,
      voiceB: input.voiceB || input.voice_b || undefined,
      skipLlm: Boolean(input.skipLlm),
      skipCovers: Boolean(input.skipCovers)
    };
  }

  function validate(input = {}) {
    const value = normalize(input);
    const missing = [];
    if (!value.title) missing.push("title");
    if (!value.story) missing.push("story");
    if (!ASPECTS.includes(value.aspect)) missing.push("aspect");
    if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 15 || value.durationSeconds > 300) missing.push("durationSeconds");
    return { valid: missing.length === 0, missing, value, typeKey: "story" };
  }

  function assertValid(input) {
    const validation = validate(input);
    if (!validation.valid) throw new Error(`剧情短片缺少或包含无效输入：${validation.missing.join("、")}`);
    return validation.value;
  }

  async function getStatus() {
    const response = await http.get("/v1/workflows/drama-short/status");
    return response.data;
  }

  async function estimate(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/drama-short/estimate", value);
    eventBus?.emit("workflow:estimated", { typeKey: "story", input: value, quote: response.data.quote });
    return response.data.quote;
  }

  async function create(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/drama-short/tasks", value, { timeoutMs: 45_000 });
    eventBus?.emit("workflow:created", { typeKey: "story", input: value, task: response.data.task, quote: response.data.quote });
    return response.data;
  }

  return {
    typeKey: "story",
    title: "剧情短片",
    status: "implemented",
    required: ["story"],
    optional: ["projectId", "title", "script", "durationSeconds", "aspect", "bgmAssetId", "voice", "voiceB", "skipLlm", "skipCovers"],
    validate,
    toIntent(input = {}) {
      return { typeKey: "story", input: assertValid(input), workflowVersion: "dsh-drama-short-v1" };
    },
    getStatus,
    estimate,
    create,
    buildSteps() {
      return ["扩写剧情脚本", "生成分镜画面", "多角色配音", "字幕配乐与发布包"];
    }
  };
}

function toAssetIds(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(item => {
    if (typeof item === "string") return item.trim();
    if (!item || typeof item !== "object") return "";
    return String(item.id || item.assetId || item.mediaAssetId || "").trim();
  }).filter(Boolean);
}
