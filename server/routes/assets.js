"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Hono } = require("hono");
const { db } = require("../../index");

const assetsRoute = new Hono();

const CONVERSATION_IMAGE_DIR = path.join(__dirname, "../../conversation-image-assets");
const CONVERSATION_VIDEO_DIR = path.join(__dirname, "../../conversation-video-assets");
const ROLE_ASSETS_DIR = path.join(__dirname, "../../role-assets");

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

assetsRoute.get("/roles/:roleName", async (c) => {
  try {
    const roleName = decodeURIComponent(c.req.param("roleName"));
    const imageDoc = await db.findOneAsync({
      type: "role-reference-image",
      roleName,
    });

    if (!imageDoc || !imageDoc.localPath || !fs.existsSync(imageDoc.localPath)) {
      return c.json({ ok: false, error: "未找到该角色人设头像" }, 404);
    }

    const fileBuffer = fs.readFileSync(imageDoc.localPath);
    const mime = imageDoc.mimeType || getMimeType(imageDoc.localPath);
    c.header("Content-Type", mime);
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(fileBuffer);
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

assetsRoute.get("/images/:filename", (c) => {
  try {
    const filename = path.basename(c.req.param("filename"));
    const filePath = path.join(CONVERSATION_IMAGE_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return c.json({ ok: false, error: "图片不存在" }, 404);
    }

    const fileBuffer = fs.readFileSync(filePath);
    c.header("Content-Type", getMimeType(filePath));
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(fileBuffer);
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

assetsRoute.get("/videos/:filename", (c) => {
  try {
    const filename = path.basename(c.req.param("filename"));
    const filePath = path.join(CONVERSATION_VIDEO_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return c.json({ ok: false, error: "视频不存在" }, 404);
    }

    const fileBuffer = fs.readFileSync(filePath);
    c.header("Content-Type", "video/mp4");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(fileBuffer);
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

module.exports = { assetsRoute };
