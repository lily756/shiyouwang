"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeMediaPromptMode,
  buildRoleReferenceImagePrompt,
  buildReferenceImageEditPrompt,
  buildSeedanceVideoPrompt,
  buildMiniMaxH3VideoPrompt,
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

test("MiniMax H3 prompt removes Seedance-only reference syntax", () => {
  const freeformPrompt = buildMiniMaxH3VideoPrompt(
    "@图片1中的角色沿着海边走，借鉴@视频1的节奏",
    { mode: "freeform" },
  );
  assert.equal(
    freeformPrompt,
    "参考图1中的角色沿着海边走，借鉴参考视频1的节奏",
  );

  const guidedPrompt = buildMiniMaxH3VideoPrompt("角色抬头微笑", {
    mode: "guided",
  });
  assert.match(guidedPrompt, /H3 执行约束/);
  assert.doesNotMatch(guidedPrompt, /@图片|@视频/);
});

test("freeform media prompt skill translates selfie intent without inventing role details", () => {
  const instruction = getMediaPromptSystemInstruction("freeform");
  assert.match(instruction, /前置摄像头/);
  assert.match(instruction, /参考图1是当前角色身份/);
  assert.match(instruction, /不要凭空编造/);
});
