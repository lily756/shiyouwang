/**
 * Character OS v2 — 强类型 SQLite Repositories (DAO)
 * 封装各领域模型的增删改查逻辑与外键/关联关系
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  AffectReaction, Character, CharacterDiary, CharacterRelationship, ChatMessage,
  DailySchedule, FadingMemory, InventoryItem, InventoryScope, LifestyleProfile,
  MediaTaskKind, MediaTaskRecord, MediaTaskStatus, MemoryImprint, MemoryImprintCategory,
  RelationshipStage, RoleVisibility, ScheduleBlock, StickerRecord, User,
} from '../shared/types.ts';
import { safeParseJson } from '../shared/schemas.ts';

const DEFAULT_LIFESTYLE: LifestyleProfile = {
  homeLocation: '家中', defaultEnvironment: '安静的室内', usualPlaces: ['家中'],
  dailyBaseline: '日常生活', defaultOutfit: '日常便服', defaultCarriedItems: [],
};

const s = (v: unknown, d = ''): string => (v == null ? d : String(v));
const n = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);

const mapUser = (r: Record<string, unknown>): User => ({
  id: s(r.id), username: s(r.username), displayName: s(r.display_name), timezone: s(r.timezone, 'Asia/Shanghai'),
  telegramUserId: r.telegram_user_id ? s(r.telegram_user_id) : null, createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});

const mapCharacter = (r: Record<string, unknown>): Character => ({
  id: s(r.id), creatorUserId: s(r.creator_user_id), visibility: r.visibility as RoleVisibility,
  name: s(r.name), description: s(r.description), avatarUrl: s(r.avatar_url), referenceImageDataUrl: s(r.reference_image_data_url),
  corePersona: s(r.core_persona), speechStyle: s(r.speech_style),
  lifestyleProfile: safeParseJson<LifestyleProfile>(s(r.lifestyle_profile_json)) ?? DEFAULT_LIFESTYLE,
  createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});

const mapRelationship = (r: Record<string, unknown>): CharacterRelationship => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id),
  currentLocation: s(r.current_location), currentSceneDesc: s(r.current_scene_desc),
  currentActivity: s(r.current_activity), outfitDesc: s(r.outfit_desc),
  currentMoodTag: s(r.current_mood_tag, '平静'), innerMonologue: s(r.inner_monologue),
  relationshipStage: r.relationship_stage as RelationshipStage, bondScore: n(r.bond_score),
  trustScore: n(r.trust_score), moodValence: n(r.mood_valence), attachmentLevel: n(r.attachment_level),
  unlockedStages: safeParseJson<RelationshipStage[]>(s(r.unlocked_stages_json)) ?? ['stranger'],
  proactiveEnabled: Boolean(r.proactive_enabled), caffeineWakeUntil: r.caffeine_wake_until ? s(r.caffeine_wake_until) : null,
  updatedAt: s(r.updated_at),
});

const mapSchedule = (r: Record<string, unknown>): DailySchedule => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id), dateKey: s(r.date_key),
  timezone: s(r.timezone, 'Asia/Shanghai'), source: (r.source ?? 'model') as 'model' | 'repaired' | 'fallback',
  blocks: safeParseJson<ScheduleBlock[]>(s(r.blocks_json)) ?? [], createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});

const mapInventory = (r: Record<string, unknown>): InventoryItem => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id), scope: r.scope as InventoryScope,
  locationTag: s(r.location_tag), name: s(r.name), quantity: n(r.quantity), unit: s(r.unit, '个'),
  description: s(r.description), updatedAt: s(r.updated_at),
});

const mapImprint = (r: Record<string, unknown>): MemoryImprint => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id), category: r.category as MemoryImprintCategory,
  content: s(r.content), emotionalWeight: n(r.emotional_weight, 5), createdAt: s(r.created_at),
});

const mapFading = (r: Record<string, unknown>): FadingMemory => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id), dateKey: s(r.date_key),
  summary: s(r.summary), salienceScore: n(r.salience_score, 5), createdAt: s(r.created_at),
});

const mapDiary = (r: Record<string, unknown>): CharacterDiary => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id), dateKey: s(r.date_key),
  moodSummary: s(r.mood_summary), content: s(r.content), isUnlocked: Boolean(r.is_unlocked), createdAt: s(r.created_at),
});

const mapSticker = (r: Record<string, unknown>): StickerRecord => ({
  id: s(r.id), characterId: r.character_id ? s(r.character_id) : null, fileHash: s(r.file_hash),
  imageUrl: s(r.image_url), emotionTag: s(r.emotion_tag), semanticMeaning: s(r.semantic_meaning), createdAt: s(r.created_at),
});

const mapMessage = (r: Record<string, unknown>): ChatMessage => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id),
  role: r.role as 'user' | 'assistant' | 'system', content: s(r.content),
  sourceClient: (r.source_client ?? 'app') as 'app' | 'web' | 'telegram' | 'proactive',
  ...(r.media_urls_json ? { mediaUrls: safeParseJson<string[]>(s(r.media_urls_json)) ?? undefined } : {}),
  ...(r.sticker_id ? { stickerId: s(r.sticker_id) } : {}),
  ...(r.affect_reaction_json ? { affectReaction: safeParseJson<AffectReaction>(s(r.affect_reaction_json)) ?? undefined } : {}),
  createdAt: s(r.created_at),
});

const mapMediaTask = (r: Record<string, unknown>): MediaTaskRecord => ({
  id: s(r.id), userId: s(r.user_id), characterId: s(r.character_id),
  kind: r.kind as MediaTaskKind, status: r.status as MediaTaskStatus,
  actionIntent: s(r.action_intent), composedPrompt: s(r.composed_prompt),
  externalTaskId: r.external_task_id ? s(r.external_task_id) : null,
  resultUrl: r.result_url ? s(r.result_url) : null, errorMessage: r.error_message ? s(r.error_message) : null,
  createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});

export class Repositories {
  public readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  // --- Users ---
  createUser(params: { id?: string; username: string; displayName: string; timezone?: string; telegramUserId?: string | null }): User {
    const id = params.id ?? randomUUID(), now = new Date().toISOString(), tz = params.timezone ?? 'Asia/Shanghai', tgId = params.telegramUserId ?? null;
    this.db.prepare('INSERT INTO users (id, username, display_name, timezone, telegram_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, params.username, params.displayName, tz, tgId, now, now);
    return { id, username: params.username, displayName: params.displayName, timezone: tz, telegramUserId: tgId, createdAt: now, updatedAt: now };
  }

  getUserById(id: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return r ? mapUser(r) : null;
  }

  getUserByTelegramId(telegramUserId: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE telegram_user_id = ?').get(telegramUserId);
    return r ? mapUser(r) : null;
  }

  // --- Characters ---
  createCharacter(params: {
    id?: string; creatorUserId: string; visibility?: RoleVisibility; name: string;
    description?: string; avatarUrl?: string; referenceImageDataUrl?: string;
    corePersona?: string; speechStyle?: string; lifestyleProfile?: LifestyleProfile;
  }): Character {
    const item: Character = {
      id: params.id ?? randomUUID(), creatorUserId: params.creatorUserId, visibility: params.visibility ?? 'public',
      name: params.name, description: params.description ?? '', avatarUrl: params.avatarUrl ?? '',
      referenceImageDataUrl: params.referenceImageDataUrl ?? '', corePersona: params.corePersona ?? '',
      speechStyle: params.speechStyle ?? '', lifestyleProfile: params.lifestyleProfile ?? DEFAULT_LIFESTYLE,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO characters (id, creator_user_id, visibility, name, description, avatar_url, reference_image_data_url, core_persona, speech_style, lifestyle_profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(item.id, item.creatorUserId, item.visibility, item.name, item.description, item.avatarUrl, item.referenceImageDataUrl, item.corePersona, item.speechStyle, JSON.stringify(item.lifestyleProfile), item.createdAt, item.updatedAt);
    return item;
  }

  getCharacterById(id: string): Character | null {
    const r = this.db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    return r ? mapCharacter(r) : null;
  }

  listCharactersForUser(userId: string): Character[] {
    const rows = this.db.prepare('SELECT * FROM characters WHERE visibility = ? OR creator_user_id = ? ORDER BY created_at DESC').all('public', userId);
    return rows.map(mapCharacter);
  }

  // --- Relationships ---
  ensureRelationship(userId: string, characterId: string, character?: Character): CharacterRelationship {
    const existing = this.getRelationship(userId, characterId);
    if (existing) return existing;
    const char = character ?? this.getCharacterById(characterId);
    const p = char?.lifestyleProfile ?? DEFAULT_LIFESTYLE;
    const now = new Date().toISOString();
    const rel: CharacterRelationship = {
      id: randomUUID(), userId, characterId,
      currentLocation: p.homeLocation || '家中', currentSceneDesc: p.defaultEnvironment || '安静的室内',
      currentActivity: p.dailyBaseline || '休息', outfitDesc: p.defaultOutfit || '日常便服',
      currentMoodTag: '平静', innerMonologue: '', relationshipStage: 'stranger',
      bondScore: 0, trustScore: 0, moodValence: 0, attachmentLevel: 0,
      unlockedStages: ['stranger'], proactiveEnabled: true, caffeineWakeUntil: null, updatedAt: now,
    };
    this.db.prepare(
      `INSERT INTO character_relationships (id, user_id, character_id, current_location, current_scene_desc, current_activity, outfit_desc, current_mood_tag, inner_monologue, relationship_stage, bond_score, trust_score, mood_valence, attachment_level, unlocked_stages_json, proactive_enabled, caffeine_wake_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      rel.id, rel.userId, rel.characterId, rel.currentLocation, rel.currentSceneDesc, rel.currentActivity,
      rel.outfitDesc, rel.currentMoodTag, rel.innerMonologue, rel.relationshipStage, rel.bondScore,
      rel.trustScore, rel.moodValence, rel.attachmentLevel, JSON.stringify(rel.unlockedStages),
      rel.proactiveEnabled ? 1 : 0, rel.caffeineWakeUntil, rel.updatedAt
    );
    return rel;
  }

  getRelationship(userId: string, characterId: string): CharacterRelationship | null {
    const r = this.db.prepare('SELECT * FROM character_relationships WHERE user_id = ? AND character_id = ?').get(userId, characterId);
    return r ? mapRelationship(r) : null;
  }

  updateRelationship(userId: string, characterId: string, patch: Partial<CharacterRelationship>): CharacterRelationship | null {
    const current = this.getRelationship(userId, characterId);
    if (!current) return null;
    const updated: CharacterRelationship = { ...current, ...patch, id: current.id, userId, characterId, updatedAt: patch.updatedAt ?? new Date().toISOString() };
    this.db.prepare(
      `UPDATE character_relationships SET current_location = ?, current_scene_desc = ?, current_activity = ?, outfit_desc = ?, current_mood_tag = ?, inner_monologue = ?, relationship_stage = ?, bond_score = ?, trust_score = ?, mood_valence = ?, attachment_level = ?, unlocked_stages_json = ?, proactive_enabled = ?, caffeine_wake_until = ?, updated_at = ?
       WHERE user_id = ? AND character_id = ?`
    ).run(
      updated.currentLocation, updated.currentSceneDesc, updated.currentActivity, updated.outfitDesc, updated.currentMoodTag, updated.innerMonologue,
      updated.relationshipStage, updated.bondScore, updated.trustScore, updated.moodValence, updated.attachmentLevel, JSON.stringify(updated.unlockedStages),
      updated.proactiveEnabled ? 1 : 0, updated.caffeineWakeUntil, updated.updatedAt, userId, characterId
    );
    return updated;
  }

  // --- Daily Schedules ---
  upsertDailySchedule(schedule: Omit<DailySchedule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): DailySchedule {
    const ex = this.getDailySchedule(schedule.userId, schedule.characterId, schedule.dateKey);
    const now = new Date().toISOString();
    if (ex) {
      const upd: DailySchedule = { ...ex, timezone: schedule.timezone ?? ex.timezone, source: schedule.source ?? ex.source, blocks: schedule.blocks ?? ex.blocks, updatedAt: now };
      this.db.prepare('UPDATE daily_schedules SET timezone = ?, source = ?, blocks_json = ?, updated_at = ? WHERE id = ?').run(upd.timezone, upd.source, JSON.stringify(upd.blocks), upd.updatedAt, upd.id);
      return upd;
    }
    const item: DailySchedule = {
      id: schedule.id ?? randomUUID(), userId: schedule.userId, characterId: schedule.characterId, dateKey: schedule.dateKey,
      timezone: schedule.timezone ?? 'Asia/Shanghai', source: schedule.source ?? 'model', blocks: schedule.blocks ?? [], createdAt: now, updatedAt: now,
    };
    this.db.prepare('INSERT INTO daily_schedules (id, user_id, character_id, date_key, timezone, source, blocks_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.userId, item.characterId, item.dateKey, item.timezone, item.source, JSON.stringify(item.blocks), item.createdAt, item.updatedAt);
    return item;
  }

  getDailySchedule(userId: string, characterId: string, dateKey: string): DailySchedule | null {
    const r = this.db.prepare('SELECT * FROM daily_schedules WHERE user_id = ? AND character_id = ? AND date_key = ?').get(userId, characterId, dateKey);
    return r ? mapSchedule(r) : null;
  }

  // --- Inventory Items ---
  upsertInventoryItem(item: Omit<InventoryItem, 'id' | 'updatedAt'> & { id?: string }): InventoryItem | null {
    const row = item.id
      ? this.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(item.id)
      : this.db.prepare('SELECT * FROM inventory_items WHERE user_id = ? AND character_id = ? AND scope = ? AND name = ?').get(item.userId, item.characterId, item.scope, item.name);
    const ex = row ? mapInventory(row) : null;
    if (item.quantity <= 0) {
      if (ex) this.deleteInventoryItem(ex.id);
      return null;
    }
    const now = new Date().toISOString();
    if (ex) {
      const upd: InventoryItem = { ...ex, locationTag: item.locationTag ?? ex.locationTag, quantity: item.quantity, unit: item.unit ?? ex.unit, description: item.description ?? ex.description, updatedAt: now };
      this.db.prepare('UPDATE inventory_items SET location_tag = ?, quantity = ?, unit = ?, description = ?, updated_at = ? WHERE id = ?').run(upd.locationTag, upd.quantity, upd.unit, upd.description, upd.updatedAt, upd.id);
      return upd;
    }
    const created: InventoryItem = { id: item.id ?? randomUUID(), userId: item.userId, characterId: item.characterId, scope: item.scope, locationTag: item.locationTag ?? '', name: item.name, quantity: item.quantity, unit: item.unit ?? '个', description: item.description ?? '', updatedAt: now };
    this.db.prepare('INSERT INTO inventory_items (id, user_id, character_id, scope, location_tag, name, quantity, unit, description, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(created.id, created.userId, created.characterId, created.scope, created.locationTag, created.name, created.quantity, created.unit, created.description, created.updatedAt);
    return created;
  }

  listInventoryItems(userId: string, characterId: string, scopes?: InventoryScope[]): InventoryItem[] {
    if (scopes && scopes.length > 0) {
      const ph = scopes.map(() => '?').join(', ');
      const rows = this.db.prepare(`SELECT * FROM inventory_items WHERE user_id = ? AND character_id = ? AND scope IN (${ph}) ORDER BY scope ASC, name ASC`).all(userId, characterId, ...scopes);
      return rows.map(mapInventory);
    }
    const rows = this.db.prepare('SELECT * FROM inventory_items WHERE user_id = ? AND character_id = ? ORDER BY scope ASC, name ASC').all(userId, characterId);
    return rows.map(mapInventory);
  }

  deleteInventoryItem(id: string): boolean {
    const res = this.db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // --- Memory Imprints ---
  addMemoryImprint(imprint: Omit<MemoryImprint, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): MemoryImprint {
    const id = imprint.id ?? randomUUID(), createdAt = imprint.createdAt ?? new Date().toISOString();
    this.db.prepare('INSERT INTO memory_imprints (id, user_id, character_id, category, content, emotional_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, imprint.userId, imprint.characterId, imprint.category, imprint.content, imprint.emotionalWeight, createdAt);
    return { id, userId: imprint.userId, characterId: imprint.characterId, category: imprint.category, content: imprint.content, emotionalWeight: imprint.emotionalWeight, createdAt };
  }

  listMemoryImprints(userId: string, characterId: string): MemoryImprint[] {
    const rows = this.db.prepare('SELECT * FROM memory_imprints WHERE user_id = ? AND character_id = ? ORDER BY created_at DESC').all(userId, characterId);
    return rows.map(mapImprint);
  }

  // --- Fading Memories ---
  addFadingMemory(memory: Omit<FadingMemory, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): FadingMemory {
    const id = memory.id ?? randomUUID(), createdAt = memory.createdAt ?? new Date().toISOString();
    this.db.prepare('INSERT INTO fading_memories (id, user_id, character_id, date_key, summary, salience_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, memory.userId, memory.characterId, memory.dateKey, memory.summary, memory.salienceScore, createdAt);
    return { id, userId: memory.userId, characterId: memory.characterId, dateKey: memory.dateKey, summary: memory.summary, salienceScore: memory.salienceScore, createdAt };
  }

  listFadingMemories(userId: string, characterId: string): FadingMemory[] {
    const rows = this.db.prepare('SELECT * FROM fading_memories WHERE user_id = ? AND character_id = ? ORDER BY created_at DESC').all(userId, characterId);
    return rows.map(mapFading);
  }

  // --- Character Diaries ---
  upsertCharacterDiary(diary: Omit<CharacterDiary, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): CharacterDiary {
    const ex = this.getCharacterDiary(diary.userId, diary.characterId, diary.dateKey);
    const now = new Date().toISOString();
    if (ex) {
      const upd: CharacterDiary = { ...ex, moodSummary: diary.moodSummary ?? ex.moodSummary, content: diary.content ?? ex.content, isUnlocked: diary.isUnlocked ?? ex.isUnlocked };
      this.db.prepare('UPDATE character_diaries SET mood_summary = ?, content = ?, is_unlocked = ? WHERE id = ?').run(upd.moodSummary, upd.content, upd.isUnlocked ? 1 : 0, upd.id);
      return upd;
    }
    const item: CharacterDiary = { id: diary.id ?? randomUUID(), userId: diary.userId, characterId: diary.characterId, dateKey: diary.dateKey, moodSummary: diary.moodSummary ?? '', content: diary.content, isUnlocked: diary.isUnlocked ?? false, createdAt: diary.createdAt ?? now };
    this.db.prepare('INSERT INTO character_diaries (id, user_id, character_id, date_key, mood_summary, content, is_unlocked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.userId, item.characterId, item.dateKey, item.moodSummary, item.content, item.isUnlocked ? 1 : 0, item.createdAt);
    return item;
  }

  getCharacterDiary(userId: string, characterId: string, dateKey: string): CharacterDiary | null {
    const r = this.db.prepare('SELECT * FROM character_diaries WHERE user_id = ? AND character_id = ? AND date_key = ?').get(userId, characterId, dateKey);
    return r ? mapDiary(r) : null;
  }

  listCharacterDiaries(userId: string, characterId: string): CharacterDiary[] {
    const rows = this.db.prepare('SELECT * FROM character_diaries WHERE user_id = ? AND character_id = ? ORDER BY date_key DESC').all(userId, characterId);
    return rows.map(mapDiary);
  }

  // --- Stickers ---
  upsertSticker(sticker: Omit<StickerRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): StickerRecord {
    const ex = this.getStickerByHash(sticker.fileHash);
    const now = new Date().toISOString();
    if (ex) {
      const upd: StickerRecord = { ...ex, characterId: sticker.characterId !== undefined ? sticker.characterId : ex.characterId, imageUrl: sticker.imageUrl ?? ex.imageUrl, emotionTag: sticker.emotionTag ?? ex.emotionTag, semanticMeaning: sticker.semanticMeaning ?? ex.semanticMeaning };
      this.db.prepare('UPDATE stickers SET character_id = ?, image_url = ?, emotion_tag = ?, semantic_meaning = ? WHERE id = ?').run(upd.characterId, upd.imageUrl, upd.emotionTag, upd.semanticMeaning, upd.id);
      return upd;
    }
    const item: StickerRecord = { id: sticker.id ?? randomUUID(), characterId: sticker.characterId ?? null, fileHash: sticker.fileHash, imageUrl: sticker.imageUrl, emotionTag: sticker.emotionTag, semanticMeaning: sticker.semanticMeaning ?? '', createdAt: sticker.createdAt ?? now };
    this.db.prepare('INSERT INTO stickers (id, character_id, file_hash, image_url, emotion_tag, semantic_meaning, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.characterId, item.fileHash, item.imageUrl, item.emotionTag, item.semanticMeaning, item.createdAt);
    return item;
  }

  getStickerByHash(fileHash: string): StickerRecord | null {
    const r = this.db.prepare('SELECT * FROM stickers WHERE file_hash = ?').get(fileHash);
    return r ? mapSticker(r) : null;
  }

  findStickerByEmotion(characterId: string | null, emotionTag: string): StickerRecord | null {
    if (characterId) {
      const r = this.db.prepare(
        'SELECT * FROM stickers WHERE (character_id = ? OR character_id IS NULL) AND emotion_tag = ? ORDER BY CASE WHEN character_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1'
      ).get(characterId, emotionTag, characterId);
      return r ? mapSticker(r) : null;
    }
    const r = this.db.prepare('SELECT * FROM stickers WHERE character_id IS NULL AND emotion_tag = ? ORDER BY created_at DESC LIMIT 1').get(emotionTag);
    return r ? mapSticker(r) : null;
  }

  // --- Messages ---
  appendMessage(message: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ChatMessage {
    const id = message.id ?? randomUUID(), createdAt = message.createdAt ?? new Date().toISOString();
    const mediaUrlsJson = message.mediaUrls ? JSON.stringify(message.mediaUrls) : null;
    const affectJson = message.affectReaction ? JSON.stringify(message.affectReaction) : null;
    this.db.prepare(
      'INSERT INTO messages (id, user_id, character_id, role, content, source_client, media_urls_json, sticker_id, affect_reaction_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, message.userId, message.characterId, message.role, message.content, message.sourceClient ?? 'app', mediaUrlsJson, message.stickerId ?? null, affectJson, createdAt);
    return {
      id, userId: message.userId, characterId: message.characterId, role: message.role, content: message.content,
      sourceClient: message.sourceClient ?? 'app', ...(message.mediaUrls ? { mediaUrls: message.mediaUrls } : {}),
      ...(message.stickerId ? { stickerId: message.stickerId } : {}), ...(message.affectReaction ? { affectReaction: message.affectReaction } : {}),
      createdAt,
    };
  }

  listRecentMessages(userId: string, characterId: string, limit = 20): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE user_id = ? AND character_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(userId, characterId, limit);
    return rows.reverse().map(mapMessage);
  }

  // --- Media Tasks ---
  createMediaTask(task: Omit<MediaTaskRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MediaTaskRecord {
    const now = new Date().toISOString();
    const item: MediaTaskRecord = {
      id: task.id ?? randomUUID(), userId: task.userId, characterId: task.characterId, kind: task.kind, status: task.status ?? 'pending',
      actionIntent: task.actionIntent ?? '', composedPrompt: task.composedPrompt ?? '', externalTaskId: task.externalTaskId ?? null,
      resultUrl: task.resultUrl ?? null, errorMessage: task.errorMessage ?? null, createdAt: now, updatedAt: now,
    };
    this.db.prepare(
      'INSERT INTO media_tasks (id, user_id, character_id, kind, status, action_intent, composed_prompt, external_task_id, result_url, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(item.id, item.userId, item.characterId, item.kind, item.status, item.actionIntent, item.composedPrompt, item.externalTaskId, item.resultUrl, item.errorMessage, item.createdAt, item.updatedAt);
    return item;
  }

  updateMediaTask(id: string, patch: Partial<MediaTaskRecord>): MediaTaskRecord | null {
    const current = this.getMediaTask(id);
    if (!current) return null;
    const upd: MediaTaskRecord = { ...current, ...patch, id: current.id, userId: current.userId, characterId: current.characterId, updatedAt: patch.updatedAt ?? new Date().toISOString() };
    this.db.prepare(
      'UPDATE media_tasks SET kind = ?, status = ?, action_intent = ?, composed_prompt = ?, external_task_id = ?, result_url = ?, error_message = ?, updated_at = ? WHERE id = ?'
    ).run(upd.kind, upd.status, upd.actionIntent, upd.composedPrompt, upd.externalTaskId, upd.resultUrl, upd.errorMessage, upd.updatedAt, id);
    return upd;
  }

  getMediaTask(id: string): MediaTaskRecord | null {
    const r = this.db.prepare('SELECT * FROM media_tasks WHERE id = ?').get(id);
    return r ? mapMediaTask(r) : null;
  }

  listMediaTasks(userId: string, characterId: string): MediaTaskRecord[] {
    const rows = this.db.prepare('SELECT * FROM media_tasks WHERE user_id = ? AND character_id = ? ORDER BY created_at DESC').all(userId, characterId);
    return rows.map(mapMediaTask);
  }
}
