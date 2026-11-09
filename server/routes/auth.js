"use strict";

const { Hono } = require("hono");
const { db } = require("../../index");
const { getScope } = require("../utils");

const authRoute = new Hono();

authRoute.post("/verify-code", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const code = String(body.code || "").trim();
    if (!code) {
      return c.json({ ok: false, error: "请输入 6 位绑定验证码" }, 400);
    }

    const record = await db.findOneAsync({
      type: "auth-bind-code",
      code,
    });

    if (!record) {
      return c.json({ ok: false, error: "绑定码不存在或已失效，请在 Telegram 中发送 /bind 获取" }, 400);
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      await db.removeAsync({ _id: record._id });
      return c.json({ ok: false, error: "绑定码已过期，请在 Telegram 中重新发送 /bind 获取" }, 400);
    }

    // Generate web auth token
    const token = "agy_tk_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const now = new Date().toISOString();

    await db.insertAsync({
      type: "auth-web-token",
      token,
      userId: record.userId,
      chatId: record.chatId,
      username: record.username || "",
      firstName: record.firstName || "",
      lastName: record.lastName || "",
      createdAt: now,
    });

    // Remove the one-time code
    await db.removeAsync({ _id: record._id });

    const displayName = record.firstName || (record.username ? `@${record.username}` : `TG用户 ${record.userId}`);

    return c.json({
      ok: true,
      message: `已成功绑定 Telegram 账号：${displayName}`,
      token,
      user: {
        userId: record.userId,
        chatId: record.chatId,
        username: record.username,
        firstName: record.firstName,
        displayName,
        isGuest: false,
      },
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

authRoute.get("/me", async (c) => {
  try {
    const scope = getScope(c);
    const authHeader = c.req.header("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    let userDoc = null;
    if (token) {
      userDoc = await db.findOneAsync({
        type: "auth-web-token",
        token,
      });
    }

    if (!userDoc && scope.userId) {
      userDoc = await db.findOneAsync({
        type: "user",
        userId: scope.userId,
      });
    }

    if (!userDoc) {
      return c.json({
        ok: true,
        user: {
          userId: scope.userId,
          chatId: scope.chatId,
          displayName: `用户 ${scope.userId}`,
          isGuest: true,
        },
      });
    }

    const displayName = userDoc.firstName || (userDoc.username ? `@${userDoc.username}` : `用户 ${userDoc.userId}`);

    return c.json({
      ok: true,
      user: {
        userId: userDoc.userId,
        chatId: userDoc.chatId || userDoc.userId,
        username: userDoc.username || "",
        firstName: userDoc.firstName || "",
        displayName,
        isGuest: false,
      },
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

authRoute.post("/guest", async (c) => {
  try {
    const guestId = Number(Date.now().toString().slice(-9));
    const token = "guest_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const now = new Date().toISOString();

    await db.insertAsync({
      type: "auth-web-token",
      token,
      userId: guestId,
      chatId: guestId,
      username: "",
      firstName: "访客用户",
      isGuest: true,
      createdAt: now,
    });

    return c.json({
      ok: true,
      token,
      user: {
        userId: guestId,
        chatId: guestId,
        username: "",
        firstName: "访客用户",
        displayName: `访客 #${guestId.toString().slice(-4)}`,
        isGuest: true,
      },
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

module.exports = { authRoute };
