"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Datastore = require("@seald-io/nedb");
const BetterSqlite3 = require("better-sqlite3");
const { and, eq, sql } = require("drizzle-orm");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { index, sqliteTable, text } = require("drizzle-orm/sqlite-core");

const documentsTable = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    type: text("type"),
    payload: text("payload").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => ({
    typeIndex: index("documents_type_idx").on(table.type),
  }),
);

const metadataTable = sqliteTable("database_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

const LEGACY_MIGRATION_KEY = "legacy-nedb-migration-v1";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === undefined || right === undefined || left === null || right === null) {
    return false;
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
        && deepEqual(left[key], right[key]));
  }
  return false;
}

function getPathInfo(value, fieldPath) {
  const parts = String(fieldPath).split(".");
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, part)) {
      return { exists: false, value: undefined };
    }
    current = current[part];
  }
  return { exists: true, value: current };
}

function setPath(target, fieldPath, value) {
  const parts = String(fieldPath).split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = cloneValue(value);
}

function unsetPath(target, fieldPath) {
  const parts = String(fieldPath).split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, part)) {
      return;
    }
    current = current[part];
  }
  if (current && typeof current === "object") {
    delete current[parts.at(-1)];
  }
}

function compareValues(actual, expected, operator) {
  if (operator === "$lt") return actual < expected;
  if (operator === "$lte") return actual <= expected;
  if (operator === "$gt") return actual > expected;
  if (operator === "$gte") return actual >= expected;
  return false;
}

function matchesField(actual, exists, condition) {
  if (condition instanceof RegExp) {
    return typeof actual === "string" && condition.test(actual);
  }

  if (!isPlainObject(condition) || !Object.keys(condition).some((key) => key.startsWith("$"))) {
    return deepEqual(actual, condition);
  }

  return Object.entries(condition).every(([operator, expected]) => {
    switch (operator) {
      case "$in":
        return Array.isArray(expected) && expected.some((candidate) => {
          if (Array.isArray(actual)) {
            return actual.some((item) => deepEqual(item, candidate));
          }
          return deepEqual(actual, candidate);
        });
      case "$nin":
        return Array.isArray(expected) && !expected.some((candidate) => deepEqual(actual, candidate));
      case "$exists":
        return exists === Boolean(expected);
      case "$ne":
        return !exists || !deepEqual(actual, expected);
      case "$lt":
      case "$lte":
      case "$gt":
      case "$gte":
        return exists && compareValues(actual, expected, operator);
      case "$regex": {
        const regex = expected instanceof RegExp
          ? expected
          : new RegExp(String(expected), condition.$options || "");
        return typeof actual === "string" && regex.test(actual);
      }
      case "$options":
        return true;
      case "$size":
        return Array.isArray(actual) && actual.length === Number(expected);
      case "$elemMatch":
        return Array.isArray(actual) && actual.some((item) => (
          isPlainObject(expected) && Object.keys(expected).some((key) => key.startsWith("$"))
            ? matchesField(item, true, expected)
            : matchesQuery(item, expected)
        ));
      default:
        return false;
    }
  });
}

function matchesQuery(document, query) {
  if (!query || !isPlainObject(query)) {
    return true;
  }

  return Object.entries(query).every(([fieldPath, condition]) => {
    if (fieldPath === "$or") {
      return Array.isArray(condition) && condition.some((item) => matchesQuery(document, item));
    }
    if (fieldPath === "$and") {
      return Array.isArray(condition) && condition.every((item) => matchesQuery(document, item));
    }
    if (fieldPath === "$not") {
      return !matchesQuery(document, condition);
    }

    const { exists, value } = getPathInfo(document, fieldPath);
    return matchesField(value, exists, condition);
  });
}

function projectionDocument(document, projection) {
  if (!isPlainObject(projection) || Object.keys(projection).length === 0) {
    return document;
  }

  const fields = Object.entries(projection);
  const includes = fields.some(([field, enabled]) => field !== "_id" && Boolean(enabled));
  if (includes) {
    const result = {};
    for (const [field, enabled] of fields) {
      if (enabled) {
        const info = getPathInfo(document, field);
        if (info.exists) setPath(result, field, info.value);
      }
    }
    if (projection._id !== 0 && document._id !== undefined) {
      result._id = document._id;
    }
    return result;
  }

  const result = cloneValue(document);
  for (const [field, enabled] of fields) {
    if (!enabled) unsetPath(result, field);
  }
  return result;
}

function hasModifier(update) {
  return isPlainObject(update) && Object.keys(update).some((key) => key.startsWith("$"));
}

function applyUpdate(document, update) {
  if (!hasModifier(update)) {
    return {
      ...cloneValue(update || {}),
      _id: document._id,
    };
  }

  const result = cloneValue(document);
  for (const [fieldPath, value] of Object.entries(update.$set || {})) {
    if (fieldPath !== "_id") setPath(result, fieldPath, value);
  }
  for (const fieldPath of Object.keys(update.$unset || {})) {
    if (fieldPath !== "_id") unsetPath(result, fieldPath);
  }
  for (const [fieldPath, increment] of Object.entries(update.$inc || {})) {
    if (fieldPath === "_id") continue;
    const current = getPathInfo(result, fieldPath).value;
    setPath(result, fieldPath, (Number(current) || 0) + Number(increment));
  }
  for (const [fieldPath, value] of Object.entries(update.$push || {})) {
    if (fieldPath === "_id") continue;
    const current = getPathInfo(result, fieldPath).value;
    const array = Array.isArray(current) ? current : [];
    array.push(cloneValue(value));
    setPath(result, fieldPath, array);
  }
  for (const [fieldPath, value] of Object.entries(update.$addToSet || {})) {
    if (fieldPath === "_id") continue;
    const current = getPathInfo(result, fieldPath).value;
    const array = Array.isArray(current) ? current : [];
    if (!array.some((item) => deepEqual(item, value))) {
      array.push(cloneValue(value));
    }
    setPath(result, fieldPath, array);
  }
  result._id = document._id;
  return result;
}

function extractUpsertDocument(query, update) {
  const base = {};
  if (isPlainObject(query)) {
    for (const [fieldPath, value] of Object.entries(query)) {
      if (fieldPath.startsWith("$") || (isPlainObject(value) && Object.keys(value).some((key) => key.startsWith("$")))) {
        continue;
      }
      setPath(base, fieldPath, value);
    }
  }
  return applyUpdate({ _id: base._id || crypto.randomUUID(), ...base }, update);
}

function getTimestamp(document, field) {
  const value = document?.[field];
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return null;
}

class SqliteDocumentDatabase {
  constructor({ filename, legacyFilename = null, logger = console } = {}) {
    if (!filename || typeof filename !== "string") {
      throw new TypeError("SQLite database filename is required");
    }

    if (filename !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    }

    this.filename = filename;
    this.legacyFilename = legacyFilename;
    this.logger = logger;
    this.client = new BetterSqlite3(filename);
    this.client.pragma("journal_mode = WAL");
    this.client.pragma("busy_timeout = 5000");
    this.orm = drizzle({ client: this.client });
    this.ensureSchema();
    this.ready = this.migrateLegacyData();
  }

  ensureSchema() {
    this.orm.run(sql`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT,
        payload TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    this.orm.run(sql`CREATE INDEX IF NOT EXISTS documents_type_idx ON documents(type)`);
    this.orm.run(sql`
      CREATE TABLE IF NOT EXISTS database_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
    `);
  }

  async migrateLegacyData() {
    const migration = this.orm
      .select()
      .from(metadataTable)
      .where(eq(metadataTable.key, LEGACY_MIGRATION_KEY))
      .get();
    if (migration) {
      return;
    }

    const current = this.orm.select({ id: documentsTable.id }).from(documentsTable).limit(1).all();
    if (!this.legacyFilename || path.resolve(this.legacyFilename) === path.resolve(this.filename) || !fs.existsSync(this.legacyFilename)) {
      this.orm.insert(metadataTable).values({ key: LEGACY_MIGRATION_KEY, value: "not-needed" }).run();
      return;
    }

    if (current.length > 0) {
      this.orm.insert(metadataTable).values({ key: LEGACY_MIGRATION_KEY, value: "sqlite-already-populated" }).run();
      return;
    }

    const legacy = new Datastore({ filename: this.legacyFilename, autoload: false });
    await legacy.loadDatabaseAsync();
    const records = await legacy.findAsync({});
    const migrate = this.client.transaction((documents) => {
      for (const document of documents) {
        this.insertDocument(document);
      }
      this.orm.insert(metadataTable).values({
        key: LEGACY_MIGRATION_KEY,
        value: `migrated:${documents.length}`,
      }).run();
    });
    migrate(records);
    this.logger.info?.(`SQLite 已从旧 NeDB 数据迁移 ${records.length} 条记录；旧文件保留在 ${this.legacyFilename}`);
  }

  insertDocument(document) {
    const normalized = cloneValue(document || {});
    if (!isPlainObject(normalized)) {
      throw new TypeError("Database documents must be plain objects");
    }
    normalized._id = normalized._id ? String(normalized._id) : crypto.randomUUID();
    const payload = JSON.stringify(normalized);
    if (typeof payload !== "string") {
      throw new TypeError("Database document could not be serialized");
    }
    this.orm.insert(documentsTable).values({
      id: normalized._id,
      type: normalized.type === undefined || normalized.type === null ? null : String(normalized.type),
      payload,
      createdAt: getTimestamp(normalized, "createdAt"),
      updatedAt: getTimestamp(normalized, "updatedAt"),
    }).run();
    return normalized;
  }

  updateDocument(document) {
    const payload = JSON.stringify(document);
    this.orm.update(documentsTable).set({
      type: document.type === undefined || document.type === null ? null : String(document.type),
      payload,
      createdAt: getTimestamp(document, "createdAt"),
      updatedAt: getTimestamp(document, "updatedAt"),
    }).where(eq(documentsTable.id, document._id)).run();
  }

  readCandidates(query) {
    const conditions = [];
    if (isPlainObject(query)) {
      if (typeof query._id === "string") {
        conditions.push(eq(documentsTable.id, query._id));
      }
      if (typeof query.type === "string") {
        conditions.push(eq(documentsTable.type, query.type));
      }
    }
    const statement = this.orm.select().from(documentsTable);
    if (conditions.length === 1) return statement.where(conditions[0]).all();
    if (conditions.length > 1) return statement.where(and(...conditions)).all();
    return statement.all();
  }

  readDocuments(query = {}) {
    return this.readCandidates(query)
      .map((row) => JSON.parse(row.payload))
      .filter((document) => matchesQuery(document, query));
  }

  async insertAsync(record) {
    await this.ready;
    if (Array.isArray(record)) {
      const inserted = this.client.transaction((records) => records.map((item) => this.insertDocument(item)))(record);
      return inserted;
    }
    return this.insertDocument(record);
  }

  async findAsync(query = {}, projection = null) {
    await this.ready;
    return this.readDocuments(query).map((document) => projectionDocument(document, projection));
  }

  async findOneAsync(query = {}, projection = null) {
    await this.ready;
    const document = this.readDocuments(query)[0];
    return document ? projectionDocument(document, projection) : null;
  }

  async updateAsync(query, update, options = {}) {
    await this.ready;
    const matches = this.readDocuments(query);
    if (matches.length === 0) {
      if (!options.upsert) {
        return { numAffected: 0 };
      }
      const inserted = this.insertDocument(extractUpsertDocument(query, update));
      return { numAffected: 1, upsert: true, affectedDocuments: inserted };
    }

    const selected = options.multi ? matches : matches.slice(0, 1);
    const updatedDocuments = selected.map((document) => applyUpdate(document, update));
    const commit = this.client.transaction((documents) => {
      for (const document of documents) {
        this.updateDocument(document);
      }
    });
    commit(updatedDocuments);
    return {
      numAffected: updatedDocuments.length,
      affectedDocuments: options.multi ? updatedDocuments : updatedDocuments[0],
    };
  }

  async claimOneAsync(query, update) {
    await this.ready;

    // Reading the candidate and changing its status must happen under the
    // same SQLite write lock. A normal findAsync() followed by updateAsync()
    // is safe inside one Node process, but two PM2 processes can otherwise
    // both observe the same pending document and process it twice.
    this.client.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readDocuments(query)[0];
      if (!current) {
        this.client.exec("COMMIT");
        return null;
      }
      const claimed = applyUpdate(current, update);
      this.updateDocument(claimed);
      this.client.exec("COMMIT");
      return claimed;
    } catch (error) {
      try {
        this.client.exec("ROLLBACK");
      } catch {
        // The transaction may already have been closed by SQLite after a
        // failed statement. Preserve the original error either way.
      }
      throw error;
    }
  }

  async claimManyAsync(query, update, { exclusiveQuery = null } = {}) {
    await this.ready;

    // This is a small queue primitive for callers that need one active batch
    // per logical scope. BEGIN IMMEDIATE makes the "is another batch already
    // processing?" check and the status transition indivisible across PM2
    // processes that share the same SQLite file.
    this.client.exec("BEGIN IMMEDIATE");
    try {
      if (exclusiveQuery && this.readDocuments(exclusiveQuery).length > 0) {
        this.client.exec("COMMIT");
        return [];
      }
      const current = this.readDocuments(query);
      if (current.length === 0) {
        this.client.exec("COMMIT");
        return [];
      }
      const claimed = current.map((document) => applyUpdate(document, update));
      for (const document of claimed) {
        this.updateDocument(document);
      }
      this.client.exec("COMMIT");
      return claimed;
    } catch (error) {
      try {
        this.client.exec("ROLLBACK");
      } catch {
        // Preserve the original database error even if SQLite has already
        // rolled the transaction back for us.
      }
      throw error;
    }
  }

  async removeAsync(query, options = {}) {
    await this.ready;
    const matches = this.readDocuments(query);
    const selected = options.multi ? matches : matches.slice(0, 1);
    const commit = this.client.transaction((documents) => {
      for (const document of documents) {
        this.orm.delete(documentsTable).where(eq(documentsTable.id, document._id)).run();
      }
    });
    commit(selected);
    return selected.length;
  }

  close() {
    this.client.close();
  }
}

function createSqliteDatabase(options) {
  return new SqliteDocumentDatabase(options);
}

module.exports = {
  LEGACY_MIGRATION_KEY,
  SqliteDocumentDatabase,
  createSqliteDatabase,
  documentsTable,
  metadataTable,
  matchesQuery,
};
