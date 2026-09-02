import { spawn } from "node:child_process";
import Fastify from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { z } from "zod";
import { loadConfig, type AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { AppError, asAppError } from "./lib/errors.js";
import { createAuthBackendService } from "./modules/auth/auth-service.js";
import { createQuotaService } from "./modules/quota/quota-service.js";
import { createObjectStorage } from "./modules/storage/object-storage.js";
import { createOpenAIService } from "./modules/openai/openai-service.js";
import { createDeepSeekService } from "./modules/deepseek/deepseek-service.js";
import { createCodexService } from "./modules/codex/codex-service.js";
import { createInferFlowService } from "./modules/inferflow/inferflow-service.js";
import { createTaskService } from "./modules/tasks/task-service.js";
import { createOAuthService } from "./modules/platforms/oauth-service.js";
import { createDeviceLicenseService } from "./modules/devices/device-license-service.js";
import { createProviderConfigService } from "./modules/provider-config/provider-config-service.js";
import { providerConfigPage } from "./admin/provider-config-page.js";
import { createWechatPaymentService } from "./modules/billing/wechat-payment-service.js";
import { createProductPromoWorkflowService } from "./modules/workflows/product-promo-workflow.js";
import { createVlogEditWorkflowService } from "./modules/workflows/vlog-edit-workflow.js";
import { createDramaShortWorkflowService } from "./modules/workflows/drama-short-workflow.js";
import { createPodcastWorkflowService } from "./modules/workflows/podcast-workflow.js";
import { createEventPromoWorkflowService } from "./modules/workflows/event-promo-workflow.js";
import { createDigitalHumanWorkflowService } from "./modules/workflows/digital-human-workflow.js";
import { createWorkflowDispatcher } from "./modules/orchestration/workflow-dispatcher.js";
import { createOrchestrationService } from "./modules/orchestration/orchestration-service.js";

const LOCAL_DEVELOPMENT_ACTOR_ID = "local-development-admin";
const LOCAL_DEVELOPMENT_EMAIL = "local-development-admin@ejiabao.local";

export function buildApp(config: AppConfig = loadConfig()) {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 600 * 1024 * 1024 });
  const frontendRoot = resolve(process.cwd(), "..");
  app.register(cors, {
    origin: config.isProduction
      ? config.corsOrigin
      : [...config.corsOrigin, "null", /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  });
  app.register(cookie);
  app.register(jwt, { secret: config.JWT_SECRET });
  // 微信支付 API v3 通知验签必须使用原始请求体；其余 JSON 路由仍可正常使用已解析对象。
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    (request as any).rawBody = String(body);
    try { done(null, JSON.parse(String(body))); } catch { done(new AppError("JSON 请求体格式错误。", "JSON_INVALID", 400)); }
  });
  app.addContentTypeParser(/^(?:image|audio|video|text)\/.+$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser(/^application\/(?:pdf|rtf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  const auth = createAuthBackendService({ app, config });
  const quota = createQuotaService();
  const payments = createWechatPaymentService({ config, creditInTransaction: quota.creditInTransaction });
  const storage = createObjectStorage({ config });
  const openai = createOpenAIService({ config });
  const providerConfigs = createProviderConfigService({ config });
  const deepseek = createDeepSeekService({ config, getSettings: () => providerConfigs.getRuntime("deepseek-harness") });
  const codex = createCodexService({ config, getSettings: () => providerConfigs.getRuntime("codex") });
  const inferflow = createInferFlowService();
  const tasks = createTaskService();
  const productPromo = createProductPromoWorkflowService({
    config,
    storage,
    tasks,
    getDeepSeekRuntime: userId => providerConfigs.getRuntimeForUser(userId, "deepseek-harness")
  });
  const vlogEdit = createVlogEditWorkflowService({
    config,
    storage,
    tasks,
    getDeepSeekRuntime: userId => providerConfigs.getRuntimeForUser(userId, "deepseek-harness")
  });
  const dramaShort = createDramaShortWorkflowService({
    config,
    storage,
    tasks,
    getDeepSeekRuntime: userId => providerConfigs.getRuntimeForUser(userId, "deepseek-harness")
  });
  const podcast = createPodcastWorkflowService({
    config,
    storage,
    tasks,
    getDeepSeekRuntime: userId => providerConfigs.getRuntimeForUser(userId, "deepseek-harness")
  });
  const eventPromo = createEventPromoWorkflowService({
    config,
    storage,
    tasks,
    getDeepSeekRuntime: userId => providerConfigs.getRuntimeForUser(userId, "deepseek-harness")
  });
  const digitalHuman = createDigitalHumanWorkflowService({
    config,
    storage,
    tasks,
    inferflow,
    getInferFlowRuntime: () => providerConfigs.getRuntime("inferflow")
  });
  const workflowDispatcher = createWorkflowDispatcher({ productPromo, vlogEdit, dramaShort, podcast, eventPromo, digitalHuman });
  const orchestration = createOrchestrationService({ deepseek, providerConfigs, dispatcher: workflowDispatcher, tasks });
  const oauth = createOAuthService({
    config,
    tokenKey: config.tokenEncryptionKey,
    providers: buildOAuthProviders(config)
  });
  const devices = createDeviceLicenseService({ config });

  // 服务器重启后恢复尚未开始的商品推广任务；运行中的任务会由工作流自身状态文件续跑。
  if (config.PRODUCT_PROMO_ENABLED) {
    void productPromo.resumeQueued().catch(error => app.log.error({ err: error }, "恢复商品推广队列失败"));
  }
  if (config.VLOG_EDIT_ENABLED) {
    void vlogEdit.resumeQueued().catch(error => app.log.error({ err: error }, "恢复 VLOG 队列失败"));
  }

  if (config.DRAMA_SHORT_ENABLED) {
    void dramaShort.resumeQueued().catch(error => app.log.error({ err: error }, "恢复剧情短片队列失败"));
  }
  if (config.PODCAST_ENABLED) {
    void podcast.resumeQueued().catch(error => app.log.error({ err: error }, "恢复文生播客队列失败"));
  }
  if (config.EVENT_PROMO_ENABLED) {
    void eventPromo.resumeQueued().catch(error => app.log.error({ err: error }, "恢复活动预告队列失败"));
  }
  void digitalHuman.resumeQueued().catch(error => app.log.error({ err: error }, "恢复知识口播队列失败"));

  app.setErrorHandler((error, request, reply) => {
    const normalized = asAppError(error);
    request.log.error({ err: error, code: normalized.code }, normalized.message);
    reply.code(normalized.statusCode).send({ ok: false, error: { code: normalized.code, message: normalized.message, details: normalized.details, requestId: request.id } });
  });

  app.get("/", async (_request, reply) => {
    const html = await readFrontendIndex(frontendRoot);
    return reply.type("text/html; charset=utf-8").send(html);
  });
  app.get("/index.html", async (_request, reply) => {
    const html = await readFrontendIndex(frontendRoot);
    return reply.type("text/html; charset=utf-8").send(html);
  });
  app.get("/app/*", async (request, reply) => serveFrontendAsset(reply, frontendRoot, "app", String((request.params as any)["*"] || "")));
  app.get("/assets/*", async (request, reply) => serveFrontendAsset(reply, frontendRoot, "assets", String((request.params as any)["*"] || "")));
  app.get("/health/live", async () => ({ ok: true, service: "ejiabao-backend", time: new Date().toISOString() }));
  app.get("/admin/provider-config", async (request, reply) => {
    const preview = config.ADMIN_PREVIEW_MODE && !config.isProduction && isLoopbackRequest(request);
    const directAccess = isLocalAdminDirectAccess(request);
    let page = providerConfigPage
      .replace("__ADMIN_PREVIEW_MODE__", String(preview))
      .replace("__ADMIN_DIRECT_ACCESS__", String(directAccess));
    if (directAccess) {
      page = page.replace(
        '<section id="loginPanel" class="panel login">',
        '<section id="loginPanel" class="panel login hidden">'
      );
    }
    return reply.type("text/html; charset=utf-8").send(page);
  });
  app.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, database: "ready", storage: storage.configured };
    } catch {
      return reply.code(503).send({ ok: false, database: "unavailable", storage: storage.configured });
    }
  });

  app.post("/v1/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await auth.register(body, request);
    return reply.code(201).send({ ok: true, ...result });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = accountSchema.parse(request.body);
    const result = await auth.login(body, request);
    return reply.send({ ok: true, ...result });
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(20) }).parse(request.body);
    return reply.send({ ok: true, ...(await auth.refresh(body.refreshToken, request)) });
  });

  app.post("/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    await auth.logout((request as any).user?.sid);
    return reply.send({ ok: true });
  });

  app.get("/v1/me", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true, nickname: true, avatarUrl: true, bio: true, role: true, createdAt: true } });
    if (!user) throw new AppError("用户不存在。", "USER_NOT_FOUND", 404);
    return { ok: true, user };
  });
  app.patch("/v1/me", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({ nickname: z.string().trim().min(1).max(80).optional(), bio: z.string().max(500).optional(), avatarUrl: z.string().max(2_000_000).optional() }).parse(request.body);
    const user = await prisma.user.update({ where: { id: await getWorkbenchActorId(request) }, data: { nickname: body.nickname, avatarUrl: body.avatarUrl, bio: body.bio } });
    return { ok: true, user: { id: user.id, email: user.email, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, bio: user.bio, role: user.role } };
  });

  app.get("/v1/quota", { preHandler: requireAuth }, async request => ({ ok: true, quota: await quota.get(getUserId(request)) }));

  app.get("/v1/projects", { preHandler: requireWorkbenchAccess }, async request => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    const projects = await prisma.project.findMany({ where: { userId: await getWorkbenchActorId(request), NOT: { typeKey: { startsWith: "__" } } }, orderBy: { updatedAt: "desc" }, take: query.limit || 50 });
    return { ok: true, projects };
  });
  app.get("/v1/preferences/:scope", { preHandler: requireWorkbenchAccess }, async request => {
    const scope = z.enum(["brand", "settings", "templates"]).parse(String((request.params as any).scope || ""));
    const row = await prisma.project.findFirst({ where: { userId: await getWorkbenchActorId(request), typeKey: `__${scope}` }, orderBy: { updatedAt: "desc" } });
    return { ok: true, scope, data: (row?.metadata || {}) as Record<string, unknown>, updatedAt: row?.updatedAt || null };
  });
  app.put("/v1/preferences/:scope", { preHandler: requireWorkbenchAccess }, async request => {
    const scope = z.enum(["brand", "settings", "templates"]).parse(String((request.params as any).scope || ""));
    const body = z.object({ data: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    const typeKey = `__${scope}`;
    const existing = await prisma.project.findFirst({ where: { userId, typeKey } });
    const row = existing
      ? await prisma.project.update({ where: { id: existing.id }, data: { metadata: body.data as any } })
      : await prisma.project.create({ data: { userId, typeKey, title: `preference:${scope}`, status: "DRAFT", metadata: body.data as any } });
    return { ok: true, scope, data: row.metadata, updatedAt: row.updatedAt };
  });
  app.get("/v1/templates", { preHandler: requireWorkbenchAccess }, async request => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    const rows = await prisma.project.findMany({ where: { userId: await getWorkbenchActorId(request), typeKey: "__template__" }, orderBy: { updatedAt: "desc" }, take: query.limit || 100 });
    return {
      ok: true,
      templates: rows.map(row => ({
        id: row.id,
        name: row.title,
        ...(row.metadata as Record<string, unknown>),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    };
  });
  app.post("/v1/templates", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({
      id: z.string().min(1).optional(),
      name: z.string().trim().min(1).max(120),
      workflowKey: z.enum(["commerce", "talking", "story", "vlog", "mix", "event"]),
      description: z.string().trim().max(500).optional(),
      script: z.string().max(12000).optional(),
      durationSeconds: z.coerce.number().int().min(1).max(3600).optional(),
      aspectRatio: z.string().trim().max(20).optional(),
      platform: z.string().trim().max(40).optional(),
      voiceStrategy: z.string().trim().max(80).optional(),
      presetName: z.string().trim().max(80).optional(),
      requiredInputs: z.array(z.string().max(120)).max(20).optional()
    }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    const metadata = {
      template: true,
      workflowKey: body.workflowKey,
      description: body.description || "",
      script: body.script || "",
      durationSeconds: body.durationSeconds || null,
      aspectRatio: body.aspectRatio || "",
      platform: body.platform || "",
      voiceStrategy: body.voiceStrategy || "",
      presetName: body.presetName || "",
      requiredInputs: body.requiredInputs || []
    };
    const current = body.id ? await prisma.project.findFirst({ where: { id: body.id, userId, typeKey: "__template__" } }) : null;
    const template = current
      ? await prisma.project.update({ where: { id: current.id }, data: { title: body.name, metadata: metadata as any } })
      : await prisma.project.create({ data: { userId, typeKey: "__template__", title: body.name, status: "DRAFT", metadata: metadata as any } });
    return { ok: true, template: { id: template.id, name: template.title, ...(template.metadata as Record<string, unknown>), createdAt: template.createdAt, updatedAt: template.updatedAt } };
  });
  app.delete("/v1/templates/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const id = String((request.params as any).id || "");
    const current = await prisma.project.findFirst({ where: { id, userId, typeKey: "__template__" } });
    if (!current) throw new AppError("模板不存在或无权删除。", "TEMPLATE_NOT_FOUND", 404);
    await prisma.project.delete({ where: { id } });
    return { ok: true, id };
  });
  app.post("/v1/projects", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({ id: z.string().min(1).optional(), typeKey: z.string().min(1).max(80), title: z.string().trim().min(1).max(200), status: z.enum(["DRAFT", "PLANNING", "GENERATING", "READY", "FAILED", "ARCHIVED"]).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    let project;
    if (body.id) {
      const current = await prisma.project.findFirst({ where: { id: body.id, userId } });
      project = current
        ? await prisma.project.update({ where: { id: body.id }, data: { title: body.title, typeKey: body.typeKey, status: body.status || "DRAFT", metadata: (body.metadata || {}) as any } })
        : await prisma.project.create({ data: { userId, typeKey: body.typeKey, title: body.title, status: body.status || "DRAFT", metadata: (body.metadata || {}) as any } });
    } else {
      project = await prisma.project.create({ data: { userId, typeKey: body.typeKey, title: body.title, status: body.status || "DRAFT", metadata: (body.metadata || {}) as any } });
    }
    return { ok: true, project };
  });
  app.patch("/v1/projects/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({ title: z.string().trim().min(1).max(200).optional(), status: z.enum(["DRAFT", "PLANNING", "GENERATING", "READY", "FAILED", "ARCHIVED"]).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    const id = String((request.params as any).id || "");
    const current = await prisma.project.findFirst({ where: { id, userId } });
    if (!current) throw new AppError("项目不存在或无权访问。", "PROJECT_NOT_FOUND", 404);
    const project = await prisma.project.update({ where: { id }, data: body as any });
    return { ok: true, project };
  });
  app.delete("/v1/projects/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const id = String((request.params as any).id || "");
    const current = await prisma.project.findFirst({ where: { id, userId } });
    if (!current) throw new AppError("项目不存在或无权访问。", "PROJECT_NOT_FOUND", 404);
    await prisma.project.delete({ where: { id } });
    return { ok: true, id };
  });

  // 充值链路：创建 Native 扫码订单 → 桌面端展示 code_url → 微信异步通知验签后入账。
  app.get("/v1/billing/packages", { preHandler: requireAuth }, async () => ({ ok: true, enabled: payments.enabled, packages: payments.listPackages() }));
  app.post("/v1/billing/orders", { preHandler: requireAuth }, async request => {
    const body = z.object({ packageKey: z.string().min(1).max(80) }).parse(request.body);
    return { ok: true, order: await payments.createOrder({ userId: getUserId(request), packageKey: body.packageKey }) };
  });
  app.get("/v1/billing/orders/:id", { preHandler: requireAuth }, async request => ({ ok: true, order: await payments.getOrder(getUserId(request), String((request.params as any).id || ""), true) }));
  app.post("/v1/billing/orders/:id/close", { preHandler: requireAuth }, async request => ({ ok: true, order: await payments.closeOrder(getUserId(request), String((request.params as any).id || "")) }));
  app.post("/v1/billing/wechat/notify", async request => {
    await payments.handleNotify({ rawBody: String((request as any).rawBody || ""), headers: request.headers as Record<string, string | undefined> });
    return { code: "SUCCESS", message: "成功" };
  });

  app.get("/v1/admin/provider-configs", { preHandler: requireAdmin }, async request => {
    try {
      return { ok: true, providers: await providerConfigs.list() };
    } catch (error) {
      if (config.ADMIN_PREVIEW_MODE && !config.isProduction && isLoopbackRequest(request)) {
        return { ok: true, preview: true, providers: previewProviderConfigs(config) };
      }
      throw error;
    }
  });
  app.put("/v1/admin/provider-configs/:provider", { preHandler: requireAdmin }, async request => {
    const provider = String((request.params as any).provider || "");
    const body = z.object({ baseUrl: z.string().min(1), model: z.string().min(1).max(120), reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(), enabled: z.boolean(), apiKey: z.string().max(500).optional(), clearApiKey: z.boolean().optional() }).parse(request.body);
    const result = await providerConfigs.update(provider, body, getAdminActorId(request));
    return { ok: true, provider: result };
  });
  app.post("/v1/admin/provider-configs/:provider/test", { preHandler: requireAdmin }, async request => {
    const provider = String((request.params as any).provider || "");
    providerConfigs.assertProvider(provider);
    const result = provider === "codex"
      ? await codex.testConnection()
      : provider === "deepseek-harness"
        ? await deepseek.testConnection()
        : await inferflow.testConnection(await providerConfigs.getRuntime("inferflow"));
    return { ok: true, result };
  });

  // 个人模型配置：自定义 API Key 仅以加密密文保存在云端，或切换为平台积分算力。
  app.get("/v1/model-configs", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, configs: await providerConfigs.listForUser(await getWorkbenchActorId(request)) }));
  app.put("/v1/model-configs/:provider", { preHandler: requireWorkbenchAccess }, async request => {
    const provider = String((request.params as any).provider || "");
    const body = z.object({
      accessMode: z.enum(["PLATFORM", "CUSTOM"]),
      baseUrl: z.string().max(500).optional(),
      model: z.string().max(120).optional(),
      reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
      enabled: z.boolean().optional(),
      apiKey: z.string().max(500).optional(),
      clearApiKey: z.boolean().optional()
    }).parse(request.body);
    return { ok: true, config: await providerConfigs.updateForUser(await getWorkbenchActorId(request), provider, body) };
  });
  app.post("/v1/model-configs/:provider/test", { preHandler: requireWorkbenchAccess }, async request => {
    const provider = String((request.params as any).provider || "");
    if (provider !== "codex" && provider !== "deepseek-harness") throw new AppError("不支持的模型服务。", "PROVIDER_INVALID", 400);
    const runtime = await providerConfigs.getRuntimeForUser(await getWorkbenchActorId(request), provider as "codex" | "deepseek-harness");
    const result = provider === "codex" ? await codex.testConnection(runtime) : await deepseek.testConnection(runtime);
    return { ok: true, result };
  });

  // 首发版本只开放后台人工充值；不接入支付网关，避免把充值状态交给前端。
  app.post("/v1/admin/users/:userId/quota/credit", { preHandler: requireAdmin }, async request => {
    const body = z.object({ amount: z.number().int().positive(), reason: z.string().min(1).max(200), idempotencyKey: z.string().min(8).max(120).optional() }).parse(request.body);
    const userId = String((request.params as any).userId || "");
    if (!userId) throw new AppError("用户 ID 不能为空。", "USER_ID_MISSING", 400);
    const ledger = await quota.adminCredit(userId, body.amount, body.reason, body.idempotencyKey);
    return { ok: true, ledger };
  });

  app.post("/v1/devices/bind", { preHandler: requireAuth }, async request => {
    const body = z.object({ deviceId: z.string().min(8), usbFingerprint: z.string().min(16), publicKey: z.string().min(32), attestation: z.string().min(32) }).parse(request.body);
    const result = await devices.bind({ userId: getUserId(request), ...body });
    return { ok: true, result };
  });

  app.post("/v1/uploads/presign", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({
      filename: z.string().min(1).max(255),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().positive(),
      kind: z.enum(["image", "video", "audio", "document"]),
      category: z.enum(["image", "product", "person", "video", "audio", "script", "document"]).optional(),
      role: z.string().trim().min(1).max(80).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(30).optional()
    }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    const signed = await storage.createUploadUrl({ userId, filename: body.filename, mimeType: body.mimeType, sizeBytes: body.sizeBytes });
    const metadata = {
      filename: body.filename,
      ...(body.category ? { category: body.category } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.tags?.length ? { tags: Array.from(new Set(body.tags)) } : {})
    };
    const asset = await prisma.mediaAsset.create({ data: { userId, storageKey: signed.key, mimeType: body.mimeType, kind: body.kind, sizeBytes: body.sizeBytes, metadata } });
    return { ok: true, asset: { id: asset.id, key: asset.storageKey, name: body.filename, mimeType: asset.mimeType, kind: asset.kind, category: body.category || body.kind, role: body.role || null, tags: body.tags || [], sizeBytes: Number(asset.sizeBytes), previewUrl: signed.previewUrl || null }, uploadUrl: signed.uploadUrl, transport: signed.transport };
  });

  // 本地预览模式使用后端接收上传，绕过占位 OSS 凭据和对象存储 CORS；生产环境仍走 OSS 预签名直传。
  app.put("/v1/uploads/local", { preHandler: requireWorkbenchAccess }, async (request, reply) => {
    if (!storage.local) throw new AppError("本地上传未启用。", "LOCAL_STORAGE_DISABLED", 503);
    const query = z.object({ key: z.string().min(1).max(500), token: z.string().min(1).max(200) }).parse(request.query);
    const userId = await getWorkbenchActorId(request);
    const asset = await prisma.mediaAsset.findFirst({ where: { storageKey: query.key, userId }, select: { id: true, sizeBytes: true } });
    if (!asset) throw new AppError("上传素材不存在或不属于当前账号。", "UPLOAD_ASSET_NOT_FOUND", 404);
    await storage.acceptLocalUpload({
      key: query.key,
      token: query.token,
      body: request.body,
      expectedSizeBytes: Number(asset.sizeBytes)
    });
    return reply.code(204).send();
  });

  app.get("/v1/uploads/local-file", { preHandler: requireWorkbenchAccess }, async (request, reply) => {
    if (!storage.local) throw new AppError("本地预览未启用。", "LOCAL_STORAGE_DISABLED", 503);
    const query = z.object({ key: z.string().min(1).max(500) }).parse(request.query);
    const userId = await getWorkbenchActorId(request);
    const asset = await prisma.mediaAsset.findFirst({ where: { storageKey: query.key, userId }, select: { mimeType: true } });
    let mimeType = asset?.mimeType || "";
    if (!asset) {
      const artifactMatch = /^users\/([^/]+)\/tasks\/([^/]+)\//.exec(query.key);
      if (!artifactMatch || artifactMatch[1] !== userId) throw new AppError("素材不存在或不属于当前账号。", "UPLOAD_ASSET_NOT_FOUND", 404);
      const task = await prisma.generationTask.findFirst({ where: { id: artifactMatch[2], userId }, select: { result: true } });
      const result = asRecord(task?.result);
      const outputValues = [
        result.video,
        result.audio,
        ...Object.values(asRecord(result.outputs)),
        ...Object.values(asRecord(result.artifacts))
      ].map(asRecord);
      if (!outputValues.some(output => output.key === query.key)) throw new AppError("素材不存在或不属于当前账号。", "UPLOAD_ASSET_NOT_FOUND", 404);
      mimeType = inferLocalFileMimeType(query.key);
    }
    const file = await storage.getLocalFile(query.key);
    reply.header("Content-Type", mimeType);
    reply.header("Content-Length", String(file.sizeBytes));
    reply.header("Cache-Control", "private, max-age=300");
    return reply.send(createReadStream(file.path));
  });

  // 商品推广（商品图 + 卖点）是首个接入真实执行器的工作流；报价由服务端固定计算，客户端不可传扣费额度。
  app.get("/v1/assets", { preHandler: requireWorkbenchAccess }, async request => {
    const query = z.object({ includeTrash: z.coerce.boolean().optional().default(true) }).parse(request.query);
    const userId = await getWorkbenchActorId(request);
    const rows = await prisma.mediaAsset.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    const assets = await Promise.all(rows.map(async asset => {
      const metadata = asRecord(asset.metadata);
      let previewUrl: string | null = null;
      try { previewUrl = (await storage.createDownloadUrl(asset.storageKey)).downloadUrl || null; } catch { /* preview remains optional */ }
      return {
        id: asset.id,
        name: String(metadata.filename || asset.storageKey.split("/").pop() || asset.id),
        key: asset.storageKey,
        mimeType: asset.mimeType,
        kind: asset.kind,
        category: String(metadata.category || (asset.kind === "document" ? "script" : asset.kind)),
        role: typeof metadata.role === "string" ? metadata.role : null,
        sizeBytes: Number(asset.sizeBytes),
        favorite: metadata.favorite === true,
        trashed: metadata.trashed === true,
        tags: Array.isArray(metadata.tags) ? metadata.tags.filter(tag => typeof tag === "string").slice(0, 30) : [],
        lastUsedAt: typeof metadata.lastUsedAt === "string" ? metadata.lastUsedAt : null,
        createdAt: asset.createdAt,
        updatedAt: asset.createdAt,
        previewUrl
      };
    }));
    return { ok: true, assets: query.includeTrash ? assets : assets.filter(asset => !asset.trashed) };
  });

  app.patch("/v1/assets/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({ favorite: z.boolean().optional(), trashed: z.boolean().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(), markUsed: z.boolean().optional() }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    const id = String((request.params as any).id || "");
    const current = await prisma.mediaAsset.findFirst({ where: { id, userId } });
    if (!current) throw new AppError("素材不存在或不属于当前账号。", "ASSET_NOT_FOUND", 404);
    const metadata = asRecord(current.metadata);
    if (body.favorite !== undefined) metadata.favorite = body.favorite;
    if (body.trashed !== undefined) metadata.trashed = body.trashed;
    if (body.tags !== undefined) metadata.tags = body.tags;
    if (body.markUsed) metadata.lastUsedAt = new Date().toISOString();
    const updated = await prisma.mediaAsset.update({ where: { id }, data: { metadata: metadata as any } });
    return { ok: true, asset: { id: updated.id, favorite: metadata.favorite === true, trashed: metadata.trashed === true, tags: Array.isArray(metadata.tags) ? metadata.tags : [], lastUsedAt: metadata.lastUsedAt || null } };
  });

  app.delete("/v1/assets/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const id = String((request.params as any).id || "");
    const current = await prisma.mediaAsset.findFirst({ where: { id, userId } });
    if (!current) throw new AppError("素材不存在或不属于当前账号。", "ASSET_NOT_FOUND", 404);
    const metadata = asRecord(current.metadata);
    if (metadata.trashed !== true) throw new AppError("请先将素材移入回收站，再永久删除。", "ASSET_DELETE_REQUIRES_TRASH", 409);
    await prisma.mediaAsset.delete({ where: { id } });
    return { ok: true, id };
  });

  app.get("/v1/workflows/product-promo/status", { preHandler: requireWorkbenchAccess }, async () => ({ ok: true, ...(await productPromo.checkRuntime()) }));
  app.post("/v1/workflows/product-promo/estimate", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, quote: productPromo.quote(request.body) }));
  app.post("/v1/workflows/product-promo/tasks", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, ...(await productPromo.create(await getWorkbenchActorId(request), request.body)) }));
  app.get("/v1/workflows/vlog-edit/status", { preHandler: requireWorkbenchAccess }, async () => ({ ok: true, ...(await vlogEdit.checkRuntime()) }));
  app.post("/v1/workflows/vlog-edit/estimate", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, quote: vlogEdit.quote(request.body) }));
  app.post("/v1/workflows/vlog-edit/tasks", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, ...(await vlogEdit.create(await getWorkbenchActorId(request), request.body)) }));
  app.get("/v1/workflows/drama-short/status", { preHandler: requireWorkbenchAccess }, async () => ({ ok: true, ...(await dramaShort.checkRuntime()) }));
  app.post("/v1/workflows/drama-short/estimate", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, quote: dramaShort.quote(request.body) }));
  app.post("/v1/workflows/drama-short/tasks", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, ...(await dramaShort.create(await getWorkbenchActorId(request), request.body)) }));
  app.get("/v1/workflows/text-podcast/status", { preHandler: requireWorkbenchAccess }, async () => ({ ok: true, ...(await podcast.checkRuntime()) }));
  app.post("/v1/workflows/text-podcast/estimate", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, quote: podcast.quote(request.body) }));
  app.post("/v1/workflows/text-podcast/tasks", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, ...(await podcast.create(await getWorkbenchActorId(request), request.body)) }));
  app.get("/v1/workflows/event-promo/status", { preHandler: requireWorkbenchAccess }, async () => ({ ok: true, ...(await eventPromo.checkRuntime()) }));
  app.post("/v1/workflows/event-promo/estimate", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, quote: eventPromo.quote(request.body) }));
  app.post("/v1/workflows/event-promo/tasks", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, ...(await eventPromo.create(await getWorkbenchActorId(request), request.body)) }));
  app.get("/v1/workflows/talking-head/status", { preHandler: requireWorkbenchAccess }, async () => ({ ok: true, ...(await digitalHuman.checkRuntime()) }));
  app.post("/v1/workflows/talking-head/estimate", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, quote: digitalHuman.quote(request.body) }));
  app.post("/v1/workflows/talking-head/tasks", { preHandler: requireWorkbenchAccess }, async request => ({ ok: true, ...(await digitalHuman.create(await getWorkbenchActorId(request), request.body)) }));

  app.get("/v1/orchestration/workflows", { preHandler: requireWorkbenchAccess }, async () => ({
    ok: true,
    workflows: await orchestration.listWorkflows()
  }));
  app.post("/v1/orchestration/plans", { preHandler: requireWorkbenchAccess }, async request => ({
    ok: true,
    run: await orchestration.plan(await getWorkbenchActorId(request), request.body)
  }));
  app.get("/v1/orchestration/runs/:id", { preHandler: requireWorkbenchAccess }, async request => ({
    ok: true,
    run: await orchestration.get(await getWorkbenchActorId(request), String((request.params as any).id || ""))
  }));
  app.post("/v1/orchestration/runs/:id/execute", { preHandler: requireWorkbenchAccess }, async request => ({
    ok: true,
    run: await orchestration.execute(await getWorkbenchActorId(request), String((request.params as any).id || ""))
  }));
  app.delete("/v1/orchestration/runs/:id", { preHandler: requireWorkbenchAccess }, async request => ({
    ok: true,
    run: await orchestration.cancel(await getWorkbenchActorId(request), String((request.params as any).id || ""))
  }));

  app.post("/v1/ai/plan", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({ instruction: z.string().min(1).max(8000), typeKey: z.string().optional(), context: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const result = await openai.planCreativeTask(body);
    return { ok: true, ...result };
  });

  app.post("/v1/ai/deepseek/polish", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({
      text: z.string().min(1).max(12000),
      label: z.string().max(80).optional(),
      typeKey: z.string().max(40).optional(),
      guidance: z.string().max(500).optional()
    }).parse(request.body);
    const runtime = await providerConfigs.getRuntimeForUser(await getWorkbenchActorId(request), "deepseek-harness");
    const result = await deepseek.polishCopy({ ...body, runtime });
    return { ok: true, ...result };
  });

  app.post("/v1/ai/deepseek/review-copy", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({
      title: z.string().trim().max(200).optional().default(""),
      script: z.string().trim().max(12000).optional().default(""),
      typeKey: z.string().trim().max(40).optional().default(""),
      typeName: z.string().trim().max(80).optional().default(""),
      platform: z.string().trim().max(40).optional().default("自动适配")
    }).parse(request.body);
    if (!body.title && !body.script) throw new AppError("请先提供视频标题或脚本文案。", "REVIEW_COPY_INPUT_EMPTY", 400);
    const runtime = await providerConfigs.getRuntimeForUser(await getWorkbenchActorId(request), "deepseek-harness");
    const tagCount = reviewTagCountForPlatform(body.platform);
    const result = await deepseek.chat({
      runtime,
      context: { source: "review-export-copy", typeKey: body.typeKey, platform: body.platform },
      messages: [
        {
          role: "system",
          content: [
            "你是 e剪宝审片导出页的标题文案助手。",
            "只输出 JSON，不要 Markdown，不要解释。",
            "JSON 字段必须为 titles、copy、tags。",
            "titles 是 3 个中文短视频标题，每个 28 字以内。",
            "copy 是 1 段适合发布页的视频简介，80 字以内。",
            `tags 必须正好 ${tagCount} 个，按平台习惯生成，全部以 # 开头。`,
            "不要编造未提供的事实、价格、时间、地点或承诺。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            title: body.title,
            script: body.script.slice(0, 6000),
            typeKey: body.typeKey,
            typeName: body.typeName,
            platform: body.platform,
            tagCount
          })
        }
      ]
    });
    const pack = normalizeReviewCopyPackage(result.text, { ...body, tagCount });
    return { ok: true, provider: result.provider, model: result.model, responseId: result.responseId, usage: result.usage || null, pack: { ...pack, platform: body.platform } };
  });

  app.get("/v1/review/motion-styles", { preHandler: requireWorkbenchAccess }, async () => ({
    ok: true,
    source: "remotion",
    styles: reviewMotionStyles()
  }));

  app.post("/v1/tasks/:id/review-versions", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const taskId = String((request.params as any).id || "");
    const body = z.object({
      version: z.enum(["v2", "v3"]),
      sourceVersion: z.enum(["v1", "v2"]).optional().default("v1"),
      motionStyle: z.string().trim().max(40).optional().default("auto"),
      title: z.string().trim().max(200).optional().default(""),
      script: z.string().trim().max(12000).optional().default(""),
      subtitle: z.string().trim().max(2000).optional().default(""),
      textStyle: z.object({
        font: z.string().trim().max(40).optional(),
        effect: z.string().trim().max(40).optional(),
        primaryColor: z.string().trim().max(24).optional(),
        secondaryColor: z.string().trim().max(24).optional(),
        strokeColor: z.string().trim().max(24).optional(),
        accentColor: z.string().trim().max(24).optional()
      }).optional().default({}),
      platform: z.string().trim().max(40).optional().default("自动适配")
    }).parse(request.body);
    const task = await tasks.get(userId, taskId);
    const result = asRecord(task.result);
    const reviewVersions = asRecord(result.reviewVersions);
    const existing = asRecord(reviewVersions[body.version]);
    if (existing.key || existing.publicUrl) {
      const accessUrl = existing.publicUrl || existing.downloadUrl || (existing.key ? (await storage.createDownloadUrl(String(existing.key)).catch(() => ({ downloadUrl: "" }))).downloadUrl : "");
      return {
        ok: true,
        version: { ...existing, publicUrl: existing.publicUrl || accessUrl || null, downloadUrl: existing.downloadUrl || accessUrl || null },
        task,
        credits: 0,
        charged: false
      };
    }
    let sourceVersion: "v1" | "v2" = "v1";
    let sourceVideo = asRecord(result.video || asRecord(result.outputs).video);
    if (body.version === "v3" && body.sourceVersion === "v2") {
      const v2Source = asRecord(reviewVersions.v2);
      if (v2Source.key) {
        sourceVideo = v2Source;
        sourceVersion = "v2";
      }
    }
    if (!sourceVideo.key) throw new AppError("当前任务没有可用于派生版本的原始视频。", "REVIEW_SOURCE_VIDEO_MISSING", 404);
    const credits = body.version === "v2" ? 2 : reviewMotionCredits(body.motionStyle);
    const created = await createReviewVersion({ userId, task, version: body.version, sourceVersion, motionStyle: body.motionStyle, title: body.title, script: body.script, subtitle: body.subtitle, textStyle: body.textStyle, platform: body.platform, sourceVideo, credits });
    return { ok: true, ...created };
  });

  // DeepSeek Harness 中控的安全代理：桌面端只提交 e剪宝协议，密钥留在云端。
  app.post("/v1/ai/deepseek", { preHandler: requireWorkbenchAccess }, async request => {
    const body = deepSeekProtocolSchema.parse(request.body);
    return handleAgentOperation(request, body, "deepseek-harness", deepseek);
  });

  // Codex 中控的安全代理：桌面端只提交 e剪宝协议，OpenAI/Codex 密钥留在云端。
  app.post("/v1/ai/codex", { preHandler: requireWorkbenchAccess }, async request => {
    const body = agentProtocolSchema.parse(request.body);
    return handleAgentOperation(request, body, "codex", codex);
  });

  app.post("/v1/tasks", { preHandler: requireAuth }, async request => {
    const body = z.object({ projectId: z.string().optional(), provider: z.string().min(1), workflowKey: z.string().min(1), title: z.string().min(1).max(200), credits: z.number().int().positive(), payload: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    if (!config.ALLOW_CLIENT_TASK_CREDITS) {
      throw new AppError("六大视频工作流的服务端报价尚未接入，暂不接受客户端提交扣费额度。", "WORKFLOW_PRICING_PENDING", 409);
    }
    const task = await tasks.create({ userId: getUserId(request), ...body });
    return { ok: true, task };
  });

  app.get("/v1/tasks/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const task = await tasks.get(await getWorkbenchActorId(request), (request.params as any).id);
    const hydrated = task.workflowKey === "talking-head" && task.status === "COMPLETED"
      ? await digitalHuman.ensureCompletedOutputs(task.id)
      : task;
    return { ok: true, task: hydrated || task };
  });
  app.get("/v1/tasks", { preHandler: requireWorkbenchAccess }, async request => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), status: z.string().optional() }).parse(request.query);
    const rows = await tasks.list(await getWorkbenchActorId(request), query);
    return { ok: true, tasks: rows };
  });
  app.get("/v1/tasks/:id/artifacts/:artifact", { preHandler: requireWorkbenchAccess }, async request => {
    const task = await tasks.get(await getWorkbenchActorId(request), String((request.params as any).id || ""));
    const artifactName = String((request.params as any).artifact || "");
    const result = (task.result || {}) as any;
    const artifacts = (result.artifacts || result.outputs || {}) as Record<string, { key?: string; publicUrl?: string | null }>;
    const artifact = artifacts?.[artifactName] || (artifactName === "video" ? result.video : undefined);
    if (!artifact?.key) throw new AppError("该任务产物暂不可下载。", "TASK_ARTIFACT_NOT_FOUND", 404);
    return { ok: true, artifact: { name: artifactName, key: artifact.key, publicUrl: artifact.publicUrl || null }, ...(await storage.createDownloadUrl(artifact.key)) };
  });

  app.get("/v1/system/logs/recent", { preHandler: requireWorkbenchAccess }, async () => {
    if (config.isProduction) throw new AppError("生产环境运行日志需通过管理员后台查看。", "SYSTEM_LOGS_ADMIN_ONLY", 403);
    const path = join(process.cwd(), ".local", "server.out.log");
    let content = "";
    try {
      content = await readFile(path, "utf8");
    } catch {
      content = "当前还没有本地后端日志。";
    }
    const lines = content.split(/\r?\n/).slice(-500).join("\n");
    return { ok: true, path, lines };
  });

  app.post("/v1/feedback", { preHandler: requireWorkbenchAccess }, async request => {
    const body = z.object({
      message: z.string().trim().min(1).max(2_000),
      context: z.record(z.string(), z.unknown()).optional().default({})
    }).parse(request.body);
    const userId = await getWorkbenchActorId(request);
    const row = await prisma.auditLog.create({
      data: {
        userId,
        action: "feedback.submit",
        resource: "feedback",
        metadata: { message: body.message, context: body.context } as any
      }
    });
    return { ok: true, feedback: { id: row.id, createdAt: row.createdAt } };
  });
  app.delete("/v1/tasks/:id", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const task = await tasks.cancel(userId, (request.params as any).id);
    if (task.workflowKey === "product-promo") productPromo.cancel(task.id);
    if (task.workflowKey === "vlog-edit") vlogEdit.cancel(task.id);
    if (task.workflowKey === "drama-short" || task.workflowKey === "story-short") dramaShort.cancel(task.id);
    if (task.workflowKey === "text-podcast") podcast.cancel(task.id);
    if (task.workflowKey === "event-promo") eventPromo.cancel(task.id);
    if (task.workflowKey === "talking-head") digitalHuman.cancel(task.id);
    return { ok: true, task };
  });

  app.post("/v1/tasks/:id/retry", { preHandler: requireWorkbenchAccess }, async request => {
    const userId = await getWorkbenchActorId(request);
    const source = await tasks.get(userId, String((request.params as any).id || ""));
    if (!["FAILED", "CANCELLED"].includes(source.status)) {
      throw new AppError("只有失败或已取消的任务可以重试。", "TASK_RETRY_NOT_ALLOWED", 409);
    }
    const payload = asRecord(source.payload);
    const input = Object.keys(asRecord(payload.input)).length ? asRecord(payload.input) : payload;
    const created = source.workflowKey === "product-promo"
      ? await productPromo.create(userId, input)
      : source.workflowKey === "vlog-edit"
        ? await vlogEdit.create(userId, input)
        : source.workflowKey === "drama-short" || source.workflowKey === "story-short"
          ? await dramaShort.create(userId, input)
          : source.workflowKey === "text-podcast"
            ? await podcast.create(userId, input)
            : source.workflowKey === "event-promo"
              ? await eventPromo.create(userId, input)
              : source.workflowKey === "talking-head"
                ? await digitalHuman.create(userId, input)
                : null;
    if (!created) {
      throw new AppError("该任务类型暂不支持直接重试，请重新规划。", "TASK_RETRY_UNSUPPORTED", 409, { workflowKey: source.workflowKey });
    }
    return { ok: true, sourceTaskId: source.id, ...created };
  });

  app.get("/v1/oauth/:platform/start", { preHandler: requireAuth }, async request => {
    if (config.DISABLE_SOCIAL_OAUTH) throw new AppError("社交平台授权将在后续 OTA 版本开放。", "OAUTH_DEFERRED", 409);
    const platform = (request.params as any).platform;
    return { ok: true, ...(await oauth.start({ userId: getUserId(request), platform })) };
  });

  app.get("/v1/oauth/:platform/callback", async request => {
    if (config.DISABLE_SOCIAL_OAUTH) throw new AppError("社交平台授权将在后续 OTA 版本开放。", "OAUTH_DEFERRED", 409);
    const params = request.query as any;
    const result = await oauth.callback({ platform: (request.params as any).platform, code: String(params.code || ""), state: String(params.state || "") });
    return { ok: true, ...result };
  });

  return app;

  async function requireAuth(request: any) {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (!token) throw new AppError("请先登录。", "AUTH_REQUIRED", 401);
    try {
      request.user = await app.jwt.verify(token);
    } catch {
      throw new AppError("登录已过期，请重新登录。", "AUTH_REQUIRED", 401);
    }
  }

  async function requireWorkbenchAccess(request: any) {
    try {
      await requireAuth(request);
    } catch (error) {
      if (!isLocalWorkbenchDirectAccess(request)) throw error;
      request.user = { sub: LOCAL_DEVELOPMENT_ACTOR_ID, role: "ADMIN", localDirect: true };
    }
  }

  async function requireAdmin(request: any) {
    if (isLocalAdminDirectAccess(request) || (!config.isProduction && config.ADMIN_PREVIEW_MODE && isLoopbackRequest(request))) return;
    await requireAuth(request);
    if (!["ADMIN", "SUPPORT"].includes(String(request.user?.role || ""))) {
      throw new AppError("仅管理员或客服可以执行此操作。", "ADMIN_REQUIRED", 403);
    }
  }

  function isLocalAdminDirectAccess(request: any) {
    return !config.isProduction && config.ADMIN_DIRECT_ACCESS && isLoopbackRequest(request);
  }

  function isLocalWorkbenchDirectAccess(request: any) {
    return !config.isProduction && config.ADMIN_DIRECT_ACCESS && isLoopbackRequest(request);
  }

  async function getWorkbenchActorId(request: any) {
    const userId = getUserId(request);
    if (userId !== LOCAL_DEVELOPMENT_ACTOR_ID) return userId;
    return ensureLocalDevelopmentUserId();
  }

  async function ensureLocalDevelopmentUserId() {
    const existing = await prisma.user.findUnique({ where: { email: LOCAL_DEVELOPMENT_EMAIL }, select: { id: true } });
    if (existing) return existing.id;
    const created = await prisma.user.create({
      data: {
        email: LOCAL_DEVELOPMENT_EMAIL,
        nickname: "本地开发管理员",
        role: "ADMIN",
        quota: { create: { balance: 100000 } }
      },
      select: { id: true }
    });
    return created.id;
  }

  async function handleAgentOperation(request: any, body: z.infer<typeof agentProtocolSchema>, provider: "codex" | "deepseek-harness", service: any) {
    const userId = await getWorkbenchActorId(request);
    if (body.operation === "task.status") {
      const task = await tasks.get(userId, requireTaskId(body.taskId));
      return { ok: true, provider, operation: body.operation, ...taskPayload(task) };
    }
    if (body.operation === "task.cancel") {
      const task = await tasks.cancel(userId, requireTaskId(body.taskId));
      if (task.workflowKey === "product-promo") productPromo.cancel(task.id);
      if (task.workflowKey === "vlog-edit") vlogEdit.cancel(task.id);
      if (task.workflowKey === "drama-short") dramaShort.cancel(task.id);
      if (task.workflowKey === "text-podcast") podcast.cancel(task.id);
      if (task.workflowKey === "event-promo") eventPromo.cancel(task.id);
      if (task.workflowKey === "talking-head") digitalHuman.cancel(task.id);
      return { ok: true, provider, operation: body.operation, ...taskPayload(task) };
    }
    if (body.operation === "video.create") {
      const typeKey = normalizeTypeKey(body.intent?.typeKey);
      const instruction = String(body.intent?.instruction || body.messages.find(message => message.role === "user")?.content || "");
      const workflowKey = resolveVideoWorkflowKey(typeKey || instruction);
      if (!workflowKey) {
        throw new AppError("无法从中控指令识别视频类型，请补充类型或更明确的创作说明。", "WORKFLOW_TYPE_UNRECOGNIZED", 400, { typeKey });
      }
      const created = await workflowDispatcher.dispatch(userId, workflowKey, buildWorkflowInputFromIntent(body));
      return {
        ok: true,
        provider,
        operation: body.operation,
        text: "工作流已进入后台生成队列。",
        quote: created.quote,
        ...taskPayload(created.task)
      };
    }

    const runtime = await providerConfigs.getRuntimeForUser(userId, provider);
    if (body.operation === "chat") {
      const result = await service.chat({ messages: body.messages, context: body.context, runtime });
      return { ok: true, ...result, provider, operation: body.operation };
    }
    if (body.operation === "video.plan") {
      const instruction = body.intent?.instruction || body.messages.find(message => message.role === "user")?.content || "";
      const result = await service.planCreativeTask({ instruction, typeKey: body.intent?.typeKey || undefined, context: { ...body.context, intent: body.intent }, runtime });
      return { ok: true, ...result, provider, operation: body.operation };
    }
    throw new AppError("中控暂不支持该任务操作。", "AI_OPERATION_UNSUPPORTED", 409, { operation: body.operation, provider });
  }

  function sanitizeReviewTextStyle(style: Record<string, unknown>) {
    const textValue = (key: string, fallback: string) => String(style[key] || fallback).trim().slice(0, 40) || fallback;
    const colorValue = (key: string, fallback: string) => {
      const value = String(style[key] || "").trim();
      return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
    };
    return {
      font: textValue("font", "heavy"),
      effect: textValue("effect", "stroke-shadow"),
      primaryColor: colorValue("primaryColor", "#ffdc58"),
      secondaryColor: colorValue("secondaryColor", "#ffffff"),
      strokeColor: colorValue("strokeColor", "#111111"),
      accentColor: colorValue("accentColor", "#2f85ff")
    };
  }

  async function createReviewVersion({
    userId,
    task,
    version,
    sourceVersion,
    motionStyle,
    title,
    script,
    subtitle,
    textStyle,
    platform,
    sourceVideo,
    credits
  }: {
    userId: string;
    task: any;
    version: "v2" | "v3";
    sourceVersion: "v1" | "v2";
    motionStyle: string;
    title: string;
    script: string;
    subtitle: string;
    textStyle: Record<string, unknown>;
    platform: string;
    sourceVideo: Record<string, any>;
    credits: number;
  }) {
    if (task.status !== "COMPLETED") throw new AppError("只有已完成任务可以添加审片版本。", "REVIEW_TASK_NOT_COMPLETED", 409);
    const remotionDir = resolve(process.cwd(), "..", "..", "remotion-e-bao-edit");
    await ensureReviewRenderer(remotionDir);
    await ensureReviewVersionQuota(userId, credits);

    const workflowRoot = resolve(config.WORKFLOW_DATA_DIR || join(process.cwd(), "runtime", "workflows"));
    const workspace = join(workflowRoot, "review-versions", task.id, version);
    await mkdir(workspace, { recursive: true });
    const publicInputDir = join(remotionDir, "public", "ejiabao-review");
    await mkdir(publicInputDir, { recursive: true });
    const inputName = `${task.id}-${version}-${Date.now()}.mp4`;
    const inputPath = join(publicInputDir, inputName);
    const propsPath = join(workspace, "props.json");
    const outputPath = join(workspace, `${version}.mp4`);

    try {
      await storage.downloadToFile(String(sourceVideo.key), inputPath);
      const result = asRecord(task.result);
      const payload = asRecord(task.payload);
      const input = asRecord(payload.input || payload);
      const aspect = String(input.aspect || result.aspect || "9:16");
      const durationSeconds = await probeVideoDuration(inputPath, config.DSH_FFMPEG);
      const sanitizedTextStyle = sanitizeReviewTextStyle(textStyle || {});
      const props = {
        source: `ejiabao-review/${inputName}`,
        title: title || String(payload.title || input.title || "e剪宝成片"),
        script: String(script || input.script || payload.script || payload.title || title || "视频已生成，正在审片。"),
        subtitle: String(subtitle || ""),
        textStyle: sanitizedTextStyle,
        variant: version === "v2" ? "subtitles" : "motion",
        sourceVersion,
        styleId: motionStyle || "auto",
        aspect,
        durationSeconds
      };
      await writeFile(propsPath, JSON.stringify(props), "utf8");
      await runReviewRemotionRender({ remotionDir, propsPath, outputPath });
      const uploaded = await storage.uploadFile({
        key: `users/${userId}/tasks/${task.id}/review/${version}.mp4`,
        filePath: outputPath,
        contentType: "video/mp4"
      });
      const access = await storage.createDownloadUrl(uploaded.key).catch(() => ({ downloadUrl: uploaded.publicUrl || null }));
      const versionResult = {
        ...uploaded,
        publicUrl: uploaded.publicUrl || access.downloadUrl || null,
        downloadUrl: access.downloadUrl || uploaded.publicUrl || null,
        version,
        variant: props.variant,
        sourceVersion,
        motionStyle: version === "v3" ? motionStyle : "",
        platform,
        credits,
        createdAt: new Date().toISOString()
      };
      await chargeReviewVersion(userId, task.id, version, credits);
      const latestResult = asRecord(task.result);
      const updated = await prisma.generationTask.update({
        where: { id: task.id },
        data: {
          result: {
            ...latestResult,
            reviewVersions: {
              ...asRecord(latestResult.reviewVersions),
              [version]: versionResult
            }
          } as any
        }
      });
      return { version: versionResult, task: updated, credits, charged: true };
    } finally {
      await rm(inputPath, { force: true }).catch(() => undefined);
    }
  }

  async function ensureReviewRenderer(remotionDir: string) {
    try {
      await readFile(join(remotionDir, "package.json"), "utf8");
      await readFile(join(remotionDir, "src", "ReviewEnhancer.tsx"), "utf8");
    } catch {
      throw new AppError("Remotion 审片增强渲染器尚未安装。", "REVIEW_RENDERER_NOT_INSTALLED", 503);
    }
  }

  async function ensureReviewVersionQuota(userId: string, credits: number) {
    const account = await prisma.quotaAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    const available = account.balance - account.reserved;
    if (available < credits) throw new AppError("创作额度不足，无法添加审片版本。", "QUOTA_INSUFFICIENT", 402, { available, required: credits });
  }

  async function chargeReviewVersion(userId: string, taskId: string, version: string, credits: number) {
    const idempotencyKey = `review-version:${taskId}:${version}`;
    const existing = await prisma.quotaLedger.findUnique({ where: { idempotencyKey } });
    if (existing) return false;
    await prisma.$transaction(async (tx: any) => {
      const account = await tx.quotaAccount.upsert({ where: { userId }, create: { userId }, update: {} });
      const available = account.balance - account.reserved;
      if (available < credits) throw new AppError("创作额度不足，无法添加审片版本。", "QUOTA_INSUFFICIENT", 402, { available, required: credits });
      const updated = await tx.quotaAccount.update({ where: { userId }, data: { balance: { decrement: credits } } });
      await tx.quotaLedger.create({
        data: {
          userId,
          taskId,
          kind: "DEBIT",
          amount: -credits,
          balanceAfter: updated.balance - updated.reserved,
          reason: `审片${version.toUpperCase()}增强版本生成`,
          idempotencyKey
        }
      });
    });
    return true;
  }

  async function probeVideoDuration(filePath: string, ffmpegPath: string) {
    const ffprobe = ffmpegPath ? join(dirname(ffmpegPath), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe";
    const result = await commandOutput(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], 12_000);
    const seconds = Number(result.output.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(600, seconds) : 15;
  }

  async function runReviewRemotionRender({ remotionDir, propsPath, outputPath }: { remotionDir: string; propsPath: string; outputPath: string }) {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = [
      "exec",
      "--",
      "remotion",
      "render",
      "src/index.ts",
      "EJReviewEnhancer",
      outputPath,
      `--props=${propsPath}`,
      "--codec=h264",
      "--concurrency=1",
      "--overwrite"
    ];
    const result = await commandOutput(command, args, Math.max(120_000, config.PRODUCT_PROMO_TIMEOUT_SECONDS * 1_000), remotionDir);
    if (!result.ok) throw new AppError(`Remotion 审片版本渲染失败：${result.output.slice(-1_200) || "未返回日志"}`, "REVIEW_RENDER_FAILED", 502);
  }

  function getAdminActorId(request: any) {
    if (request.user?.sub) return String(request.user.sub);
    if (isLocalAdminDirectAccess(request)) return LOCAL_DEVELOPMENT_ACTOR_ID;
    return getUserId(request);
  }
}

async function readFrontendIndex(frontendRoot: string) {
  const candidates = [
    join(frontendRoot, "dist", "index.html"),
    join(frontendRoot, "index.html")
  ];
  for (const filePath of candidates) {
    if (await isRegularFile(filePath)) return readFile(filePath, "utf8");
  }
  throw new AppError("前端入口文件不存在。", "STATIC_FILE_NOT_FOUND", 404);
}

function serveFrontendAsset(reply: any, frontendRoot: string, baseFolder: "app" | "assets", assetPath: string) {
  return (async () => {
    const normalized = decodeFrontendAssetPath(assetPath);
    const roots = baseFolder === "assets"
      ? [join(frontendRoot, "dist", "assets"), join(frontendRoot, "assets")]
      : [join(frontendRoot, "app")];
    let filePath: string | null = null;
    for (const root of roots) {
      const candidate = resolve(root, normalized);
      if (!isInsideRoot(root, candidate)) {
        throw new AppError("静态文件路径非法。", "STATIC_FILE_FORBIDDEN", 403);
      }
      if (await isRegularFile(candidate)) {
        filePath = candidate;
        break;
      }
    }
    if (!filePath) throw new AppError("静态文件不存在。", "STATIC_FILE_NOT_FOUND", 404);
    reply.type(contentTypeFor(filePath));
    return reply.send(createReadStream(filePath));
  })();
}

function decodeFrontendAssetPath(assetPath: string) {
  const raw = String(assetPath || "").replace(/^\/+/, "");
  if (raw.includes("\0")) throw new AppError("静态文件路径非法。", "STATIC_FILE_FORBIDDEN", 403);
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new AppError("静态文件路径非法。", "STATIC_FILE_FORBIDDEN", 403);
  }
}

async function isRegularFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function isInsideRoot(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function contentTypeFor(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".html":
    default:
      return "text/html; charset=utf-8";
  }
}

function buildWorkflowInputFromIntent(body: z.infer<typeof agentProtocolSchema>) {
  const intent = asRecord(body.intent);
  return {
    ...intent,
    ...asRecord(intent.options),
    ...asRecord(intent.output),
    ...asRecord(intent.input),
    instruction: intent.instruction,
    typeKey: intent.typeKey,
    assets: intent.assets
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inferLocalFileMimeType(key: string) {
  const normalized = String(key || "").split("?")[0].toLowerCase();
  if (normalized.endsWith(".mp4")) return "video/mp4";
  if (normalized.endsWith(".webm")) return "video/webm";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".m4a")) return "audio/mp4";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".json")) return "application/json";
  if (normalized.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function reviewMotionStyles() {
  return [
    { id: "auto", name: "全自动", description: "按视频类型自动选择字幕、转场和重点动效。", creditHint: 3, colors: ["#7f6bff", "#20c4df"] },
    { id: "business", name: "商务", description: "干净转场、数据卡片、稳重强调，适合课程和企业内容。", creditHint: 4, colors: ["#102a62", "#35d3ff"] },
    { id: "minimal", name: "简约", description: "轻量淡入淡出、极简字幕和低干扰重点提示。", creditHint: 3, colors: ["#f7fbff", "#8b6cff"] },
    { id: "anime", name: "二次元", description: "高饱和描边、弹性入场、贴纸式强调。", creditHint: 5, colors: ["#ff4fc3", "#7f6bff"] },
    { id: "ppt", name: "PPT", description: "章节页、要点卡片、翻页式结构动效。", creditHint: 4, colors: ["#1c2148", "#ffd83d"] },
    { id: "cinematic", name: "电影感", description: "慢推拉、暗角、标题呼吸和片头片尾。", creditHint: 5, colors: ["#111827", "#d8b36a"] },
    { id: "beat", name: "卡点", description: "跟随音乐节拍做重点缩放和节奏闪切。", creditHint: 5, colors: ["#0b1026", "#c8ff36"] }
  ];
}

function reviewMotionCredits(styleId: string) {
  return Number(reviewMotionStyles().find(style => style.id === styleId)?.creditHint || 3);
}

function reviewTagCountForPlatform(platform: string) {
  const normalized = String(platform || "").toLowerCase();
  if (normalized.includes("小红书")) return 8;
  if (normalized.includes("抖音")) return 6;
  if (normalized.includes("b") || normalized.includes("站")) return 5;
  if (normalized.includes("视频号")) return 4;
  return 6;
}

function normalizeReviewCopyPackage(text: string, fallback: { title?: string; script?: string; typeKey?: string; typeName?: string; platform?: string; tagCount: number }) {
  const parsed = parseReviewJson(text);
  const titles = uniqueStrings(parsed.titles || parsed.titleOptions || parsed.title || [])
    .map(value => value.replace(/^["“”]+|["“”]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const fallbackTitle = String(fallback.title || fallback.typeName || "短视频成片").trim();
  while (titles.length < 3) titles.push(`${fallbackTitle}${titles.length ? ` · 版本${titles.length + 1}` : ""}`.slice(0, 28));
  const copy = String(parsed.copy || parsed.description || parsed.caption || fallback.script || fallbackTitle).replace(/\s+/g, " ").trim().slice(0, 80);
  const tags = normalizeReviewTags(parsed.tags || parsed.hashtags || [], fallback);
  return { titles, copy, tags, platform: fallback.platform || "自动适配" };
}

function parseReviewJson(text: string): Record<string, any> {
  const cleaned = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try extracting a JSON object below */ }
  const match = /\{[\s\S]*\}/.exec(cleaned);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  const lines = cleaned.split(/\r?\n/).map(line => line.replace(/^[\d\s.、-]+/, "").trim()).filter(Boolean);
  return { titles: lines.slice(0, 3), copy: lines[3] || lines[0] || "", tags: lines.filter(line => line.startsWith("#")) };
}

function normalizeReviewTags(rawTags: unknown, fallback: { typeKey?: string; typeName?: string; platform?: string; tagCount: number }) {
  const typeTags: Record<string, string[]> = {
    commerce: ["#商品种草", "#好物推荐", "#带货短视频"],
    talking: ["#知识口播", "#数字人", "#干货分享"],
    story: ["#剧情短片", "#反转剧情", "#短剧"],
    vlog: ["#VLOG", "#日常记录", "#探店"],
    mix: ["#文生播客", "#播客视频", "#音频视觉化"],
    event: ["#活动预告", "#同城活动", "#报名"]
  };
  const defaults = ["#e剪宝", "#AI视频", "#短视频创作", ...(typeTags[String(fallback.typeKey || "")] || []), fallback.typeName ? `#${fallback.typeName}` : "", fallback.platform && fallback.platform !== "自动适配" ? `#${fallback.platform}` : ""];
  const tags = uniqueStrings([...(Array.isArray(rawTags) ? rawTags : [rawTags]), ...defaults])
    .map(tag => `#${String(tag).replace(/^#+/, "").replace(/\s+/g, "")}`)
    .filter(tag => tag.length > 1);
  return tags.slice(0, fallback.tagCount);
}

function uniqueStrings(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function commandOutput(command: string, args: string[], timeoutMs = 30_000, cwd?: string) {
  return new Promise<{ ok: boolean; output: string }>(resolvePromise => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({ ok, output: Buffer.concat(chunks).toString("utf8") });
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.stdout?.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.once("error", () => finish(false));
    child.once("close", code => finish(code === 0));
  });
}

function normalizeTypeKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function resolveVideoWorkflowKey(typeKey: string) {
  const compact = typeKey.replace(/[\s_-]+/g, "");
  if (/(vlog|旅行|探店|日常|剪辑素材)/i.test(compact)) return "vlog-edit";
  if (/(commerce|product|商品推广|商品)/i.test(compact)) return "product-promo";
  if (/(story|drama|剧情|短剧|故事|剧情短片)/i.test(compact)) return "drama-short";
  if (/(mix|podcast|播客|文生播客|双人对话)/i.test(compact)) return "text-podcast";
  if (/(event|活动预告|活动宣传|倒计时|报名)/i.test(compact)) return "event-promo";
  // Knowledge/talking-head is intentionally recognized here even while its
  // executor is still blocked, so the user receives a precise install blocker.
  if (/(talking|口播|知识口播|数字人|数字人口播|presenter)/i.test(compact)) return "talking-head";
  return "";
}

function requireTaskId(value: string | null | undefined) {
  const taskId = String(value || "").trim();
  if (!taskId) throw new AppError("任务 ID 不能为空。", "TASK_ID_MISSING", 400);
  return taskId;
}

function taskPayload(task: any) {
  return {
    taskId: task.id,
    phase: String(task.status || "").toLowerCase(),
    task: {
      id: task.id,
      provider: task.provider,
      workflowKey: task.workflowKey,
      status: task.status,
      progress: task.progress,
      result: task.result,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
  };
}

function isLoopbackRequest(request: any) {
  const addresses = [request.raw?.socket?.remoteAddress, request.ip]
    .map(value => String(value || ""))
    .filter(Boolean);
  return addresses.some(address => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1");
}

function previewProviderConfigs(config: AppConfig) {
  const codexKey = config.CODEX_API_KEY || config.OPENAI_API_KEY;
  const deepseekKey = config.DEEPSEEK_API_KEY;
  const inferflowKey = config.INFERFLOW_API_KEY;
  return [
    {
      provider: "codex",
      baseUrl: config.CODEX_BASE_URL,
      model: config.CODEX_MODEL,
      reasoningEffort: config.CODEX_REASONING_EFFORT,
      enabled: true,
      apiKeyConfigured: Boolean(codexKey),
      apiKeyMasked: maskPreviewSecret(codexKey),
      source: "environment",
      updatedAt: null
    },
    {
      provider: "deepseek-harness",
      baseUrl: config.DEEPSEEK_BASE_URL,
      model: config.DEEPSEEK_MODEL,
      reasoningEffort: null,
      enabled: true,
      apiKeyConfigured: Boolean(deepseekKey),
      apiKeyMasked: maskPreviewSecret(deepseekKey),
      source: "environment",
      updatedAt: null
    },
    {
      provider: "inferflow",
      baseUrl: config.INFERFLOW_BASE_URL,
      model: "digital_human_standard",
      reasoningEffort: null,
      enabled: config.INFERFLOW_ENABLED,
      apiKeyConfigured: Boolean(inferflowKey),
      apiKeyMasked: maskPreviewSecret(inferflowKey),
      source: "environment",
      updatedAt: null
    }
  ];
}

function maskPreviewSecret(value: string) {
  if (!value) return "未配置";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function getUserId(request: any) {
  const userId = request.user?.sub;
  if (!userId) throw new AppError("登录已过期，请重新登录。", "AUTH_REQUIRED", 401);
  return String(userId);
}

const accountSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(6).max(24).optional(),
  password: z.string().min(8).max(200)
}).refine(value => Boolean(value.email) !== Boolean(value.phone), { message: "邮箱和手机号必须二选一。" });

const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(6).max(24).optional(),
  password: z.string().min(8).max(200),
  nickname: z.string().max(40).optional()
}).refine(value => Boolean(value.email) !== Boolean(value.phone), { message: "邮箱和手机号必须二选一。" });

const agentProtocolSchema = z.object({
  protocol: z.string().optional(),
  provider: z.string().optional(),
  operation: z.enum(["chat", "video.plan", "video.create", "task.status", "task.cancel"]),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().min(1) })).default([]),
  intent: z.object({ instruction: z.string().optional(), typeKey: z.string().optional() }).passthrough().nullable().optional(),
  context: z.record(z.string(), z.unknown()).default({}),
  taskId: z.string().nullable().optional()
});

const deepSeekProtocolSchema = agentProtocolSchema;

function buildOAuthProviders(config: AppConfig) {
  return {
    douyin: { authorizeUrl: "https://open.douyin.com/platform/oauth/connect/", tokenUrl: "https://open.douyin.com/oauth/access_token/", clientId: process.env.DOUYIN_CLIENT_KEY || "", clientSecret: process.env.DOUYIN_CLIENT_SECRET || "", redirectUri: process.env.DOUYIN_REDIRECT_URI || "", scopes: ["user_info"] },
    xiaohongshu: { authorizeUrl: process.env.XHS_AUTHORIZE_URL || "", tokenUrl: process.env.XHS_TOKEN_URL || "", clientId: process.env.XHS_APP_ID || "", clientSecret: process.env.XHS_APP_SECRET || "", redirectUri: process.env.XHS_REDIRECT_URI || "", scopes: ["user_info", "note_publish"] },
    wechat: { authorizeUrl: "https://open.weixin.qq.com/connect/qrconnect", tokenUrl: "https://api.weixin.qq.com/sns/oauth2/access_token", clientId: process.env.WECHAT_APP_ID || "", clientSecret: process.env.WECHAT_APP_SECRET || "", redirectUri: process.env.WECHAT_REDIRECT_URI || "", scopes: ["snsapi_login"] },
    bilibili: { authorizeUrl: process.env.BILIBILI_AUTHORIZE_URL || "", tokenUrl: process.env.BILIBILI_TOKEN_URL || "", clientId: process.env.BILIBILI_CLIENT_ID || "", clientSecret: process.env.BILIBILI_CLIENT_SECRET || "", redirectUri: process.env.BILIBILI_REDIRECT_URI || "", scopes: ["user_info", "video_publish"] }
  };
}
