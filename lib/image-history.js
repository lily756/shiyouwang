const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function createImageHistory({ db, assetsDir, maxBytes, maxEntries = 9 }) {
  function normalizeMimeType(value) {
    const mimeType = typeof value === "string"
      ? value.split(";", 1)[0].trim().toLowerCase()
      : "";
    return /^image\/(?:jpeg|png|webp)$/i.test(mimeType) ? mimeType : "image/png";
  }

  function extensionForMimeType(mimeType) {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    return "png";
  }

  function isAssetPath(filePath) {
    if (typeof filePath !== "string" || !filePath) return false;
    const root = path.resolve(assetsDir);
    const target = path.resolve(filePath);
    return target.startsWith(`${root}${path.sep}`);
  }

  function createReferenceId() {
    return `img_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  }

  function normalizeScope(scope) {
    if (scope?.chatId === undefined || scope?.userId === undefined) return null;
    return { chatId: scope.chatId, userId: scope.userId };
  }

  async function save({ scope, roleName, sourceLabel, caption, image, mimeType }) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope || !roleName || !Buffer.isBuffer(image) || image.length === 0) {
      return { ok: false, error: "图片历史记录数据不完整，无法保存。" };
    }
    if (image.length > maxBytes) {
      return { ok: false, error: "图片超过本地历史记录大小限制。" };
    }

    const normalizedMimeType = normalizeMimeType(mimeType);
    const referenceId = createReferenceId();
    const now = new Date().toISOString();
    const localPath = path.join(assetsDir, `${referenceId}.${extensionForMimeType(normalizedMimeType)}`);
    await fs.promises.mkdir(assetsDir, { recursive: true });
    await fs.promises.writeFile(localPath, image);

    try {
      await db.insertAsync({
        type: "chat-image-reference",
        ...normalizedScope,
        referenceId,
        roleName: String(roleName).slice(0, 64),
        sourceLabel: String(sourceLabel || "图片").slice(0, 32),
        caption: typeof caption === "string" ? caption.slice(0, 500) : "",
        localPath,
        mimeType: normalizedMimeType,
        byteLength: image.length,
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
      sourceLabel: String(sourceLabel || "图片").slice(0, 32),
      caption: typeof caption === "string" ? caption.slice(0, 500) : "",
      createdAt: now,
    };
  }

  async function list({ scope, roleName }) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope || !roleName) return [];
    const records = await db.findAsync({
      type: "chat-image-reference",
      ...normalizedScope,
      roleName: String(roleName).slice(0, 64),
    });
    const sorted = records
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, maxEntries * 3);
    const usable = [];
    for (const record of sorted) {
      if (!record?.referenceId || !isAssetPath(record.localPath)) continue;
      try {
        await fs.promises.access(record.localPath, fs.constants.R_OK);
        usable.push({
          referenceId: record.referenceId,
          roleName: record.roleName,
          sourceLabel: record.sourceLabel || "图片",
          caption: record.caption || "",
          createdAt: record.createdAt || "",
        });
      } catch {
        // Missing old assets should not make the entire chat unusable.
      }
      if (usable.length >= maxEntries) break;
    }
    return usable;
  }

  async function load({ scope, roleName, referenceId }) {
    const normalizedScope = normalizeScope(scope);
    const normalizedId = typeof referenceId === "string" ? referenceId.trim() : "";
    if (!normalizedScope || !roleName || !normalizedId) {
      return { ok: false, error: "历史图片标识无效。" };
    }
    const record = await db.findOneAsync({
      type: "chat-image-reference",
      ...normalizedScope,
      roleName: String(roleName).slice(0, 64),
      referenceId: normalizedId,
    });
    if (!record?.localPath || !isAssetPath(record.localPath)) {
      return { ok: false, error: "没有找到这张历史图片；请重新上传后再试。" };
    }

    try {
      const image = await fs.promises.readFile(record.localPath);
      if (image.length === 0 || image.length > maxBytes) {
        throw new Error("图片为空或超过大小限制。");
      }
      return {
        ok: true,
        referenceId: record.referenceId,
        roleName: record.roleName,
        sourceLabel: record.sourceLabel || "图片",
        caption: record.caption || "",
        image,
        mimeType: normalizeMimeType(record.mimeType),
      };
    } catch (error) {
      console.warn("读取历史图片失败:", error.message);
      return { ok: false, error: "这张历史图片已不可读取；请重新上传后再试。" };
    }
  }

  return { list, load, save };
}

module.exports = { createImageHistory };
