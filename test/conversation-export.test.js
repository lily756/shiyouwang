"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildConversationExport,
  createConversationExportFilename,
} = require("../conversation-export");

test("exports only visible user and final assistant messages", () => {
  const result = buildConversationExport({
    roleName: "小白",
    createdAt: "2026-07-29T01:02:03.000Z",
    updatedAt: "2026-07-29T01:04:05.000Z",
    exportedAt: "2026-07-29T01:05:06.000Z",
    messages: [
      { role: "system", content: "不能导出这段 system prompt" },
      { role: "user", content: "你好，``` 也要安全保留" },
      {
        role: "assistant",
        content: "这条是在工具调用前的内部文字",
        tool_calls: [{ id: "call_1" }],
      },
      { role: "tool", content: '{"secret":"不能导出"}' },
      { role: "assistant", content: "你好呀！" },
    ],
  });

  assert.equal(result.messageCount, 2);
  assert.match(result.content, /你好，``` 也要安全保留/);
  assert.match(result.content, /你好呀！/);
  assert.doesNotMatch(result.content, /不能导出这段 system prompt/);
  assert.doesNotMatch(result.content, /内部文字/);
  assert.doesNotMatch(result.content, /不能导出/);
  assert.match(result.content, /````text/);
});

test("makes a safe Markdown filename", () => {
  const filename = createConversationExportFilename({
    roleName: "角色/名称:*?",
    exportedAt: new Date(2026, 6, 29, 9, 8, 7),
  });

  assert.equal(filename, "角色_名称____对话记录_20260729_090807.md");
});
