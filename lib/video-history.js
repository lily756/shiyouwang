const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function createVideoHistory({ db, assetsDir, maxBytes, maxEntries = 9, assetStore = null }) {
  function normalizeMimeType(value) {
    const mimeType = typeof value === "string"
      ? value.split(";", 1)[0].trim().toLowerCase()
      : "";
    return ["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)
      ? mimeType
      : "video/mp4";
  }

  function extensionForMimeType(mimeType) {
    if (mimeType === "video/webm") return "webm";
    if (mimeType === "video/quicktime") return "mov";
    return "mp4";
  }

  function isAssetPath(filePath) {
    if (typeof filePath !== "string" || !filePath) return false;
    const root = path.resolve(assetsDir);
    const target = path.resolve(filePath);
    return target.startsWith(`${root}${path.sep}`);
  }

  function createReferenceId() {
    return `vid_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  }

  function normalizeScope(scope) {
    if (scope?.chatId === undefined || scope?.userId === undefined) return null;
    return { chatId: scope.chatId, userId: scope.userId };
  }

  async function save({ scope, roleName, sourceLabel, caption, video, mimeType }) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope || !roleName || !Buffer.isBuffer(video) || video.length === 0) {
      return { ok: false, error: "视频历史记录数据不完整，无法保存。" };
    }
    if (video.length > maxBytes) {
      return { ok: false, error: "视频超过本地历史记录大小限制。" };
    }

    const normalizedMimeType = normalizeMimeType(mimeType);
    const referenceId = createReferenceId();
    const now = new Date().toISOString();
    const localPath = path.join(assetsDir, `${referenceId}.${extensionForMimeType(normalizedMimeType)}`);
    await fs.promises.mkdir(assetsDir, { recursive: true });
    await fs.promises.writeFile(localPath, video);

    let remoteAsset = null;
    if (assetStore?.isConfigured?.()) {
      try {
        remoteAsset = await assetStore.putBuffer({
          buffer: video,
          contentType: normalizedMimeType,
          category: "video-history",
          scope: normalizedScope,
          filename: `${referenceId}.${extensionForMimeType(normalizedMimeType)}`,
        });
      } catch (error) {
        console.warn("上传历史视频到 Wasabi 失败，保留本地副本:", error.message);
      }
    }

    try {
      await db.insertAsync({
        type: "chat-video-reference",
        ...normalizedScope,
        referenceId,
        roleName: String(roleName).slice(0, 64),
        sourceLabel: String(sourceLabel || "视频").slice(0, 32),
        caption: typeof caption === "string" ? caption.slice(0, 500) : "",
        localPath,
        mimeType: normalizedMimeType,
        byteLength: video.length,
        ...(remoteAsset?.ok ? {
          remoteObjectKey: remoteAsset.key,
          remoteUrl: remoteAsset.url,
        } : {}),
        createdAt: now,
      });
    } catch (error) {
      await fs.promises.unlink(localPath).catch(() => undefined);
      throw error;
    }

    return {
      ok: true,
      referenceId,
      roleName: String(roleName).slice(0, 64),
      sourceLabel: String(sourceLabel || "视频").slice(0, 32),
      caption: typeof caption === "string" ? caption.slice(0, 500) : "",
      ...(remoteAsset?.ok ? { remoteUrl: remoteAsset.url } : {}),
      createdAt: now,
    };
  }

  async function list({ scope, roleName }) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope || !roleName) return [];
    const records = await db.findAsync({
      type: "chat-video-reference",
      ...normalizedScope,
      roleName: String(roleName).slice(0, 64),
    });
    const sorted = records
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, maxEntries * 3);
    const usable = [];
    for (const record of sorted) {
      if (
        !record?.referenceId
        || (record.localPath && !isAssetPath(record.localPath))
        || (!record.localPath && !record.remoteObjectKey)
      ) continue;
      let localAvailable = false;
      if (record.localPath && isAssetPath(record.localPath)) {
        try {
          await fs.promises.access(record.localPath, fs.constants.R_OK);
          localAvailable = true;
        } catch {
          // Fall through to the Wasabi-backed record when available.
        }
      }
      if (localAvailable || record.remoteObjectKey) {
        usable.push({
          referenceId: record.referenceId,
          roleName: record.roleName,
          sourceLabel: record.sourceLabel || "视频",
          caption: record.caption || "",
          createdAt: record.createdAt || "",
        });
      }
      if (usable.length >= maxEntries) break;
    }
    return usable;
  }

  async function load({ scope, roleName, referenceId }) {
    const normalizedScope = normalizeScope(scope);
    const normalizedId = typeof referenceId === "string" ? referenceId.trim() : "";
    if (!normalizedScope || !roleName || !normalizedId) {
      return { ok: false, error: "历史视频标识无效。" };
    }
    const record = await db.findOneAsync({
      type: "chat-video-reference",
      ...normalizedScope,
      roleName: String(roleName).slice(0, 64),
      referenceId: normalizedId,
    });
    if (
      !record
      || (record.localPath && !isAssetPath(record.localPath))
      || (!record.localPath && !record.remoteObjectKey)
    ) {
      return { ok: false, error: "没有找到这段历史视频；请重新上传后再试。" };
    }

    try {
      let video;
      if (record.localPath && isAssetPath(record.localPath)) {
        video = await fs.promises.readFile(record.localPath);
      } else {
        if (!assetStore?.isConfigured?.() || !record.remoteObjectKey) {
          throw new Error("Wasabi 历史视频不可用。");
        }
        video = await assetStore.getBuffer({ key: record.remoteObjectKey, maxBytes });
      }
      if (video.length === 0 || video.length > maxBytes) {
        throw new Error("视频为空或超过大小限制。");
      }
      return {
        ok: true,
        referenceId: record.referenceId,
        roleName: record.roleName,
        sourceLabel: record.sourceLabel || "视频",
        caption: record.caption || "",
        video,
        mimeType: normalizeMimeType(record.mimeType),
      };
    } catch (error) {
      console.warn("读取历史视频失败:", error.message);
      return { ok: false, error: "这段历史视频已不可读取；请重新上传后再试。" };
    }
  }

  return { list, load, save };
}

module.exports = { createVideoHistory };
