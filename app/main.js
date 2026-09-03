import { createEventBus } from "./core/event-bus.js";
import { createStorage } from "./core/storage.js";
import { createModuleRegistry } from "./core/module-registry.js";
import { createSessionService } from "./core/session-service.js";
import { createLogger } from "./core/logger.js";
import { readRuntimeConfig, getRuntimeStatus } from "./core/runtime-config.js";
import { createHttpClient } from "./core/http-client.js";
import { createPlatformInteractionSkill } from "./skills/platform-interaction/index.js";
import { createAuthService } from "./modules/auth/auth-service.js";
import { createAuthApi } from "./modules/auth/auth-api.js";
import { createProfileService } from "./modules/profile/profile-service.js";
import { createLibraryService } from "./modules/library/library-service.js";
import { createQueueService } from "./modules/queue/queue-service.js";
import { createSettingsService } from "./modules/settings/settings-service.js";
import { createModelConfigService } from "./modules/model-config/model-config-service.js";
import { createMediaService } from "./modules/media/media-service.js";
import { createPublishingService } from "./modules/publishing/publishing-service.js";
import { createConsoleService } from "./modules/console/console-service.js";
import { createCreativeOrchestrator } from "./modules/console/creative-orchestrator.js";
import { createOrchestrationService } from "./modules/console/orchestration-service.js";
import { createWorkflowRegistry } from "./modules/workflows/workflow-registry.js";

/**
 * 运行时入口。
 * Vue 负责应用壳与已迁移页面；这里负责组装业务模块并暴露稳定的
 * window.ejiabaoRuntime API，供 legacy workspace 逐步迁移期间继续使用。
 */
async function bootstrap() {
  const eventBus = createEventBus();
  const storage = createStorage();
  const logger = createLogger("runtime");
  const config = readRuntimeConfig();
  const runtimeStatus = getRuntimeStatus(config);
  const session = createSessionService({ storage, eventBus });
  const http = createHttpClient({ config, session, eventBus });
  const authApi = config.apiBaseUrl ? createAuthApi({ http, config }) : null;
  const platformSkill = createPlatformInteractionSkill({ config, eventBus, logger, http });
  const workflows = createWorkflowRegistry({ eventBus, logger, http });
  const registry = createModuleRegistry();

  const context = { eventBus, storage, logger, session, platformSkill, config, http, authApi, workflows };
  registry
    .register("auth", ctx => createAuthService({ ...ctx, api: ctx.authApi }))
    .register("profile", ctx => createProfileService(ctx))
    .register("library", ctx => createLibraryService(ctx))
    .register("queue", ctx => createQueueService(ctx))
    .register("settings", ctx => createSettingsService(ctx))
    .register("modelConfig", ctx => createModelConfigService(ctx))
    .register("media", ctx => createMediaService(ctx))
    .register("publishing", ctx => createPublishingService(ctx))
    .register("console", ctx => createConsoleService(ctx))
    .register("orchestration", ctx => createOrchestrationService(ctx));

  const instances = await registry.startAll(context);
  eventBus.on("auth:expired", payload => {
    window.dispatchEvent(new CustomEvent("ejiabao:auth-expired", { detail: payload }));
  });
  instances.set("creativeOrchestrator", createCreativeOrchestrator({
    consoleService: instances.get("console"),
    queueService: instances.get("queue"),
    libraryService: instances.get("library"),
    eventBus,
    logger
  }));
  const runtime = {
    version: "0.1.0",
    config,
    status: runtimeStatus,
    http,
    workflows,
    eventBus,
    storage,
    session,
    platform: platformSkill,
    modules: Object.fromEntries(instances)
  };

  // 给现有页面脚本一个轻量桥接点，后续可逐步把 DOM 事件迁移到模块 controller。
  window.ejiabaoRuntime = runtime;
  window.ejiabaoPlatform = instances.get("console");
  window.dispatchEvent(new CustomEvent("ejiabao:runtime-ready", { detail: runtime }));
  logger.info("模块运行层已启动", { modules: Object.keys(runtime.modules) });
  return runtime;
}

bootstrap().catch(error => {
  console.error("[e剪宝] 模块运行层启动失败", error);
  window.dispatchEvent(new CustomEvent("ejiabao:runtime-error", { detail: error }));
});
