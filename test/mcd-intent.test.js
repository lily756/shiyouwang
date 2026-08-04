"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { shouldLoadMcDonaldsMcp } = require("../mcd-mcp");

test("does not load McDonald's MCP for unrelated media or code requests", () => {
  assert.equal(
    shouldLoadMcDonaldsMcp([{ role: "user", content: "生成一段雨夜短片" }]),
    false,
  );
  assert.equal(
    shouldLoadMcDonaldsMcp([{ role: "user", content: "运行这段 Python 代码" }]),
    false,
  );
});

test("loads McDonald's MCP for an explicit request", () => {
  assert.equal(
    shouldLoadMcDonaldsMcp([{ role: "user", content: "帮我查一下麦当劳附近门店" }]),
    true,
  );
  assert.equal(
    shouldLoadMcDonaldsMcp([{ role: "user", content: "/mcd status" }]),
    true,
  );
});

test("keeps short follow-ups in an active McDonald's exchange", () => {
  assert.equal(
    shouldLoadMcDonaldsMcp([
      { role: "user", content: "帮我看看麦当劳优惠券" },
      {
        role: "assistant",
        content: "我来查一下。",
        tool_calls: [{ function: { name: "mcd_query_my_coupons" } }],
      },
      { role: "user", content: "那积分呢？" },
    ]),
    true,
  );
  assert.equal(
    shouldLoadMcDonaldsMcp([
      { role: "user", content: "帮我看看麦当劳优惠券" },
      { role: "user", content: "生成一张图片" },
    ]),
    false,
  );
});
