"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeMediaPromptMode,
  buildRoleReferenceImagePrompt,
  buildReferenceImageEditPrompt,
  buildSeedanceVideoPrompt,
  getMediaPromptSystemInstruction,
} = require("../lib/media-prompt");

test("media prompt mode defaults to freeform and preserves the prompt", () => {
  assert.equal(normalizeMediaPromptMode("unknown"), "freeform");
  assert.equal(
    buildRoleReferenceImagePrompt({
      prompt: "一只漂浮在海上的蓝色鲸鱼",
      roleName: "小白",
      mode: "freeform",
    }),
    "一只漂浮在海上的蓝色鲸鱼",
  );
  assert.equal(
    buildReferenceImageEditPrompt({
      instruction: "把天空改成紫色",
      editType: "background",
      mode: "freeform",
    }),
    "把天空改成紫色",
  );
  assert.equal(
    buildSeedanceVideoPrompt("一只猫在窗边打哈欠", {
      mode: "freeform",
      referenceImages: [{ source: "role" }],
    }),
    "一只猫在窗边打哈欠",
  );
});

test("guided mode keeps server-side constraints available", () => {
  const prompt = buildSeedanceVideoPrompt("一只猫在窗边打哈欠", {
    mode: "guided",
    referenceImages: [{ source: "role", roleName: "小白" }],
  });
  assert.match(prompt, /参考素材绑定/);
  assert.match(prompt, /高清/);
  assert.match(prompt, /一只猫在窗边打哈欠/);
});

test("freeform media prompt skill translates selfie intent without inventing role details", () => {
  const instruction = getMediaPromptSystemInstruction("freeform");
  assert.match(instruction, /前置摄像头/);
  assert.match(instruction, /参考图1是当前角色身份/);
  assert.match(instruction, /不要凭空编造/);
});
