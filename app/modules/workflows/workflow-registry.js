import { createProductPromoWorkflow } from "./product-promo-workflow.js";
import { createVlogEditWorkflow } from "./vlog-edit-workflow.js";
import { createDramaShortWorkflow } from "./drama-short-workflow.js";
import { createPodcastWorkflow } from "./podcast-workflow.js";
import { createEventPromoWorkflow } from "./event-promo-workflow.js";
import { createTalkingHeadWorkflow } from "./talking-head-workflow.js";

/**
 * 六类视频工作流的稳定接口。
 * 这里注册能力和输入契约；具体生成由后端工作流执行器完成。
 */
export const WORKFLOW_KEYS = Object.freeze(["commerce", "talking", "story", "vlog", "mix", "event"]);

const WORKFLOW_META = {
  commerce: { title: "商品推广", required: ["script", "assets"], optional: ["brand", "ratio", "duration"] },
  talking: { title: "知识口播", required: ["script", "avatar"], optional: ["voice", "gesture", "ratio"] },
  story: { title: "剧情短片", required: ["script"], optional: ["characters", "style", "duration"] },
  vlog: { title: "VLOG", required: ["videoAssets"], optional: ["pace", "music", "caption"] },
  mix: { title: "文生播客", required: ["script"], optional: ["voice", "visualAssets", "podcastMotion"] },
  event: { title: "活动预告", required: ["eventInfo"], optional: ["poster", "qrCode", "ratio"] }
};

export function createWorkflowRegistry({ eventBus, logger, http }) {
  const definitions = new Map(WORKFLOW_KEYS.map(key => [key, createPlaceholderDefinition(key)]));
  definitions.set("commerce", createProductPromoWorkflow({ http, eventBus }));
  definitions.set("talking", createTalkingHeadWorkflow({ http, eventBus }));
  definitions.set("vlog", createVlogEditWorkflow({ http, eventBus }));
  definitions.set("story", createDramaShortWorkflow({ http, eventBus }));
  definitions.set("mix", createPodcastWorkflow({ http, eventBus }));
  definitions.set("event", createEventPromoWorkflow({ http, eventBus }));

  function register(typeKey, definition) {
    if (!WORKFLOW_KEYS.includes(typeKey)) throw new Error(`未知创作类型：${typeKey}`);
    definitions.set(typeKey, { ...definitions.get(typeKey), ...definition, typeKey });
    eventBus?.emit("workflow:registered", { typeKey });
    return definitions.get(typeKey);
  }

  function get(typeKey) { return definitions.get(typeKey) || null; }
  function list() { return [...definitions.values()]; }

  function validate(typeKey, input = {}) {
    const definition = get(typeKey);
    if (!definition) throw new Error(`未注册工作流：${typeKey}`);
    return definition.validate(input);
  }

  function buildIntent(typeKey, input = {}) {
    const definition = get(typeKey);
    if (!definition) throw new Error(`未注册工作流：${typeKey}`);
    return definition.toIntent(input);
  }

  logger?.info?.("六类工作流接口已注册", { keys: WORKFLOW_KEYS });
  return { register, get, list, validate, buildIntent };
}

function createPlaceholderDefinition(typeKey) {
  const meta = WORKFLOW_META[typeKey];
  return {
    typeKey,
    title: meta.title,
    required: [...meta.required],
    optional: [...meta.optional],
    status: "contract-only",
    validate(input = {}) {
      const missing = meta.required.filter(field => input[field] === undefined || input[field] === null || input[field] === "");
      return { valid: missing.length === 0, missing, typeKey };
    },
    toIntent(input = {}) {
      const validation = this.validate(input);
      if (!validation.valid) throw new Error(`${meta.title} 缺少必要输入：${validation.missing.join("、")}`);
      return { typeKey, input, workflowVersion: "1.0-contract" };
    },
    estimate() {
      throw new Error(`${meta.title} 工作流尚未实现，当前只提供接口。`);
    },
    buildSteps() {
      throw new Error(`${meta.title} 工作流尚未实现，当前只提供接口。`);
    }
  };
}
