import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

export function createObjectStorage({ config }: { config: AppConfig }) {
  const localMode = Boolean(
    !config.isProduction
      && (config.LOCAL_STORAGE_ENABLED || (config.OSS_ACCESS_KEY_ID === "local-preview" && config.OSS_ACCESS_KEY_SECRET === "local-preview"))
  );
  const localRoot = resolve(config.LOCAL_STORAGE_DIR || join(process.cwd(), "runtime", "uploads"));
  const apiBaseUrl = config.API_PUBLIC_URL.replace(/\/$/, "");

  function localPath(key: string) {
    const normalized = String(key || "").replace(/\\/g, "/");
    if (!normalized.startsWith("users/") || normalized.includes("..")) {
      throw new AppError("本地素材路径无效。", "LOCAL_STORAGE_KEY_INVALID", 400);
    }
    const destination = resolve(localRoot, normalized);
    const rootPrefix = localRoot.endsWith(sep) ? localRoot : `${localRoot}${sep}`;
    if (!destination.startsWith(rootPrefix)) throw new AppError("本地素材路径越界。", "LOCAL_STORAGE_KEY_INVALID", 400);
    return destination;
  }

  function localToken(key: string) {
    return createHmac("sha256", config.JWT_SECRET).update(`ejiabao-local-upload:${key}`).digest("hex");
  }

  function localPreviewUrl(key: string) {
    return `${apiBaseUrl}/v1/uploads/local-file?key=${encodeURIComponent(key)}`;
  }

  if (!localMode && (!config.OSS_ACCESS_KEY_ID || !config.OSS_ACCESS_KEY_SECRET)) {
    return {
      configured: false,
      mode: "none" as const,
      local: false,
      async createUploadUrl() { throw new AppError("对象存储尚未配置。", "STORAGE_NOT_CONFIGURED", 503); },
      async createDownloadUrl() { throw new AppError("对象存储尚未配置。", "STORAGE_NOT_CONFIGURED", 503); },
      async downloadToFile() { throw new AppError("对象存储尚未配置。", "STORAGE_NOT_CONFIGURED", 503); },
      async uploadFile() { throw new AppError("对象存储尚未配置。", "STORAGE_NOT_CONFIGURED", 503); },
      async acceptLocalUpload() { throw new AppError("本地上传未启用。", "LOCAL_STORAGE_DISABLED", 503); },
      async getLocalFile(): Promise<{ path: string; sizeBytes: number }> { throw new AppError("本地存储未启用。", "LOCAL_STORAGE_DISABLED", 503); }
    };
  }

  if (localMode) {
    async function createUploadUrl({ userId, filename, mimeType, sizeBytes }: { userId: string; filename: string; mimeType: string; sizeBytes: number }) {
      if (!filename || !mimeType || !Number.isFinite(sizeBytes)) throw new AppError("上传文件信息不完整。", "UPLOAD_METADATA_INVALID");
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `users/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
      const token = localToken(key);
      return {
        key,
        transport: "local" as const,
        uploadUrl: `${apiBaseUrl}/v1/uploads/local?key=${encodeURIComponent(key)}&token=${token}`,
        previewUrl: localPreviewUrl(key)
      };
    }

    async function createDownloadUrl(key: string) {
      localPath(key);
      return { downloadUrl: localPreviewUrl(key) };
    }

    async function acceptLocalUpload({ key, token, body, expectedSizeBytes }: { key: string; token: string; body: unknown; expectedSizeBytes?: number }) {
      const expectedToken = localToken(key);
      const valid = token.length === expectedToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
      if (!valid) throw new AppError("本地上传凭证无效。", "LOCAL_UPLOAD_TOKEN_INVALID", 403);
      const data = Buffer.isBuffer(body)
        ? body
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : Buffer.from(String(body || ""));
      if (!data.length) throw new AppError("上传文件为空。", "UPLOAD_EMPTY", 400);
      if (expectedSizeBytes && data.length !== expectedSizeBytes) throw new AppError("上传文件大小与凭证不一致。", "UPLOAD_SIZE_MISMATCH", 400);
      const destination = localPath(key);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
      return { key, sizeBytes: data.length };
    }

    async function getLocalFile(key: string) {
      const path = localPath(key);
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error("not-file");
        return { path, sizeBytes: info.size };
      } catch {
        throw new AppError("素材文件尚未上传完成。", "LOCAL_FILE_NOT_FOUND", 404);
      }
    }

    async function downloadToFile(key: string, destinationPath: string) {
      const source = await getLocalFile(key);
      await mkdir(dirname(destinationPath), { recursive: true });
      await pipeline(createReadStream(source.path), createWriteStream(destinationPath));
      return { key, destinationPath };
    }

    async function uploadFile({ key, filePath, contentType }: { key: string; filePath: string; contentType: string }) {
      if (!key || !filePath || !contentType) throw new AppError("上传产物信息不完整。", "STORAGE_OUTPUT_INVALID", 400);
      const destination = localPath(key);
      await mkdir(dirname(destination), { recursive: true });
      await pipeline(createReadStream(filePath), createWriteStream(destination));
      return { key, publicUrl: localPreviewUrl(key) };
    }

    return { configured: true, mode: "local" as const, local: true, createUploadUrl, createDownloadUrl, downloadToFile, uploadFile, acceptLocalUpload, getLocalFile };
  }

  const client = new S3Client({
    region: config.OSS_REGION,
    endpoint: config.OSS_ENDPOINT,
    forcePathStyle: false,
    credentials: { accessKeyId: config.OSS_ACCESS_KEY_ID, secretAccessKey: config.OSS_ACCESS_KEY_SECRET }
  });

  async function createUploadUrl({ userId, filename, mimeType, sizeBytes }: { userId: string; filename: string; mimeType: string; sizeBytes: number }) {
    if (!filename || !mimeType || !Number.isFinite(sizeBytes)) throw new AppError("上传文件信息不完整。", "UPLOAD_METADATA_INVALID");
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `users/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
    // 浏览器无法设置被签名的 Content-Length 请求头；大小仍由 presign 元数据和工作流输入契约记录。
    const command = new PutObjectCommand({ Bucket: config.OSS_BUCKET, Key: key, ContentType: mimeType });
    const preview = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.OSS_BUCKET, Key: key }), { expiresIn: 900 });
    return { key, transport: "oss" as const, uploadUrl: await getSignedUrl(client, command, { expiresIn: 900 }), previewUrl: preview };
  }

  async function createDownloadUrl(key: string) {
    if (!key) throw new AppError("素材 key 不能为空。", "STORAGE_KEY_INVALID");
    const command = new GetObjectCommand({ Bucket: config.OSS_BUCKET, Key: key });
    return { downloadUrl: await getSignedUrl(client, command, { expiresIn: 900 }) };
  }

  /** 工作流执行器专用：把用户已授权的 OSS 素材下载到任务私有目录。 */
  async function downloadToFile(key: string, destinationPath: string) {
    if (!key || !destinationPath) throw new AppError("下载素材信息不完整。", "STORAGE_DOWNLOAD_INVALID", 400);
    const response = await client.send(new GetObjectCommand({ Bucket: config.OSS_BUCKET, Key: key }));
    if (!response.Body || typeof (response.Body as any).pipe !== "function") {
      throw new AppError("对象存储未返回可读取的素材。", "STORAGE_OBJECT_UNAVAILABLE", 502);
    }
    await mkdir(dirname(destinationPath), { recursive: true });
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destinationPath));
    return { key, destinationPath };
  }

  /** 工作流执行器专用：将成片和辅助产物回传到用户任务目录。 */
  async function uploadFile({ key, filePath, contentType }: { key: string; filePath: string; contentType: string }) {
    if (!key || !filePath || !contentType) throw new AppError("上传产物信息不完整。", "STORAGE_OUTPUT_INVALID", 400);
    await client.send(new PutObjectCommand({ Bucket: config.OSS_BUCKET, Key: key, Body: createReadStream(filePath), ContentType: contentType }));
    return { key, publicUrl: config.OSS_PUBLIC_BASE_URL ? `${config.OSS_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}` : null };
  }

  async function acceptLocalUpload() { throw new AppError("本地上传未启用。", "LOCAL_STORAGE_DISABLED", 503); }
  async function getLocalFile(): Promise<{ path: string; sizeBytes: number }> { throw new AppError("本地存储未启用。", "LOCAL_STORAGE_DISABLED", 503); }

  return { configured: true, mode: "oss" as const, local: false, createUploadUrl, createDownloadUrl, downloadToFile, uploadFile, acceptLocalUpload, getLocalFile };
}
