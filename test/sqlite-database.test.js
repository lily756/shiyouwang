"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Datastore = require("@seald-io/nedb");
const { createSqliteDatabase } = require("../lib/sqlite-database");

test("SQLite document adapter supports the NeDB-shaped CRUD surface", async () => {
  const db = createSqliteDatabase({ filename: ":memory:" });
  try {
    const inserted = await db.insertAsync({
      _id: "user-1",
      type: "user",
      userId: 7,
      profile: { name: "小白" },
      enabled: true,
    });
    await db.insertAsync({ _id: "user-2", type: "user", userId: 8, enabled: false });
    assert.equal(inserted._id, "user-1");

    assert.deepEqual(await db.findOneAsync({ type: "user", userId: 7 }), inserted);
    assert.equal((await db.findAsync({ _id: { $in: ["user-1", "missing"] } })).length, 1);
    assert.equal((await db.findAsync({ enabled: { $ne: true } })).length, 1);
    assert.deepEqual(
      await db.findOneAsync({ profile: { name: "小白" } }, { _id: 1, "profile.name": 1 }),
      { _id: "user-1", profile: { name: "小白" } },
    );

    const updated = await db.updateAsync(
      { type: "user", enabled: false },
      { $set: { enabled: true, "profile.name": "小黑" } },
    );
    assert.equal(updated.numAffected, 1);
    assert.equal((await db.findOneAsync({ _id: "user-2" })).profile.name, "小黑");

    const upserted = await db.updateAsync(
      { type: "settings", userId: 7 },
      { $set: { enabled: true } },
      { upsert: true },
    );
    assert.equal(upserted.upsert, true);
    assert.equal((await db.findOneAsync({ type: "settings", userId: 7 })).enabled, true);

    const multiUpdated = await db.updateAsync(
      { type: "user" },
      { $set: { migrated: true } },
      { multi: true },
    );
    assert.equal(multiUpdated.numAffected, 2);
    assert.equal((await db.findAsync({ type: "user", migrated: true })).length, 2);
    assert.equal(await db.removeAsync({ type: "user" }, { multi: true }), 2);
    assert.equal((await db.findAsync({ type: "user" })).length, 0);
  } finally {
    db.close();
  }
});

test("migrates an existing NeDB data file once and preserves document ids", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "localtest-sqlite-migration-"));
  const legacyFilename = path.join(directory, "data");
  const sqliteFilename = path.join(directory, "data.sqlite");
  const legacy = new Datastore({ filename: legacyFilename, autoload: true });
  try {
    await legacy.autoloadPromise;
    await legacy.insertAsync({
      _id: "legacy-role",
      type: "role",
      name: "迁移角色",
      settings: { timezone: "Asia/Shanghai" },
    });

    const db = createSqliteDatabase({ filename: sqliteFilename, legacyFilename });
    try {
      await db.ready;
      const migrated = await db.findOneAsync({ _id: "legacy-role" });
      assert.deepEqual(migrated, {
        _id: "legacy-role",
        type: "role",
        name: "迁移角色",
        settings: { timezone: "Asia/Shanghai" },
      });

      const secondOpen = createSqliteDatabase({ filename: sqliteFilename, legacyFilename });
      try {
        await secondOpen.ready;
        assert.equal((await secondOpen.findAsync({ type: "role" })).length, 1);
      } finally {
        secondOpen.close();
      }
    } finally {
      db.close();
    }
  } finally {
    legacy.close?.();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
