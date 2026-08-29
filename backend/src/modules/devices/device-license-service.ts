import { createHash, sign, verify } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";

/**
 * 设备授权许可服务。
 * NetShield 负责程序保护；本服务负责后端可吊销、可过期、可审计的设备许可。
 * USB 指纹必须由 Windows 原生桥接层提供，不能只信任网页表单上传的字符串。
 */
export function createDeviceLicenseService({ config }: { config: AppConfig }) {
  async function bind({ userId, deviceId, usbFingerprint, publicKey, attestation }: { userId: string; deviceId: string; usbFingerprint: string; publicKey: string; attestation: string }) {
    if (!config.deviceLicensePrivateKey) throw new AppError("设备许可签名密钥尚未配置。", "DEVICE_LICENSE_NOT_CONFIGURED", 503);
    if (!deviceId || !usbFingerprint || !publicKey || !attestation) throw new AppError("设备授权材料不完整。", "DEVICE_ATTESTATION_INVALID");
    // TODO: 接入 Windows 原生桥接的签名挑战验证后，才允许正式签发许可。
    throw new AppError("Windows 设备挑战验证器尚未接入，暂不签发设备许可。", "DEVICE_ATTESTATION_ADAPTER_PENDING", 503);
  }

  function verifyLicense(payload: Record<string, string>, signature: string) {
    if (!config.deviceLicensePublicKey) throw new AppError("设备许可公钥尚未配置。", "DEVICE_LICENSE_NOT_CONFIGURED", 503);
    const content = canonical(payload);
    return verify(null, Buffer.from(content), config.deviceLicensePublicKey, Buffer.from(signature, "base64url"));
  }

  async function revoke(userId: string, licenseKeyId: string) {
    const result = await prisma.licenseBinding.updateMany({ where: { userId, licenseKeyId }, data: { status: "REVOKED" } });
    if (!result.count) throw new AppError("找不到设备许可。", "LICENSE_NOT_FOUND", 404);
    return { revoked: true };
  }

  return { bind, verifyLicense, revoke, fingerprintHint: (value: string) => createHash("sha256").update(value).digest("hex") };
}

function canonical(payload: Record<string, string>) {
  return Object.keys(payload).sort().map(key => `${key}=${payload[key]}`).join("&");
}
