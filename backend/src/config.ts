import { z } from "zod";

const envBoolean = z.preprocess(value => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  API_PUBLIC_URL: z.string().min(1),
  // U 盘桌面端通常以 file:// 打开，浏览器发出的 Origin 可能是 null；两者都允许。
  WEB_ORIGIN: z.string().default("null,file://"),
  // 未启用 OAuth/后台密钥加密时允许留空；一旦填写必须为 32-byte AES key 的十六进制值。
  PLATFORM_TOKEN_ENCRYPTION_KEY: z.union([z.literal(""), z.string().regex(/^[a-fA-F0-9]{64}$/)]).default(""),
  DEVICE_LICENSE_PRIVATE_KEY_B64: z.string().optional().default(""),
  DEVICE_LICENSE_PUBLIC_KEY_B64: z.string().optional().default(""),
  OSS_ENDPOINT: z.string().min(1),
  OSS_REGION: z.string().min(1),
  OSS_BUCKET: z.string().min(1),
  OSS_ACCESS_KEY_ID: z.string().min(1),
  OSS_ACCESS_KEY_SECRET: z.string().min(1),
  OSS_PUBLIC_BASE_URL: z.string().optional().default(""),
  // 本地预览时可把上传落到 backend/runtime/uploads，避免占位 OSS 凭据导致浏览器直传失败。
  LOCAL_STORAGE_ENABLED: envBoolean.default(false),
  LOCAL_STORAGE_DIR: z.string().default("./runtime/uploads"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-5"),
  // DeepSeek 官方兼容接口；密钥只保留在云端后端。
  DEEPSEEK_API_KEY: z.string().optional().default(""),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  // Current official default model can still be changed in the encrypted
  // provider configuration centre at any time.
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
  // Codex 云端 API：OpenAI Responses API + GPT-5.3-Codex。
  CODEX_API_KEY: z.string().optional().default(""),
  // 默认按你提供的 ZroCode 实际协议；可切换回官方 OpenAI API。
  CODEX_BASE_URL: z.string().url().default("https://zrocode.cc/v1"),
  CODEX_MODEL: z.string().default("gpt-5.3-codex"),
  CODEX_REASONING_EFFORT: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  CODEX_PROXY_URL: z.string().optional().default(""),
  CODEX_PROXY_TOKEN: z.string().optional().default(""),
  DEEPSEEK_HARNESS_PROXY_URL: z.string().optional().default(""),
  DEEPSEEK_HARNESS_PROXY_TOKEN: z.string().optional().default(""),
  // InferFlow 数字人工作流仅由后端调用；密钥不会进入浏览器或桌面端。
  INFERFLOW_ENABLED: envBoolean.default(false),
  INFERFLOW_API_KEY: z.string().optional().default(""),
  INFERFLOW_BASE_URL: z.string().url().default("https://saas.inferflow.dev/openapi/v1"),
  // 微信支付 Native 扫码支付。所有私钥只部署在云端，不进入桌面端。
  WECHAT_PAY_ENABLED: envBoolean.default(false),
  WECHAT_PAY_APPID: z.string().optional().default(""),
  WECHAT_PAY_MCHID: z.string().optional().default(""),
  WECHAT_PAY_SERIAL_NO: z.string().optional().default(""),
  WECHAT_PAY_PRIVATE_KEY_B64: z.string().optional().default(""),
  WECHAT_PAY_API_V3_KEY: z.string().optional().default(""),
  WECHAT_PAY_PLATFORM_SERIAL_NO: z.string().optional().default(""),
  WECHAT_PAY_PLATFORM_PUBLIC_KEY_B64: z.string().optional().default(""),
  WECHAT_PAY_NOTIFY_URL: z.string().url().or(z.literal("")).default(""),
  WECHAT_PAY_API_BASE_URL: z.string().url().default("https://api.mch.weixin.qq.com"),
  // 例：[ {"key":"starter","name":"100积分","credits":100,"amountFen":990 } ]
  QUOTA_PACKAGES_JSON: z.string().default("[]"),
  // 六大工作流定价接入前，禁止客户端自行提交扣费额度。
  ALLOW_CLIENT_TASK_CREDITS: envBoolean.default(false),
  // 商品推广（dsh-product-promo）由服务端后台运行，绝不在桌面端执行 Python 或保存模型密钥。
  PRODUCT_PROMO_ENABLED: envBoolean.default(true),
  PRODUCT_PROMO_PYTHON_BIN: z.string().default("python"),
  PRODUCT_PROMO_WORKFLOW_DIR: z.string().optional().default(""),
  WORKFLOW_DATA_DIR: z.string().optional().default(""),
  PRODUCT_PROMO_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(7200).default(3600),
  PRODUCT_PROMO_CREDITS_PER_15_SECONDS: z.coerce.number().int().min(1).max(100).default(2),
  VLOG_EDIT_ENABLED: envBoolean.default(false),
  VLOG_EDIT_PYTHON_BIN: z.string().optional().default(""),
  VLOG_EDIT_WORKFLOW_DIR: z.string().optional().default(""),
  VLOG_EDIT_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(7200).default(3600),
  VLOG_EDIT_CREDITS_PER_15_SECONDS: z.coerce.number().int().min(1).max(100).default(2),
  DRAMA_SHORT_ENABLED: envBoolean.default(false),
  DRAMA_SHORT_PYTHON_BIN: z.string().optional().default(""),
  DRAMA_SHORT_WORKFLOW_DIR: z.string().optional().default(""),
  DRAMA_SHORT_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(7200).default(3600),
  DRAMA_SHORT_CREDITS_PER_15_SECONDS: z.coerce.number().int().min(1).max(100).default(3),
  PODCAST_ENABLED: envBoolean.default(false),
  PODCAST_PYTHON_BIN: z.string().optional().default(""),
  PODCAST_WORKFLOW_DIR: z.string().optional().default(""),
  PODCAST_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(7200).default(3600),
  PODCAST_CREDITS_PER_15_SECONDS: z.coerce.number().int().min(1).max(100).default(3),
  EVENT_PROMO_ENABLED: envBoolean.default(false),
  EVENT_PROMO_PYTHON_BIN: z.string().optional().default(""),
  EVENT_PROMO_WORKFLOW_DIR: z.string().optional().default(""),
  EVENT_PROMO_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(7200).default(3600),
  EVENT_PROMO_CREDITS_PER_15_SECONDS: z.coerce.number().int().min(1).max(100).default(2),
  DSH_FFMPEG: z.string().optional().default(""),
  DSH_DIGITAL_HUMAN: z.string().optional().default(""),
  DSH_TTS_PYTHON: z.string().optional().default(""),
  DSH_TTS_SCRIPT: z.string().optional().default(""),
  DISABLE_SOCIAL_OAUTH: envBoolean.default(true),
  // Local-only UI preview; never enable this in production.
  ADMIN_PREVIEW_MODE: envBoolean.default(false),
  // Local-only convenience switch. It never bypasses auth in production or
  // for non-loopback requests.
  ADMIN_DIRECT_ACCESS: envBoolean.default(false)
});

export function loadConfig(env = process.env) {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    isProduction: parsed.NODE_ENV === "production",
    corsOrigin: parsed.WEB_ORIGIN.split(",").map(value => value.trim()).filter(Boolean),
    tokenEncryptionKey: parsed.PLATFORM_TOKEN_ENCRYPTION_KEY ? Buffer.from(parsed.PLATFORM_TOKEN_ENCRYPTION_KEY, "hex") : null,
    deviceLicensePrivateKey: parsed.DEVICE_LICENSE_PRIVATE_KEY_B64 ? Buffer.from(parsed.DEVICE_LICENSE_PRIVATE_KEY_B64, "base64").toString("utf8") : "",
    deviceLicensePublicKey: parsed.DEVICE_LICENSE_PUBLIC_KEY_B64 ? Buffer.from(parsed.DEVICE_LICENSE_PUBLIC_KEY_B64, "base64").toString("utf8") : ""
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
