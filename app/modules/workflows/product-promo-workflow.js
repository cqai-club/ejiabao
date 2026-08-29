const ASPECTS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

/**
 * 商品推广真实工作流的浏览器端契约。
 *
 * 只发送已上传到 OSS 的素材 ID；图片文件、平台模型密钥和 Python 命令始终不离开云端。
 */
export function createProductPromoWorkflow({ http, eventBus } = {}) {
  function normalize(input = {}) {
    const imageIds = input.productImageAssetIds || input.assets?.map(asset => typeof asset === "string" ? asset : asset?.id).filter(Boolean) || [];
    return {
      projectId: input.projectId || undefined,
      title: String(input.title || "商品推广").trim(),
      productImageAssetIds: imageIds,
      sellingPoints: String(input.sellingPoints || input.script || "").trim(),
      durationSeconds: Number(input.durationSeconds || input.duration || 45),
      aspect: input.aspect || input.ratio || "9:16",
      bgmAssetId: input.bgmAssetId || undefined,
      voice: input.voice || undefined,
      skipLlm: Boolean(input.skipLlm),
      skipCovers: Boolean(input.skipCovers)
    };
  }

  function validate(input = {}) {
    const value = normalize(input);
    const missing = [];
    if (!value.title) missing.push("title");
    if (!value.productImageAssetIds.length) missing.push("productImageAssetIds");
    if (!value.sellingPoints) missing.push("sellingPoints");
    if (!ASPECTS.includes(value.aspect)) missing.push("aspect");
    if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 15 || value.durationSeconds > 90) missing.push("durationSeconds");
    return { valid: missing.length === 0, missing, value, typeKey: "commerce" };
  }

  function assertValid(input) {
    const validation = validate(input);
    if (!validation.valid) throw new Error(`商品推广缺少或包含无效输入：${validation.missing.join("、")}`);
    return validation.value;
  }

  async function getStatus() {
    const response = await http.get("/v1/workflows/product-promo/status");
    return response.data;
  }

  async function estimate(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/product-promo/estimate", value);
    eventBus?.emit("workflow:estimated", { typeKey: "commerce", input: value, quote: response.data.quote });
    return response.data.quote;
  }

  async function create(input) {
    const value = assertValid(input);
    const response = await http.post("/v1/workflows/product-promo/tasks", value, { timeoutMs: 45_000 });
    eventBus?.emit("workflow:created", { typeKey: "commerce", input: value, task: response.data.task, quote: response.data.quote });
    return response.data;
  }

  return {
    typeKey: "commerce",
    title: "商品推广",
    status: "implemented",
    required: ["sellingPoints", "productImageAssetIds"],
    optional: ["projectId", "durationSeconds", "aspect", "bgmAssetId", "voice", "skipLlm", "skipCovers"],
    validate,
    toIntent(input = {}) {
      return { typeKey: "commerce", input: assertValid(input), workflowVersion: "dsh-product-promo-v1" };
    },
    getStatus,
    estimate,
    create,
    buildSteps() {
      return ["卖点文案与分镜", "分镜配音", "商品图动态化", "字幕与配乐合成", "封面与发布包"];
    }
  };
}
