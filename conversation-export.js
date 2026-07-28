"use strict";

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) {
    return "未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(date);
}

function getTextContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        return typeof part?.text === "string" ? part.text : "";
      })
      .join("")
      .trim();
  }

  return "";
}

function getVisibleMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) {
      return [];
    }

    // Assistant messages that request a tool are internal control messages:
    // they were not sent to the user and must never appear in an export.
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return [];
    }

    const content = getTextContent(message.content);
    return content ? [{ role: message.role, content }] : [];
  });
}

function asCodeBlock(value) {
  const content = String(value ?? "");
  const backtickRuns = content.match(/`+/g) || [];
  const longestRun = Math.max(0, ...backtickRuns.map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${content}\n${fence}`;
}

function normalizeRoleName(roleName) {
  return String(roleName || "角色")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 80) || "角色";
}

function buildConversationExport({
  roleName,
  createdAt,
  updatedAt,
  messages,
  exportedAt = new Date(),
} = {}) {
  const visibleMessages = getVisibleMessages(messages);
  const displayRoleName = normalizeRoleName(roleName);
  const lines = [
    `# 与「${displayRoleName}」的对话记录`,
    "",
    `- 对话开始：${formatDateTime(createdAt)}`,
    `- 最近更新：${formatDateTime(updatedAt)}`,
    `- 导出时间：${formatDateTime(exportedAt)}`,
    "- 此文件仅包含可见对话文本；不会包含 system prompt、内部工具调用或工具返回。",
  ];

  for (const [index, message] of visibleMessages.entries()) {
    const speaker = message.role === "user" ? "你" : displayRoleName;
    lines.push("", `## ${index + 1}. ${speaker}`, "", asCodeBlock(message.content));
  }

  lines.push("");
  return { content: lines.join("\n"), messageCount: visibleMessages.length };
}

function makeTimestamp(value) {
  const date = toDate(value) || new Date();
  const pad = (number, length = 2) => String(number).padStart(length, "0");
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("_");
}

function createConversationExportFilename({ roleName, exportedAt = new Date() } = {}) {
  const safeRoleName = normalizeRoleName(roleName)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .slice(0, 40);
  return `${safeRoleName}_对话记录_${makeTimestamp(exportedAt)}.md`;
}

module.exports = {
  buildConversationExport,
  createConversationExportFilename,
  getVisibleMessages,
};
