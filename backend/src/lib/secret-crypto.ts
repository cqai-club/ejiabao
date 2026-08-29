import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors.js";

/** AES-256-GCM：数据库只保存密文，第三方 access/refresh token 不落明文。 */
export function encryptSecret(value: string, key: Buffer | null) {
  if (!key || key.length !== 32) throw new AppError("平台令牌加密密钥未配置。", "TOKEN_ENCRYPTION_NOT_CONFIGURED", 500);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSecret(value: string, key: Buffer | null) {
  if (!key || key.length !== 32) throw new AppError("平台令牌加密密钥未配置。", "TOKEN_ENCRYPTION_NOT_CONFIGURED", 500);
  const packed = Buffer.from(value, "base64url");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
