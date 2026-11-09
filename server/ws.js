"use strict";

const { eventBus } = require("./utils");
const { roleStore, processConversationTask, db } = require("../index");

function setupWebSocket(upgradeWebSocket) {
  return upgradeWebSocket((c) => {
    let clientScope = {
      userId: Number(c.req.header("x-user-id")) || Number(c.req.query("userId")) || 125776252,
      chatId: Number(c.req.header("x-chat-id")) || Number(c.req.query("chatId")) || 125776252,
    };

    let typingListener;
    let messageListener;
    let stateListener;
    let proactiveListener;

    return {
      onOpen(_event, ws) {
        ws.send(JSON.stringify({ type: "connection.ready", scope: clientScope }));

        typingListener = (data) => {
          if (data.scope.chatId === clientScope.chatId) {
            ws.send(JSON.stringify({ type: "chat.typing", payload: data }));
          }
        };

        messageListener = (data) => {
          if (data.scope.chatId === clientScope.chatId) {
            ws.send(JSON.stringify({ type: "chat.message", payload: data }));
          }
        };

        stateListener = (data) => {
          ws.send(JSON.stringify({ type: "role.state_updated", payload: data }));
        };

        proactiveListener = (data) => {
          if (!data.scope || data.scope.chatId === clientScope.chatId) {
            ws.send(JSON.stringify({ type: "role.proactive", payload: data }));
          }
        };

        eventBus.on("chat.typing", typingListener);
        eventBus.on("chat.message", messageListener);
        eventBus.on("role.state_updated", stateListener);
        eventBus.on("role.proactive", proactiveListener);
      },

      async onMessage(event, ws) {
        let msg = {};
        try {
          msg = JSON.parse(event.data);
        } catch {
          return ws.send(JSON.stringify({ type: "error", error: "消息格式必须是有效 JSON" }));
        }

        if (msg.type === "ping") {
          return ws.send(JSON.stringify({ type: "pong" }));
        }

        if (msg.type === "scope" && msg.payload) {
          if (msg.payload.chatId) clientScope.chatId = Number(msg.payload.chatId);
          if (msg.payload.userId) clientScope.userId = Number(msg.payload.userId);
          return ws.send(JSON.stringify({ type: "scope.updated", scope: clientScope }));
        }

        if (msg.type === "chat.send") {
          const text = String(msg.text || "").trim();
          if (!text) {
            return ws.send(JSON.stringify({ type: "error", error: "消息文本不能为空" }));
          }

          let session = await roleStore.findActiveSession(clientScope);
          if (!session?.roleName) {
            const roles = await roleStore.getRoles();
            const targetRole = msg.roleName
              ? roleStore.findRole(roles, msg.roleName)
              : roles[0];
            if (!targetRole) {
              return ws.send(JSON.stringify({ type: "error", error: "无可用角色" }));
            }
            session = await roleStore.replaceActiveSession(clientScope, targetRole);
          }

          // Queue task into SQLite
          const now = new Date().toISOString();
          const taskDoc = {
            type: "conversation-message-task",
            chatId: clientScope.chatId,
            userId: clientScope.userId,
            sessionId: session._id,
            text,
            status: "pending",
            receivedAt: now,
            createdAt: now,
          };
          await db.insertAsync(taskDoc);

          const mockCtx = {
            chat: { id: clientScope.chatId },
            from: { id: clientScope.userId },
            message: { chat: { id: clientScope.chatId }, from: { id: clientScope.userId }, text },
            sendChatAction: async (action) => {
              ws.send(JSON.stringify({
                type: "chat.typing",
                payload: { roleName: session.roleName, action },
              }));
            },
            reply: async (replyText) => {
              ws.send(JSON.stringify({
                type: "chat.message",
                payload: {
                  roleName: session.roleName,
                  role: "assistant",
                  text: replyText,
                },
              }));
            },
            replyWithPhoto: async (photo, extra) => {
              ws.send(JSON.stringify({
                type: "chat.photo",
                payload: { roleName: session.roleName, photo, extra },
              }));
            },
            replyWithDocument: async (doc, extra) => {
              ws.send(JSON.stringify({
                type: "chat.document",
                payload: { roleName: session.roleName, doc, extra },
              }));
            },
          };

          try {
            await roleStore.runInSessionQueue(clientScope, () =>
              processConversationTask(clientScope, { context: mockCtx }),
            );
          } catch (err) {
            ws.send(JSON.stringify({
              type: "error",
              error: `处理消息失败: ${err.message}`,
            }));
          }
        }
      },

      onClose() {
        if (typingListener) eventBus.off("chat.typing", typingListener);
        if (messageListener) eventBus.off("chat.message", messageListener);
        if (stateListener) eventBus.off("role.state_updated", stateListener);
        if (proactiveListener) eventBus.off("role.proactive", proactiveListener);
      },
    };
  });
}

module.exports = { setupWebSocket };
