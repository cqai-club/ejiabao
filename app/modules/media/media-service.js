const DEFAULT_RULES = {
  image: { types: ["image/jpeg", "image/jpg", "image/png", "image/webp"], maxBytes: 20 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 500 * 1024 * 1024 },
  audio: { types: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/webm"], maxBytes: 100 * 1024 * 1024 },
  document: { types: ["text/plain", "text/markdown", "application/pdf", "application/rtf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], maxBytes: 50 * 1024 * 1024 }
};

/** 素材入口的统一校验器，后续可替换为桌面端文件系统实现。 */
export function createMediaService({ eventBus, http, rules = DEFAULT_RULES }) {
  function validate(file, kind = "image") {
    if (!file) return { ok: false, code: "EMPTY", message: "没有选择文件。" };
    const rule = rules[kind];
    if (!rule) return { ok: false, code: "UNKNOWN_KIND", message: `不支持的素材类型：${kind}` };
    const normalizedType = String(file.type || "").toLowerCase();
    const typeAllowed = rule.types.includes(normalizedType)
      || (kind === "image" && normalizedType === "image/jpg")
      || (kind === "audio" && ["audio/wave", "audio/x-wav"].includes(normalizedType));
    if (!typeAllowed) return { ok: false, code: "TYPE", message: "文件格式不符合当前入口要求。" };
    if (file.size > rule.maxBytes) return { ok: false, code: "SIZE", message: "文件超过当前入口的大小限制。" };
    return { ok: true, file, kind };
  }

  function describe(file) {
    return { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified };
  }

  function emitUploaded(file, kind) {
    const metadata = describe(file);
    eventBus.emit("media:uploaded", { ...metadata, kind });
    return metadata;
  }

  async function upload(file, kind = inferKind(file), metadata = {}) {
    const validation = validate(file, kind);
    if (!validation.ok) throw new Error(validation.message);
    const signed = await http.post("/v1/uploads/presign", {
      filename: file.name,
      mimeType: String(file.type || "application/octet-stream").toLowerCase(),
      sizeBytes: file.size,
      kind,
      category: metadata.category || undefined,
      role: metadata.role || undefined,
      tags: Array.isArray(metadata.tags) ? metadata.tags : undefined
    }, { timeoutMs: 30000 });
    const uploadUrl = signed.data?.uploadUrl;
    const asset = signed.data?.asset;
    if (!uploadUrl || !asset?.id) throw new Error("素材上传凭证无效。");
    let response;
    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });
    } catch (error) {
      throw new Error("素材上传连接失败，请检查后端存储配置或对象存储 CORS。");
    }
    if (!response.ok) throw new Error(`素材上传失败（${response.status}）。`);
    const result = { ...asset, name: file.name, kind, previewUrl: asset.previewUrl || signed.data?.previewUrl || null };
    eventBus.emit("media:uploaded", result);
    return result;
  }

  return { validate, describe, emitUploaded, upload };
}

function inferKind(file) {
  const type = String(file?.type || "");
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || ["application/pdf", "application/rtf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(type)) return "document";
  return "image";
}
