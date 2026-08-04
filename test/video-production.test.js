"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildFallbackVideoProductionPlan,
  buildVideoPromptFromPlan,
  createVideoProductionManager,
  normalizeVideoProductionPlan,
} = require("../lib/video-production");

function createMemoryDb() {
  const records = [];
  let nextId = 1;
  const matches = (record, query) => Object.entries(query).every(([key, value]) => record[key] === value);
  return {
    async insertAsync(record) {
      const saved = { _id: record._id || `record-${nextId++}`, ...record };
      records.push(saved);
      return saved;
    },
    async findAsync(query) {
      return records.filter((record) => matches(record, query));
    },
    async findOneAsync(query) {
      return records.find((record) => matches(record, query)) || null;
    },
    async updateAsync(query, modifier) {
      const record = records.find((item) => matches(item, query));
      if (!record) return 0;
      Object.assign(record, modifier.$set || {});
      return 1;
    },
  };
}

test("normalizes a storyboard and keeps only valid asset references", () => {
  const plan = normalizeVideoProductionPlan({
    title: "雨夜便利店",
    duration: 6,
    assets: [
      { id: "scene_1", kind: "场景", name: "便利店", prompt: "纯场景便利店" },
      { id: "prop_1", kind: "prop", name: "雨伞", prompt: "一把透明雨伞" },
    ],
    shots: [{
      id: "shot_1",
      duration: 6,
      action: "角色收起雨伞，走到便利店门口。",
      camera: "缓慢推近",
      scene: "scene_1",
      props: ["prop_1", "missing_prop"],
    }],
  });

  assert.equal(plan.assets[0].kind, "scene");
  assert.deepEqual(plan.shots[0].propAssetIds, ["prop_1"]);
  assert.equal(plan.shots[0].locationAssetId, "scene_1");
});

test("fallback plan contains a scene and current-role cast material", () => {
  const plan = buildFallbackVideoProductionPlan({
    prompt: "角色在窗边挥手",
    role: { name: "小白" },
    roleState: { location: "家里", environment: "窗边", activity: "休息" },
    duration: 8,
  });
  assert.equal(plan.assets.some((asset) => asset.kind === "scene"), true);
  assert.equal(plan.assets.some((asset) => asset.isCurrentRole), true);
  assert.match(buildVideoPromptFromPlan({ plan, originalPrompt: "角色在窗边挥手" }), /镜头1/);
});

test("production manager waits for all assets before creating the video task", async () => {
  const db = createMemoryDb();
  const queued = [];
  const created = [];
  const manager = createVideoProductionManager({
    db,
    generatePlan: async () => ({
      title: "测试短片",
      duration: 6,
      assets: [
        { id: "scene_1", kind: "scene", name: "场景", prompt: "纯场景" },
        { id: "prop_1", kind: "prop", name: "道具", prompt: "纯道具" },
      ],
      shots: [{ id: "shot_1", duration: 6, action: "道具被拿起", scene: "scene_1", props: ["prop_1"] }],
    }),
    generateFinalPrompt: async () => "按分镜连续拍摄，使用参考图1和参考图2。",
    queueAsset: async ({ asset }) => {
      const taskId = `asset-task-${asset.id}`;
      queued.push({ asset, taskId });
      return { taskId };
    },
    createVideoTask: async ({ referenceImages, finalPrompt }) => {
      created.push({ referenceImages, finalPrompt });
      return { taskId: "video-task-1", videoMode: "r2v" };
    },
  });

  const started = await manager.start({
    userId: 1,
    chatId: 2,
    roleName: "小白",
    originalPrompt: "做一段短片",
    duration: 6,
  });
  assert.equal(started.status, "generating_assets");
  assert.equal(queued.length, 2);
  assert.equal(created.length, 0);

  await manager.markAssetReady({
    pipelineId: started.pipelineId,
    assetId: "scene_1",
    reference: { source: "history", referenceId: "img_scene" },
  });
  assert.equal(created.length, 0);
  await manager.markAssetReady({
    pipelineId: started.pipelineId,
    assetId: "prop_1",
    reference: { source: "history", referenceId: "img_prop" },
  });

  const pipeline = await manager.getPipeline(started.pipelineId);
  assert.equal(created.length, 1);
  assert.equal(pipeline.status, "video");
  assert.equal(pipeline.videoTaskId, "video-task-1");
  assert.equal(created[0].referenceImages.length, 2);
});
