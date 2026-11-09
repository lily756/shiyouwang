/**
 * Character OS v2 — Database & Typed Repositories Unit Tests
 * 覆盖 11 张表的 CRUD、Telegram 检索、关系人设初始化、库存归零自删、时间序消息
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager, createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';

describe('DatabaseManager & Connection', () => {
  it('initializes in-memory database and executes migrations idempotently', () => {
    const manager = new DatabaseManager(':memory:');
    assert.ok(manager.db);
    manager.migrate();
    const fk = manager.db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
    assert.equal(fk.foreign_keys, 1);
    manager.close();
  });

  it('createDatabase helper returns active DatabaseSync instance', () => {
    const db = createDatabase();
    const row = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get() as { count: number };
    assert.ok(row.count >= 11);
    db.close();
  });
});

describe('Repositories Integration Tests', () => {
  const db = createDatabase();
  const repo = new Repositories(db);
  let userId: string, otherUserId: string, characterId: string, privateCharId: string;

  it('handles user creation and Telegram ID lookup', () => {
    const user = repo.createUser({ username: 'alice', displayName: 'Alice Wonderland', timezone: 'Asia/Tokyo', telegramUserId: 'tg_123456' });
    userId = user.id;
    assert.equal(user.username, 'alice');
    assert.equal(user.timezone, 'Asia/Tokyo');
    assert.equal(user.telegramUserId, 'tg_123456');

    assert.deepEqual(repo.getUserById(user.id), user);
    assert.deepEqual(repo.getUserByTelegramId('tg_123456'), user);
    assert.equal(repo.getUserById('non-existent'), null);
    assert.equal(repo.getUserByTelegramId('tg_unknown'), null);

    assert.throws(() => repo.createUser({ username: 'bob', displayName: 'Bob', telegramUserId: 'tg_123456' }));
    otherUserId = repo.createUser({ username: 'bob', displayName: 'Bob', telegramUserId: null }).id;
  });

  it('handles character creation and visibility listing', () => {
    const publicChar = repo.createCharacter({
      creatorUserId: userId, visibility: 'public', name: '双炽', description: '九尾狐妖仆',
      avatarUrl: 'https://example.com/avatar.png', referenceImageDataUrl: 'data:image/png;base64,abc',
      corePersona: '忠诚、温雅腹黑', speechStyle: '您是我的全部',
      lifestyleProfile: {
        homeLocation: '妖馆404室', defaultEnvironment: '和式茶室', usualPlaces: ['妖馆404室', '庭院'],
        dailyBaseline: '泡茶与侍奉', defaultOutfit: '黑色西装', defaultCarriedItems: ['怀表'],
      },
    });
    characterId = publicChar.id;
    assert.equal(publicChar.name, '双炽');
    assert.equal(publicChar.lifestyleProfile.homeLocation, '妖馆404室');

    privateCharId = repo.createCharacter({ creatorUserId: userId, visibility: 'private', name: 'Alice私人管家' }).id;
    const otherPriv = repo.createCharacter({ creatorUserId: otherUserId, visibility: 'private', name: 'Bob秘密执事' });

    const idsA = repo.listCharactersForUser(userId).map((c) => c.id);
    assert.ok(idsA.includes(characterId) && idsA.includes(privateCharId) && !idsA.includes(otherPriv.id));

    const idsB = repo.listCharactersForUser(otherUserId).map((c) => c.id);
    assert.ok(idsB.includes(characterId) && idsB.includes(otherPriv.id) && !idsB.includes(privateCharId));
  });

  it('ensures relationship from character lifestyle profile and updates state', () => {
    const rel = repo.ensureRelationship(userId, characterId);
    assert.equal(rel.userId, userId);
    assert.equal(rel.characterId, characterId);
    assert.equal(rel.currentLocation, '妖馆404室');
    assert.equal(rel.currentSceneDesc, '和式茶室');
    assert.equal(rel.currentActivity, '泡茶与侍奉');
    assert.equal(rel.outfitDesc, '黑色西装');
    assert.equal(rel.relationshipStage, 'stranger');
    assert.equal(rel.bondScore, 0);
    assert.equal(rel.proactiveEnabled, true);

    const relAgain = repo.ensureRelationship(userId, characterId);
    assert.equal(relAgain.id, rel.id);

    const updated = repo.updateRelationship(userId, characterId, {
      currentLocation: '客厅', currentActivity: '喝热茶', bondScore: 120, trustScore: 45,
      moodValence: 30, relationshipStage: 'friend', unlockedStages: ['stranger', 'acquaintance', 'friend'],
      caffeineWakeUntil: '2026-11-09T02:00:00Z',
    });
    assert.ok(updated);
    assert.equal(updated.currentLocation, '客厅');
    assert.equal(updated.bondScore, 120);
    assert.equal(updated.relationshipStage, 'friend');
    assert.deepEqual(updated.unlockedStages, ['stranger', 'acquaintance', 'friend']);
    assert.equal(updated.caffeineWakeUntil, '2026-11-09T02:00:00Z');

    assert.deepEqual(repo.getRelationship(userId, characterId), updated);
  });

  it('handles daily schedule upsert and query', () => {
    const blocks = [{
      id: 'b1', startMinute: 480, endMinute: 720, category: 'work' as const, activity: '整理文档',
      location: '书房', environment: '窗明几净', mood: '专注', proactiveHint: false, status: 'planned' as const,
    }];
    const sched = repo.upsertDailySchedule({ userId, characterId, dateKey: '2026-11-09', timezone: 'Asia/Shanghai', source: 'model', blocks });
    assert.equal(sched.dateKey, '2026-11-09');
    assert.equal(sched.blocks.length, 1);

    const updated = repo.upsertDailySchedule({
      userId, characterId, dateKey: '2026-11-09', timezone: 'Asia/Shanghai', source: 'repaired',
      blocks: [...blocks, {
        id: 'b2', startMinute: 720, endMinute: 780, category: 'meal' as const, activity: '午餐',
        location: '餐厅', environment: '安静', mood: '轻松', proactiveHint: true, status: 'planned' as const,
      }],
    });
    assert.equal(updated.id, sched.id);
    assert.equal(updated.source, 'repaired');
    assert.equal(updated.blocks.length, 2);

    assert.deepEqual(repo.getDailySchedule(userId, characterId, '2026-11-09'), updated);
    assert.equal(repo.getDailySchedule(userId, characterId, '2099-01-01'), null);
  });

  it('handles inventory upsert, auto-remove on quantity <= 0, and scope filtering', () => {
    const item1 = repo.upsertInventoryItem({
      userId, characterId, scope: 'shared_home', locationTag: '冰箱', name: '牛奶', quantity: 2, unit: '瓶', description: '鲜牛奶',
    });
    assert.ok(item1);
    assert.equal(item1.quantity, 2);

    const item2 = repo.upsertInventoryItem({
      userId, characterId, scope: 'character_carried', locationTag: '随身背包', name: '怀表', quantity: 1, unit: '只', description: '银怀表',
    });
    assert.ok(item2);

    // Consume 1 bottle
    const item1AfterDrink = repo.upsertInventoryItem({
      userId, characterId, scope: 'shared_home', name: '牛奶', quantity: 1, unit: '瓶', locationTag: '冰箱', description: '剩1瓶',
    });
    assert.ok(item1AfterDrink);
    assert.equal(item1AfterDrink.id, item1.id);
    assert.equal(item1AfterDrink.quantity, 1);

    // Auto-remove when quantity drops to 0
    const removed = repo.upsertInventoryItem({
      userId, characterId, scope: 'shared_home', name: '牛奶', quantity: 0, unit: '瓶', locationTag: '冰箱', description: '喝完',
    });
    assert.equal(removed, null);

    const currentItems = repo.listInventoryItems(userId, characterId);
    assert.equal(currentItems.length, 1);
    assert.equal(currentItems[0].name, '怀表');

    // Scope filtering
    repo.upsertInventoryItem({
      userId, characterId, scope: 'character_held', locationTag: '右手', name: '咖啡杯', quantity: 1, unit: '个', description: '拿铁',
    });
    assert.equal(repo.listInventoryItems(userId, characterId, ['character_held', 'character_carried']).length, 2);
    assert.equal(repo.listInventoryItems(userId, characterId, ['shared_home']).length, 0);

    // Delete by id
    assert.equal(repo.deleteInventoryItem(item2.id), true);
    assert.equal(repo.deleteInventoryItem('invalid-id'), false);
  });

  it('handles memory imprints and fading memories', () => {
    const imp = repo.addMemoryImprint({
      userId, characterId, category: 'milestone', content: '首次建立契约关系', emotionalWeight: 10,
    });
    assert.ok(imp.id);
    assert.equal(imp.emotionalWeight, 10);
    const imprints = repo.listMemoryImprints(userId, characterId);
    assert.equal(imprints.length, 1);
    assert.equal(imprints[0].content, '首次建立契约关系');

    const fad = repo.addFadingMemory({
      userId, characterId, dateKey: '2026-11-08', summary: '今天在茶室一起喝了煎茶', salienceScore: 6.5,
    });
    assert.ok(fad.id);
    assert.equal(fad.salienceScore, 6.5);
    const fading = repo.listFadingMemories(userId, characterId);
    assert.equal(fading.length, 1);
    assert.equal(fading[0].summary, '今天在茶室一起喝了煎茶');
  });

  it('handles character diaries', () => {
    const diary = repo.upsertCharacterDiary({
      userId, characterId, dateKey: '2026-11-08', moodSummary: '平静而喜悦', content: '今天收到了她的礼物。', isUnlocked: false,
    });
    assert.equal(diary.isUnlocked, false);

    const updated = repo.upsertCharacterDiary({
      userId, characterId, dateKey: '2026-11-08', moodSummary: '深刻的动容', content: '今天收到了她的礼物。（已解锁）', isUnlocked: true,
    });
    assert.equal(updated.id, diary.id);
    assert.equal(updated.isUnlocked, true);

    assert.deepEqual(repo.getCharacterDiary(userId, characterId, '2026-11-08'), updated);
    assert.equal(repo.listCharacterDiaries(userId, characterId).length, 1);
  });

  it('handles sticker storage and emotion fallback lookup', () => {
    const uniSticker = repo.upsertSticker({
      characterId: null, fileHash: 'hash_uni_shy', imageUrl: 'https://example.com/uni_shy.png', emotionTag: '害羞', semanticMeaning: '脸红通用表情',
    });
    const charSticker = repo.upsertSticker({
      characterId, fileHash: 'hash_char_shy', imageUrl: 'https://example.com/char_shy.png', emotionTag: '害羞', semanticMeaning: '双炽狐耳抖动脸红',
    });

    // Character specific sticker has priority
    assert.equal(repo.findStickerByEmotion(characterId, '害羞')?.id, charSticker.id);
    // Other character falls back to universal sticker
    assert.equal(repo.findStickerByEmotion('other_character', '害羞')?.id, uniSticker.id);
    // Null characterId queries universal sticker
    assert.equal(repo.findStickerByEmotion(null, '害羞')?.id, uniSticker.id);
    // Unmatched emotion returns null
    assert.equal(repo.findStickerByEmotion(characterId, '狂怒'), null);
    // Get by hash
    assert.equal(repo.getStickerByHash('hash_char_shy')?.id, charSticker.id);
  });

  it('handles messages and enforces chronological ordering on listRecentMessages', () => {
    const timestamps = [
      '2026-11-08T10:00:00.000Z', '2026-11-08T10:01:00.000Z', '2026-11-08T10:02:00.000Z',
      '2026-11-08T10:03:00.000Z', '2026-11-08T10:04:00.000Z',
    ];
    for (let i = 0; i < 5; i++) {
      repo.appendMessage({
        userId, characterId, role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i + 1}`,
        sourceClient: 'app', createdAt: timestamps[i],
        ...(i === 4 ? {
          affectReaction: { deltaMood: 15, deltaBond: 10, deltaTrust: 5, moodTag: '开心', innerMonologue: '能帮上忙真好' },
          mediaUrls: ['https://example.com/photo.jpg'],
        } : {}),
      });
    }

    const recent3 = repo.listRecentMessages(userId, characterId, 3);
    assert.equal(recent3.length, 3);
    assert.equal(recent3[0].content, 'Message 3');
    assert.equal(recent3[1].content, 'Message 4');
    assert.equal(recent3[2].content, 'Message 5');
    assert.deepEqual(recent3[2].mediaUrls, ['https://example.com/photo.jpg']);
    assert.equal(recent3[2].affectReaction?.moodTag, '开心');
    assert.equal(recent3[2].affectReaction?.deltaBond, 10);
  });

  it('handles media task lifecycle', () => {
    const task = repo.createMediaTask({
      userId, characterId, kind: 'image_i2i', actionIntent: '喝热茶自拍', composedPrompt: '双炽端着茶杯微笑',
    });
    assert.ok(task.id);
    assert.equal(task.status, 'pending');

    repo.updateMediaTask(task.id, { status: 'running', externalTaskId: 'ext_ark_9988' });
    const finished = repo.updateMediaTask(task.id, { status: 'succeeded', resultUrl: 'https://example.com/generated.png' });
    assert.ok(finished);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.resultUrl, 'https://example.com/generated.png');
    assert.equal(finished.externalTaskId, 'ext_ark_9988');

    assert.deepEqual(repo.getMediaTask(task.id), finished);
    assert.equal(repo.listMediaTasks(userId, characterId).length, 1);
  });

  it('enforces foreign key cascading deletion', () => {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    assert.equal(repo.getCharacterById(characterId), null);
    assert.equal(repo.getRelationship(userId, characterId), null);
    assert.equal(repo.listInventoryItems(userId, characterId).length, 0);
    assert.equal(repo.listRecentMessages(userId, characterId).length, 0);
  });
});
