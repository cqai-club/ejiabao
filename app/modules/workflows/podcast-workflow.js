const ASPECTS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

export function createPodcastWorkflow({ http, eventBus } = {}) {
  function normalize(input = {}) {
    const topic = String(input.topic || input.subject || input.prompt || input.instruction || input.script || "").trim();
    const script = String(input.script || input.dialogue || input.podcastScript || "").trim();
    return {
      projectId: input.projectId || undefined,
      title: String(input.title || input.name || "文生播客").trim(),
      topic: topic || script,
      script,
      durationSeconds: Number(input.durationSeconds || input.duration || input.targetDuration || 180),
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
    if (!value.topic) missing.push("topic");
    if (!ASPECTS.includes(value.aspect)) missing.push("aspect");
    if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 30 || value.durationSeconds > 1800) missing.push("durationSeconds");
    return { valid: missing.length === 0, missing, value, typeKey: "mix" };
  }

  function assertValid(input) {
    const validation = validate(input);
    if (!validation.valid) throw new Error(`文生播客缺少或包含无效输入：${validation.missing.join("、")}`);
    return validation.value;
  }

  async function getStatus() {
    const response = await http.get("/v1/workflows/text-podcast/status");
    return response.data;
  }

  async function estimate(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/text-podcast/estimate", value);
    eventBus?.emit("workflow:estimated", { typeKey: "mix", input: value, quote: response.data.quote });
    return response.data.quote;
  }

  async function create(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/text-podcast/tasks", value, { timeoutMs: 45_000 });
    eventBus?.emit("workflow:created", { typeKey: "mix", input: value, task: response.data.task, quote: response.data.quote });
    return response.data;
  }

  return {
    typeKey: "mix",
    title: "文生播客",
    status: "implemented",
    required: ["topic"],
    optional: ["projectId", "title", "script", "durationSeconds", "aspect", "bgmAssetId", "voice", "voiceB", "skipLlm", "skipCovers"],
    validate,
    toIntent(input = {}) {
      return { typeKey: "mix", input: assertValid(input), workflowVersion: "dsh-podcast-v1" };
    },
    getStatus,
    estimate,
    create,
    buildSteps() {
      return ["生成双人对话稿", "双人配音", "波形画面与说话人字幕", "合成音视频与发布包"];
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
