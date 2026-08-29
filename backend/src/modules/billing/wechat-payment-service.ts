import { createDecipheriv, createPrivateKey, createPublicKey, createSign, createVerify, randomBytes } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";

type QuotaPackage = { key: string; name: string; credits: number; amountFen: number };

/** 微信支付 API v3 Native 扫码支付：下单、查单、关单、通知验签和额度入账。 */
export function createWechatPaymentService({ config, creditInTransaction }: { config: AppConfig; creditInTransaction: (tx: any, input: { userId: string; amount: number; reason: string; idempotencyKey?: string }) => Promise<unknown> }) {
  const packages = parsePackages(config.QUOTA_PACKAGES_JSON);
  const enabled = Boolean(config.WECHAT_PAY_ENABLED);

  function assertConfigured() {
    if (!enabled) throw new AppError("微信支付尚未启用。", "WECHAT_PAY_DISABLED", 503);
    if (!config.WECHAT_PAY_APPID || !config.WECHAT_PAY_MCHID || !config.WECHAT_PAY_SERIAL_NO || !config.WECHAT_PAY_PRIVATE_KEY_B64 || !config.WECHAT_PAY_API_V3_KEY || !config.WECHAT_PAY_PLATFORM_SERIAL_NO || !config.WECHAT_PAY_PLATFORM_PUBLIC_KEY_B64 || !config.WECHAT_PAY_NOTIFY_URL) {
      throw new AppError("微信支付 API v3 凭据尚未完整配置。", "WECHAT_PAY_NOT_CONFIGURED", 503);
    }
    if (Buffer.from(config.WECHAT_PAY_API_V3_KEY, "utf8").length !== 32) throw new AppError("微信支付 API v3 密钥必须是 32 字节。", "WECHAT_PAY_KEY_INVALID", 500);
  }

  function listPackages() {
    return packages.map(item => ({ ...item, amountYuan: (item.amountFen / 100).toFixed(2) }));
  }

  async function createOrder({ userId, packageKey }: { userId: string; packageKey: string }) {
    assertConfigured();
    const item = packages.find(entry => entry.key === packageKey);
    if (!item) throw new AppError("充值套餐不存在。", "QUOTA_PACKAGE_NOT_FOUND", 400);
    const outTradeNo = createOutTradeNo();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const order = await prisma.paymentOrder.create({ data: { userId, packageKey: item.key, packageName: item.name, quotaAmount: item.credits, amountFen: item.amountFen, outTradeNo, status: "PENDING", expiresAt } });
    try {
      const response = await wechatRequest({ method: "POST", path: "/v3/pay/transactions/native", body: { appid: config.WECHAT_PAY_APPID, mchid: config.WECHAT_PAY_MCHID, description: item.name, out_trade_no: outTradeNo, time_expire: toWechatTime(expiresAt), notify_url: config.WECHAT_PAY_NOTIFY_URL, amount: { total: item.amountFen, currency: "CNY" } } });
      const updated = await prisma.paymentOrder.update({ where: { id: order.id }, data: { codeUrl: String(response.code_url || "") } });
      return { id: updated.id, outTradeNo, package: item, amountYuan: (item.amountFen / 100).toFixed(2), codeUrl: updated.codeUrl, expiresAt };
    } catch (error) {
      await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "FAILED" } }).catch(() => undefined);
      throw error;
    }
  }

  async function getOrder(userId: string, id: string, sync = true) {
    const order = await prisma.paymentOrder.findFirst({ where: { id, userId } });
    if (!order) throw new AppError("支付订单不存在。", "PAYMENT_ORDER_NOT_FOUND", 404);
    if (sync && order.status === "PENDING" && order.expiresAt > new Date()) await syncOrder(order.outTradeNo);
    const latest = await prisma.paymentOrder.findUnique({ where: { id } });
    return latest;
  }

  async function syncOrder(outTradeNo: string) {
    assertConfigured();
    const order = await prisma.paymentOrder.findUnique({ where: { outTradeNo } });
    if (!order) throw new AppError("支付订单不存在。", "PAYMENT_ORDER_NOT_FOUND", 404);
    if (order.status === "SUCCESS" || order.status === "CLOSED") return order;
    const response = await wechatRequest({ method: "GET", path: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.WECHAT_PAY_MCHID)}` });
    if (response.trade_state === "SUCCESS") return settlePaidOrder({ outTradeNo, transactionId: String(response.transaction_id || ""), notifyId: null, paidAt: response.success_time ? new Date(response.success_time) : new Date(), amountFen: Number(response.amount?.total || 0) });
    if (response.trade_state === "CLOSED" || response.trade_state === "REVOKED") return prisma.paymentOrder.update({ where: { outTradeNo }, data: { status: "CLOSED", closedAt: new Date() } });
    return order;
  }

  async function closeOrder(userId: string, id: string) {
    assertConfigured();
    const order = await prisma.paymentOrder.findFirst({ where: { id, userId } });
    if (!order) throw new AppError("支付订单不存在。", "PAYMENT_ORDER_NOT_FOUND", 404);
    if (order.status !== "PENDING") return order;
    await wechatRequest({ method: "POST", path: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.outTradeNo)}/close`, body: { mchid: config.WECHAT_PAY_MCHID } });
    return prisma.paymentOrder.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  }

  async function handleNotify({ rawBody, headers }: { rawBody: string; headers: Record<string, string | undefined> }) {
    assertConfigured();
    verifyWechatSignature({ timestamp: headers["wechatpay-timestamp"], nonce: headers["wechatpay-nonce"], signature: headers["wechatpay-signature"], serial: headers["wechatpay-serial"], body: rawBody });
    const envelope = JSON.parse(rawBody) as any;
    if (envelope.event_type !== "TRANSACTION.SUCCESS") return { accepted: true, ignored: true };
    const resource = decryptNotification(envelope.resource);
    if (resource.mchid !== config.WECHAT_PAY_MCHID || resource.appid !== config.WECHAT_PAY_APPID) throw new AppError("微信支付通知商户信息不匹配。", "WECHAT_NOTIFY_MERCHANT_MISMATCH", 400);
    return settlePaidOrder({ outTradeNo: String(resource.out_trade_no || ""), transactionId: String(resource.transaction_id || ""), notifyId: String(envelope.id || ""), paidAt: resource.success_time ? new Date(resource.success_time) : new Date(), amountFen: Number(resource.amount?.total || 0) });
  }

  async function settlePaidOrder({ outTradeNo, transactionId, notifyId, paidAt, amountFen }: { outTradeNo: string; transactionId: string; notifyId: string | null; paidAt: Date; amountFen: number }) {
    if (!outTradeNo || !transactionId) throw new AppError("微信支付订单信息不完整。", "WECHAT_NOTIFY_INVALID", 400);
    return prisma.$transaction(async tx => {
      const order = await tx.paymentOrder.findUnique({ where: { outTradeNo } });
      if (!order) throw new AppError("找不到对应的充值订单。", "PAYMENT_ORDER_NOT_FOUND", 404);
      if (order.amountFen !== amountFen) throw new AppError("支付金额与订单金额不一致。", "PAYMENT_AMOUNT_MISMATCH", 400);
      if (order.status === "SUCCESS") return order;
      await creditInTransaction(tx, { userId: order.userId, amount: order.quotaAmount, reason: `微信支付充值：${order.packageName}`, idempotencyKey: `payment:${order.outTradeNo}` });
      return tx.paymentOrder.update({ where: { id: order.id }, data: { status: "SUCCESS", transactionId, notifyId, paidAt } });
    });
  }

  return { enabled, configured: enabled && packages.length > 0, listPackages, createOrder, getOrder, syncOrder, closeOrder, handleNotify };

  async function wechatRequest({ method, path, body }: { method: "GET" | "POST"; path: string; body?: Record<string, unknown> }) {
    assertConfigured();
    const rawBody = body ? JSON.stringify(body) : "";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString("hex");
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${rawBody}\n`;
    const signer = createSign("RSA-SHA256");
    signer.update(message); signer.end();
    const signature = signer.sign(createPrivateKey(privateKeyPem()), "base64");
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.WECHAT_PAY_MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.WECHAT_PAY_SERIAL_NO}",signature="${signature}"`;
    const response = await fetch(`${config.WECHAT_PAY_API_BASE_URL}${path}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: authorization }, body: method === "POST" ? rawBody : undefined });
    const responseBody = await response.text();
    let data: any = {}; try { data = responseBody ? JSON.parse(responseBody) : {}; } catch { data = { raw: responseBody }; }
    if (!response.ok) throw new AppError(data.message || "微信支付接口调用失败。", "WECHAT_API_ERROR", response.status, { code: data.code, detail: data.detail });
    verifyWechatResponse(response.headers, responseBody);
    return data;
  }

  function verifyWechatSignature({ timestamp, nonce, signature, serial, body }: { timestamp?: string; nonce?: string; signature?: string; serial?: string; body: string }) {
    if (!timestamp || !nonce || !signature || !serial) throw new AppError("微信支付通知签名头不完整。", "WECHAT_NOTIFY_SIGNATURE_MISSING", 400);
    if (serial !== config.WECHAT_PAY_PLATFORM_SERIAL_NO) throw new AppError("微信支付平台证书序列号不匹配。", "WECHAT_NOTIFY_SERIAL_MISMATCH", 400);
    const verifier = createVerify("RSA-SHA256"); verifier.update(`${timestamp}\n${nonce}\n${body}\n`); verifier.end();
    if (!verifier.verify(createPublicKey(platformPublicKeyPem()), signature, "base64")) throw new AppError("微信支付通知验签失败。", "WECHAT_NOTIFY_SIGNATURE_INVALID", 400);
  }

  function verifyWechatResponse(headers: Headers, body: string) {
    const timestamp = headers.get("wechatpay-timestamp"); const nonce = headers.get("wechatpay-nonce"); const signature = headers.get("wechatpay-signature");
    if (!timestamp || !nonce || !signature || !config.WECHAT_PAY_PLATFORM_PUBLIC_KEY_B64) return;
    const verifier = createVerify("RSA-SHA256"); verifier.update(`${timestamp}\n${nonce}\n${body}\n`); verifier.end();
    if (!verifier.verify(createPublicKey(platformPublicKeyPem()), signature, "base64")) throw new AppError("微信支付响应验签失败。", "WECHAT_RESPONSE_SIGNATURE_INVALID", 502);
  }

  function decryptNotification(resource: any) {
    if (!resource?.ciphertext || !resource.nonce) throw new AppError("微信支付通知密文不完整。", "WECHAT_NOTIFY_RESOURCE_INVALID", 400);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(config.WECHAT_PAY_API_V3_KEY, "utf8"), Buffer.from(resource.nonce, "utf8"));
    decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8"));
    const packed = Buffer.from(resource.ciphertext, "base64");
    decipher.setAuthTag(packed.subarray(packed.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(0, packed.length - 16)), decipher.final()]).toString("utf8"));
  }

  function privateKeyPem() { return Buffer.from(config.WECHAT_PAY_PRIVATE_KEY_B64, "base64").toString("utf8"); }
  function platformPublicKeyPem() { return Buffer.from(config.WECHAT_PAY_PLATFORM_PUBLIC_KEY_B64, "base64").toString("utf8"); }
}

function parsePackages(raw: string): QuotaPackage[] {
  try {
    const values = JSON.parse(raw || "[]");
    if (!Array.isArray(values)) throw new Error();
    return values.map(item => ({ key: String(item.key), name: String(item.name), credits: Number(item.credits), amountFen: Number(item.amountFen) })).filter(item => item.key && item.name && Number.isInteger(item.credits) && item.credits > 0 && Number.isInteger(item.amountFen) && item.amountFen > 0);
  } catch { throw new AppError("QUOTA_PACKAGES_JSON 配置格式错误。", "QUOTA_PACKAGES_INVALID", 500); }
}

function createOutTradeNo() { return `EJ${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`.slice(0, 32); }
function toWechatTime(date: Date) {
  // 微信支付要求 RFC3339 带时区；把同一时刻格式化为东八区时间，不能只替换字符串中的 Z。
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+08:00");
}
