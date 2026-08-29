const ASPECTS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

export function createEventPromoWorkflow({ http, eventBus } = {}) {
  function normalize(input = {}) {
    const highlights = Array.isArray(input.highlights) ? input.highlights.map(value => String(value).trim()).filter(Boolean) : [];
    return {
      projectId: input.projectId || undefined,
      title: String(input.title || input.name || "活动预告").trim(),
      eventTime: String(input.eventTime || input.event_time || input.time || "").trim(),
      location: String(input.location || input.venue || "").trim(),
      fee: String(input.fee || input.price || "").trim(),
      highlights,
      posterAssetId: toAssetId(input.posterAssetId || input.poster || input.posterId),
      qrAssetId: toAssetId(input.qrAssetId || input.qr || input.qrCode || input.qrCodeAssetId),
      bgmAssetId: toAssetId(input.bgmAssetId || input.musicAssetId || input.bgm || input.music),
      durationSeconds: Number(input.durationSeconds || input.duration || input.targetDuration || 20),
      aspect: input.aspect || input.ratio || "9:16",
      days: input.days === undefined || input.days === null || input.days === "" ? undefined : Number(input.days),
      voice: input.voice || undefined,
      skipLlm: Boolean(input.skipLlm),
      skipCovers: Boolean(input.skipCovers)
    };
  }

  function validate(input = {}) {
    const value = normalize(input);
    const missing = [];
    if (!value.title) missing.push("title");
    if (!ASPECTS.includes(value.aspect)) missing.push("aspect");
    if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 15 || value.durationSeconds > 300) missing.push("durationSeconds");
    return { valid: missing.length === 0, missing, value, typeKey: "event" };
  }

  function assertValid(input) {
    const validation = validate(input);
    if (!validation.valid) throw new Error(`活动预告缺少或包含无效输入：${validation.missing.join("、")}`);
    return validation.value;
  }

  async function getStatus() {
    const response = await http.get("/v1/workflows/event-promo/status");
    return response.data;
  }

  async function estimate(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/event-promo/estimate", value);
    eventBus?.emit("workflow:estimated", { typeKey: "event", input: value, quote: response.data.quote });
    return response.data.quote;
  }

  async function create(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/event-promo/tasks", value, { timeoutMs: 45_000 });
    eventBus?.emit("workflow:created", { typeKey: "event", input: value, task: response.data.task, quote: response.data.quote });
    return response.data;
  }

  return {
    typeKey: "event",
    title: "活动预告",
    status: "implemented",
    required: ["title"],
    optional: ["projectId", "eventTime", "location", "fee", "highlights", "posterAssetId", "qrAssetId", "bgmAssetId", "durationSeconds", "aspect", "days", "voice", "skipLlm", "skipCovers"],
    validate,
    toIntent(input = {}) {
      return { typeKey: "event", input: assertValid(input), workflowVersion: "dsh-event-promo-v1" };
    },
    getStatus,
    estimate,
    create,
    buildSteps() {
      return ["整理活动信息", "生成倒计时与亮点画面", "报名引导与配音", "合成并生成发布包"];
    }
  };
}

function toAssetId(value) {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object") return String(value.id || value.assetId || "").trim() || undefined;
  return undefined;
}
