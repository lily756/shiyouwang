"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createVideoHistory } = require("../lib/video-history");

function createMemoryDb(initialRecords = []) {
  const records = [...initialRecords];
  const matches = (record, query) => Object.entries(query).every(([key, value]) => record[key] === value);
  return {
    async insertAsync(record) {
      records.push({ ...record });
      return record;
    },
    async findAsync(query) {
      return records.filter((record) => matches(record, query));
    },
    async findOneAsync(query) {
      return records.find((record) => matches(record, query)) || null;
    },
  };
}

test("persists and reloads a Telegram video reference within its conversation scope", async () => {
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), "localtest-video-history-"));
  try {
    const history = createVideoHistory({
      db: createMemoryDb(),
      assetsDir,
      maxBytes: 1024,
    });
    const scope = { chatId: 100, userId: 200 };
    const saved = await history.save({
      scope,
      roleName: "小白",
      sourceLabel: "Telegram 视频",
      caption: "参考这个运镜",
      video: Buffer.from("fake-mp4-content"),
      mimeType: "video/mp4",
    });

    assert.equal(saved.ok, true);
    assert.match(saved.referenceId, /^vid_/);

    const listed = await history.list({ scope, roleName: "小白" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].referenceId, saved.referenceId);

    const loaded = await history.load({
      scope,
      roleName: "小白",
      referenceId: saved.referenceId,
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.mimeType, "video/mp4");
    assert.equal(loaded.video.toString(), "fake-mp4-content");
  } finally {
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});

test("can reload a Wasabi-backed reference after the local copy is gone", async () => {
  const scope = { chatId: 100, userId: 200 };
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), "localtest-video-remote-"));
  const db = createMemoryDb([{
    type: "chat-video-reference",
    ...scope,
    roleName: "小白",
    referenceId: "vid_remote",
    remoteObjectKey: "role-bot/video-history/remote.mp4",
    mimeType: "video/mp4",
    sourceLabel: "Wasabi 视频",
    createdAt: new Date().toISOString(),
  }]);
  try {
    const history = createVideoHistory({
      db,
      assetsDir,
      maxBytes: 1024,
      assetStore: {
        isConfigured: () => true,
        getBuffer: async ({ key }) => {
          assert.equal(key, "role-bot/video-history/remote.mp4");
          return Buffer.from("remote-mp4-content");
        },
      },
    });

    const listed = await history.list({ scope, roleName: "小白" });
    assert.equal(listed.length, 1);
    const loaded = await history.load({ scope, roleName: "小白", referenceId: "vid_remote" });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.video.toString(), "remote-mp4-content");
  } finally {
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});
