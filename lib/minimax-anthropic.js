"use strict";

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  return match ? { mediaType: match[1], data: match[2].replace(/\s+/g, "") } : null;
}

function toAnthropicMediaSource(url, fallbackMediaType) {
  const dataUrl = parseDataUrl(url);
  if (dataUrl) {
    return {
      type: "base64",
      media_type: dataUrl.mediaType || fallbackMediaType,
      data: dataUrl.data,
    };
  }
  return { type: "url", url: String(url) };
}

function convertContentPart(part) {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (!part || typeof part !== "object") {
    return null;
  }
  if (part.type === "text") {
    return { type: "text", text: String(part.text || "") };
  }
  if (part.type === "image_url") {
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    if (!url) return null;
    return { type: "image", source: toAnthropicMediaSource(url, "image/jpeg") };
  }
  if (part.type === "image" && part.source) {
    return { ...part };
  }
  if (part.type === "video_url" || part.type === "video") {
    const value = typeof part.video_url === "string"
      ? part.video_url
      : part.video_url?.url || part.source?.url || part.url;
    if (part.source && part.type === "video") {
      return { ...part };
    }
    if (!value) return null;
    return { type: "video", source: toAnthropicMediaSource(value, "video/mp4") };
  }
  if (["tool_use", "tool_result", "thinking", "redacted_thinking"].includes(part.type)) {
    return { ...part };
  }
  return null;
}

function convertContent(content) {
  if (Array.isArray(content)) {
    return content.map(convertContentPart).filter(Boolean);
  }
  if (content === null || content === undefined) {
    return [];
  }
  return [{ type: "text", text: String(content) }];
}

function convertAssistantMessage(message) {
  const content = convertContent(message.content);
  for (const toolCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const functionCall = toolCall?.function || {};
    let input = {};
    try {
      input = typeof functionCall.arguments === "string"
        ? JSON.parse(functionCall.arguments)
        : (functionCall.arguments || {});
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: String(toolCall.id || `tool_${Date.now()}`),
      name: String(functionCall.name || "unknown_tool"),
      input,
    });
  }
  return { role: "assistant", content };
}

function convertMessages(messages = []) {
  const system = [];
  const converted = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "system") {
      const text = Array.isArray(message.content)
        ? message.content.map((part) => part?.text || "").join("\n")
        : String(message.content || "");
      if (text) system.push(text);
      continue;
    }
    if (message.role === "assistant") {
      converted.push(convertAssistantMessage(message));
      continue;
    }
    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: String(message.tool_call_id || ""),
          content: String(message.content || ""),
        }],
      });
      continue;
    }
    converted.push({ role: "user", content: convertContent(message.content) });
  }
  return { system: system.join("\n\n"), messages: converted };
}

function openAiToolsToAnthropic(tools = []) {
  return tools
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      name: String(tool.function.name),
      description: String(tool.function.description || ""),
      input_schema: tool.function.parameters || { type: "object", properties: {} },
    }));
}

function getToolChoice(forceToolName = "") {
  return forceToolName
    ? { type: "tool", name: forceToolName }
    : { type: "auto" };
}

function getAnthropicText(content) {
  return (Array.isArray(content) ? content : [content])
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || ""))
    .join("")
    .trim();
}

function getAnthropicToolCalls(content = []) {
  return (Array.isArray(content) ? content : [])
    .filter((part) => part?.type === "tool_use")
    .map((part) => ({
      id: String(part.id || ""),
      type: "function",
      function: {
        name: String(part.name || ""),
        arguments: JSON.stringify(part.input || {}),
      },
    }));
}

module.exports = {
  convertContent,
  convertMessages,
  getAnthropicText,
  getAnthropicToolCalls,
  getToolChoice,
  openAiToolsToAnthropic,
  parseDataUrl,
};
