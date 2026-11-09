/**
 * Character OS v2 — SQLite 连接管理与 DDL 迁移
 * 使用 Node.js v24 内置 node:sqlite (DatabaseSync)
 */

import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  telegram_user_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_bind_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'public',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  reference_image_data_url TEXT NOT NULL DEFAULT '',
  core_persona TEXT NOT NULL DEFAULT '',
  speech_style TEXT NOT NULL DEFAULT '',
  lifestyle_profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  current_location TEXT NOT NULL DEFAULT '',
  current_scene_desc TEXT NOT NULL DEFAULT '',
  current_activity TEXT NOT NULL DEFAULT '',
  outfit_desc TEXT NOT NULL DEFAULT '',
  current_mood_tag TEXT NOT NULL DEFAULT '平静',
  inner_monologue TEXT NOT NULL DEFAULT '',
  relationship_stage TEXT NOT NULL DEFAULT 'stranger',
  bond_score INTEGER NOT NULL DEFAULT 0,
  trust_score INTEGER NOT NULL DEFAULT 0,
  mood_valence INTEGER NOT NULL DEFAULT 0,
  attachment_level INTEGER NOT NULL DEFAULT 0,
  unlocked_stages_json TEXT NOT NULL DEFAULT '["stranger"]',
  proactive_enabled INTEGER NOT NULL DEFAULT 1,
  caffeine_wake_until TEXT DEFAULT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, character_id)
);

CREATE TABLE IF NOT EXISTS daily_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  source TEXT NOT NULL DEFAULT 'model',
  blocks_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, character_id, date_key)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  location_tag TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '个',
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_imprints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  emotional_weight INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fading_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  salience_score REAL NOT NULL DEFAULT 5.0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_diaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  mood_summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  is_unlocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, character_id, date_key)
);

CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE DEFAULT NULL,
  file_hash TEXT UNIQUE NOT NULL,
  image_url TEXT NOT NULL,
  emotion_tag TEXT NOT NULL,
  semantic_meaning TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  source_client TEXT NOT NULL DEFAULT 'app',
  media_urls_json TEXT DEFAULT NULL,
  sticker_id TEXT REFERENCES stickers(id) ON DELETE SET NULL DEFAULT NULL,
  affect_reaction_json TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  action_intent TEXT NOT NULL DEFAULT '',
  composed_prompt TEXT NOT NULL DEFAULT '',
  external_task_id TEXT DEFAULT NULL,
  result_url TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_characters_creator ON characters(creator_user_id, visibility);
CREATE INDEX IF NOT EXISTS idx_relationships_lookup ON character_relationships(user_id, character_id);
CREATE INDEX IF NOT EXISTS idx_schedules_lookup ON daily_schedules(user_id, character_id, date_key);
CREATE INDEX IF NOT EXISTS idx_inventory_lookup ON inventory_items(user_id, character_id, scope);
CREATE INDEX IF NOT EXISTS idx_inventory_match ON inventory_items(user_id, character_id, scope, name);
CREATE INDEX IF NOT EXISTS idx_imprints_lookup ON memory_imprints(user_id, character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fading_lookup ON fading_memories(user_id, character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaries_lookup ON character_diaries(user_id, character_id, date_key DESC);
CREATE INDEX IF NOT EXISTS idx_stickers_lookup ON stickers(character_id, emotion_tag);
CREATE INDEX IF NOT EXISTS idx_messages_chronological ON messages(user_id, character_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_media_tasks_lookup ON media_tasks(user_id, character_id, created_at DESC);
`;

export class DatabaseManager {
  public readonly db: DatabaseSync;

  constructor(filename: string = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.migrate();
  }

  public migrate(): void {
    this.db.exec(SCHEMA_SQL);
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''");
    } catch {
      // Column already exists
    }
  }

  public close(): void {
    this.db.close();
  }
}

export function createDatabase(filename: string = ':memory:'): DatabaseSync {
  const manager = new DatabaseManager(filename);
  return manager.db;
}
