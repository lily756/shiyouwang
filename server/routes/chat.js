"use strict";

const { Hono } = require("hono");
const { getScope, formatClientMessages, eventBus } = require("../utils");
const { roleStore, roleSchedule, processConversationTask, db } = require("../../index");

const chatRoute = new Hono();

chatRoute.get("/session", async (c) => {
  try {
    const scope = getScope(c);
    const session = await roleStore.findActiveSession(scope);
    if (!session) {
      return c.json({ ok: true, session: null });
    }

    return c.json({
      ok: true,
      session: {
        id: session._id,
        roleName: session.roleName,
        messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

chatRoute.post("/switch", async (c) => {
  try {
    const scope = getScope(c);
    const body = await c.req.json().catch(() => ({}));
    const roleName = body.roleName;
    if (!roleName) {
      return c.json({ ok: false, error: "请提供角色名称 (roleName)" }, 400);
    }

    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, roleName);
    if (!role) {
      return c.json({ ok: false, error: `角色「${roleName}」不存在` }, 404);
    }

    const session = await roleStore.replaceActiveSession(scope, role);
    let runtimeState = null;
    try {
      runtimeState = (await roleSchedule.getState(role.name, { scope }))?.runtimeState || null;
    } catch {
      // ignore
    }

    eventBus.emit("session.switched", { scope, roleName: role.name });

    return c.json({
      ok: true,
      message: `已切换至角色「${role.name}」`,
      session: {
        id: session._id,
        roleName: session.roleName,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      runtimeState,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

chatRoute.get("/messages", async (c) => {
  try {
    const scope = getScope(c);
    const session = await roleStore.findActiveSession(scope);
    if (!session || !Array.isArray(session.messages)) {
      return c.json({ ok: true, messages: [] });
    }

    const clientMessages = formatClientMessages(session.messages);
    return c.json({
      ok: true,
      roleName: session.roleName,
      messages: clientMessages,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

chatRoute.post("/send", async (c) => {
  try {
    const scope = getScope(c);
    const body = await c.req.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    if (!text) {
      return c.json({ ok: false, error: "消息内容不能为空" }, 400);
    }

    let session = await roleStore.findActiveSession(scope);
    if (!session || !session.roleName) {
      // If no active session, auto pick the requested role or first role
      const roles = await roleStore.getRoles();
      const requestedRole = body.roleName
        ? roleStore.findRole(roles, body.roleName)
        : roles[0];
      if (!requestedRole) {
        return c.json({ ok: false, error: "系统中暂无可用角色，请先创建角色" }, 400);
      }
      session = await roleStore.replaceActiveSession(scope, requestedRole);
    }

    // Insert task into SQLite queue
    const now = new Date().toISOString();
    const taskDocument = {
      type: "conversation-message-task",
      chatId: scope.chatId,
      userId: scope.userId,
      sessionId: session._id,
      text,
      status: "pending",
      receivedAt: now,
      createdAt: now,
    };
    await db.insertAsync(taskDocument);

    // Run within session queue to safely process
    let capturedReply = "";
    const mockContext = {
      chat: { id: scope.chatId },
      from: { id: scope.userId },
      message: { chat: { id: scope.chatId }, from: { id: scope.userId }, text },
      sendChatAction: async (action) => {
        eventBus.emit("chat.typing", { scope, roleName: session.roleName, action });
      },
      reply: async (replyText) => {
        capturedReply = replyText;
        eventBus.emit("chat.message", {
          scope,
          roleName: session.roleName,
          role: "assistant",
          text: replyText,
        });
      },
      replyWithPhoto: async (photo, extra) => {
        eventBus.emit("chat.photo", { scope, roleName: session.roleName, photo, extra });
      },
      replyWithDocument: async (doc, extra) => {
        eventBus.emit("chat.document", { scope, roleName: session.roleName, doc, extra });
      },
    };

    await roleStore.runInSessionQueue(scope, () =>
      processConversationTask(scope, { context: mockContext }),
    );

    // Reload updated session to retrieve complete generated message structure
    const updatedSession = await roleStore.findActiveSession(scope);
    const updatedMessages = formatClientMessages(updatedSession?.messages || []);
    const lastAssistantMessage = updatedMessages.filter((m) => m.role === "assistant").at(-1);

    // Broadcast state update to WebSocket clients
    eventBus.emit("role.state_updated", { roleName: session.roleName, scope });

    return c.json({
      ok: true,
      roleName: session.roleName,
      reply: capturedReply || lastAssistantMessage?.text || "",
      message: lastAssistantMessage || null,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

chatRoute.post("/clear", async (c) => {
  try {
    const scope = getScope(c);
    const session = await roleStore.findActiveSession(scope);
    if (!session?.roleName) {
      return c.json({ ok: false, error: "当前没有进行中的角色会话" }, 404);
    }

    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, session.roleName);
    if (role) {
      await roleStore.clearRoleConversationHistory(scope, role);
    }

    eventBus.emit("chat.cleared", { scope, roleName: session.roleName });

    return c.json({
      ok: true,
      message: `已清空「${session.roleName}」的当前会话记录。`,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

chatRoute.get("/export", async (c) => {
  try {
    const scope = getScope(c);
    const session = await roleStore.findActiveSession(scope);
    if (!session) {
      return c.json({ ok: false, error: "当前没有进行中的角色会话" }, 404);
    }

    const exported = roleStore.exportActiveSession(session);
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(exported.filename)}"`);
    return c.text(exported.content);
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

module.exports = { chatRoute };
