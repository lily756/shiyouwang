"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createVideoHistory } = require("../lib/video-history");

function createMemoryDb() {
  const records = [];
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
