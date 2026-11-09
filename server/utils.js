"use strict";

const { EventEmitter } = require("node:events");
const path = require("node:path");

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

const DEFAULT_USER_ID = Number(process.env.DEFAULT_CLIENT_USER_ID) || 125776252;
const DEFAULT_CHAT_ID = Number(process.env.DEFAULT_CLIENT_CHAT_ID) || 125776252;

function getScope(c) {
  let userId = c.req.header("x-user-id") || c.req.query("userId");
  let chatId = c.req.header("x-chat-id") || c.req.query("chatId");

  const parsedUserId = Number(userId);
  const parsedChatId = Number(chatId);

  return {
    userId: Number.isFinite(parsedUserId) && parsedUserId !== 0 ? parsedUserId : DEFAULT_USER_ID,
    chatId: Number.isFinite(parsedChatId) && parsedChatId !== 0 ? parsedChatId : DEFAULT_CHAT_ID,
  };
}

function formatClientMessages(messages = []) {
  if (!Array.isArray(messages)) return [];

  const result = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role === "system") {
      continue;
    }

    // Skip internal tool_result user messages that don't have text
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const isToolResult = msg.content.some((item) => item?.type === "tool_result");
      if (isToolResult) {
        continue;
      }
    }

    let text = "";
    let thinking = "";
    const media = [];

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (!item) continue;
        if (item.type === "thinking") {
          thinking = item.thinking || "";
        } else if (item.type === "text") {
          text = item.text || "";
        } else if (typeof item === "string") {
          text = item;
        } else if (item.type === "tool_use") {
          // Check if it was an image or video generation tool
          if (item.name === "generate_character_image" && item.input?.prompt) {
            media.push({ type: "image_generating", prompt: item.input.prompt });
          } else if (item.name === "generate_character_video" && item.input?.prompt) {
            media.push({ type: "video_generating", prompt: item.input.prompt });
          }
        }
      }
    }

    if (!text && !thinking && media.length === 0) {
      continue;
    }

    result.push({
      id: msg._id || `msg-${i}`,
      role: msg.role,
      text,
      thinking: thinking || undefined,
      media: media.length > 0 ? media : undefined,
      metadata: msg.metadata || undefined,
      createdAt: msg.createdAt || undefined,
    });
  }

  return result;
}

module.exports = {
  eventBus,
  getScope,
  formatClientMessages,
  DEFAULT_USER_ID,
  DEFAULT_CHAT_ID,
};
