const test = require("node:test");
const assert = require("node:assert/strict");
const {
  convertMessages,
  getAnthropicToolCalls,
  openAiToolsToAnthropic,
} = require("../lib/minimax-anthropic");

test("converts OpenAI image/video content into Anthropic multimodal blocks", () => {
  const result = convertMessages([
    { role: "system", content: "你是角色。" },
    {
      role: "user",
      content: [
        { type: "text", text: "看看这两张素材" },
        { type: "image_url", image_url: { url: "https://example.com/a.jpg" } },
        { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
      ],
    },
  ]);
  assert.equal(result.system, "你是角色。");
  assert.equal(result.messages[0].content[0].type, "text");
  assert.deepEqual(result.messages[0].content[1], {
    type: "image",
    source: { type: "url", url: "https://example.com/a.jpg" },
  });
  assert.deepEqual(result.messages[0].content[2], {
    type: "video",
    source: { type: "base64", media_type: "video/mp4", data: "AAAA" },
  });
});

test("preserves Anthropic tool blocks and converts tools/results", () => {
  const tools = openAiToolsToAnthropic([{
    type: "function",
    function: {
      name: "get_current_time",
      description: "读取时间",
      parameters: { type: "object", properties: {} },
    },
  }]);
  assert.deepEqual(tools[0], {
    name: "get_current_time",
    description: "读取时间",
    input_schema: { type: "object", properties: {} },
  });
  const calls = getAnthropicToolCalls([{
    type: "tool_use",
    id: "tool-1",
    name: "get_current_time",
    input: { timezone: "Asia/Shanghai" },
  }]);
  assert.equal(calls[0].function.name, "get_current_time");
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { timezone: "Asia/Shanghai" });
  const converted = convertMessages([
    { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "get_current_time", input: {} }] },
    { role: "tool", tool_call_id: "tool-1", content: '{"ok":true}' },
  ]);
  assert.equal(converted.messages[1].content[0].type, "tool_result");
  assert.equal(converted.messages[1].content[0].tool_use_id, "tool-1");
});
