/**
 * Character OS v2 — Affect Engine, Memory Engine & Context Builder Unit Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';
import { AffectEngine } from '../../src/engine/affect-engine.ts';
import { MemoryEngine } from '../../src/engine/memory-engine.ts';
import { ContextBuilder } from '../../src/engine/context-builder.ts';
import type {
  Character,
  CharacterRelationship,
  ChatMessage,
  ScheduleBlock,
} from '../../src/shared/types.ts';

describe('AffectEngine', () => {
  let repos: Repositories;
  let affectEngine: AffectEngine;

  beforeEach(() => {
    const db = createDatabase(':memory:');
    repos = new Repositories(db);
    affectEngine = new AffectEngine(repos);

    repos.createUser({ id: 'u1', username: 'testuser', displayName: '测试用户' });
    repos.createCharacter({
      id: 'c1',
      creatorUserId: 'u1',
      name: '双炽',
      corePersona: '忠诚侍从',
      speechStyle: '谦逊温柔',
    });
    repos.ensureRelationship('u1', 'c1');
  });

  it('resolves correct relationship stages from bond scores', () => {
    assert.equal(AffectEngine.resolveStageFromBond(0), 'stranger');
    assert.equal(AffectEngine.resolveStageFromBond(99), 'stranger');
    assert.equal(AffectEngine.resolveStageFromBond(100), 'acquaintance');
    assert.equal(AffectEngine.resolveStageFromBond(249), 'acquaintance');
    assert.equal(AffectEngine.resolveStageFromBond(250), 'friend');
    assert.equal(AffectEngine.resolveStageFromBond(499), 'friend');
    assert.equal(AffectEngine.resolveStageFromBond(500), 'ambiguous');
    assert.equal(AffectEngine.resolveStageFromBond(749), 'ambiguous');
    assert.equal(AffectEngine.resolveStageFromBond(750), 'lover');
    assert.equal(AffectEngine.resolveStageFromBond(919), 'lover');
    assert.equal(AffectEngine.resolveStageFromBond(920), 'devoted');
    assert.equal(AffectEngine.resolveStageFromBond(1000), 'devoted');
  });

  it('parses <affect> tag, clamps metrics, updates relationship and matches sticker', () => {
    // Add a sticker for testing
    repos.upsertSticker({
      characterId: 'c1',
      fileHash: 'hash-shy-01',
      imageUrl: 'https://cdn.example.com/shy.png',
      emotionTag: '害羞',
      semanticMeaning: '双炽用折扇遮住泛红的脸颊',
    });

    const rawReply =
      '<affect delta_mood="+30" delta_bond="+100" delta_trust="+40" mood="满心欢喜" sticker="害羞">主人竟然如此体贴，心跳得好快</affect>主人，谢谢您的关照，我会一直侍奉您。';

    const result = affectEngine.processReplyAffect('u1', 'c1', rawReply);

    assert.equal(
      result.cleanContent,
      '主人，谢谢您的关照，我会一直侍奉您。',
    );
    assert.ok(result.affect);
    assert.equal(result.affect.deltaMood, 30);
    assert.equal(result.affect.deltaBond, 100);
    assert.equal(result.affect.deltaTrust, 40);
    assert.equal(result.affect.moodTag, '满心欢喜');
    assert.equal(result.affect.innerMonologue, '主人竟然如此体贴，心跳得好快');

    // Bond: 0 + 100 = 100 -> 'acquaintance'
    assert.equal(result.relationship.bondScore, 100);
    assert.equal(result.relationship.moodValence, 30);
    assert.equal(result.relationship.trustScore, 40);
    assert.equal(result.relationship.relationshipStage, 'acquaintance');
    assert.deepEqual(result.relationship.unlockedStages, ['stranger', 'acquaintance']);
    assert.equal(result.relationship.currentMoodTag, '满心欢喜');
    assert.equal(result.relationship.innerMonologue, '主人竟然如此体贴，心跳得好快');

    // Sticker matched
    assert.ok(result.matchedSticker);
    assert.equal(result.matchedSticker.emotionTag, '害羞');
    assert.equal(result.matchedSticker.imageUrl, 'https://cdn.example.com/shy.png');
  });

  it('progresses stage to friend when bondScore crosses 250 and clamps at 1000', () => {
    repos.updateRelationship('u1', 'c1', {
      bondScore: 230,
      relationshipStage: 'acquaintance',
      unlockedStages: ['stranger', 'acquaintance'],
    });

    const reply1 =
      '<affect delta_bond="+30" mood="感动">彼此更近了一步</affect>能与主人结识真好。';
    const res1 = affectEngine.processReplyAffect('u1', 'c1', reply1);

    // 230 + 30 = 260 -> friend
    assert.equal(res1.relationship.bondScore, 260);
    assert.equal(res1.relationship.relationshipStage, 'friend');
    assert.deepEqual(res1.relationship.unlockedStages, [
      'stranger',
      'acquaintance',
      'friend',
    ]);

    // Test devotion threshold and upper clamp
    repos.updateRelationship('u1', 'c1', {
      bondScore: 950,
      relationshipStage: 'devoted',
      moodValence: 90,
      trustScore: 90,
    });

    const reply2 =
      '<affect delta_bond="+80" delta_mood="+30" delta_trust="+30">终极誓言</affect>永生永世。';
    const res2 = affectEngine.processReplyAffect('u1', 'c1', reply2);
    assert.equal(res2.relationship.bondScore, 1000); // Clamped at 1000
    assert.equal(res2.relationship.moodValence, 100); // Clamped at 100
    assert.equal(res2.relationship.trustScore, 100); // Clamped at 100
    assert.equal(res2.relationship.relationshipStage, 'devoted');
  });

  it('handles raw replies without <affect> tag gracefully', () => {
    const rawReply = '只是普通的一句话，没有任何情绪标签。';
    const res = affectEngine.processReplyAffect('u1', 'c1', rawReply);

    assert.equal(res.cleanContent, '只是普通的一句话，没有任何情绪标签。');
    assert.equal(res.affect, null);
    assert.equal(res.matchedSticker, null);
    assert.equal(res.relationship.bondScore, 0);
  });

  it('evaluates proactive impulse across sleep, sulk, disabled, and affectionate triggers', () => {
    const baseRel = repos.ensureRelationship('u1', 'c1');
    const normalBlock: ScheduleBlock = {
      id: 'b1',
      startMinute: 600,
      endMinute: 720,
      category: 'leisure',
      activity: '在庭院散步',
      location: '日式庭院',
      environment: '阳光正好',
      mood: '悠闲',
      proactiveHint: false,
      status: 'active',
    };

    // 1. Proactive disabled
    const disabledRel = { ...baseRel, proactiveEnabled: false };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(disabledRel, normalBlock), {
      shouldSend: false,
      reason: 'disabled',
    });

    // 2. Sleeping block without caffeine wake
    const sleepBlock: ScheduleBlock = { ...normalBlock, category: 'sleep' };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(baseRel, sleepBlock), {
      shouldSend: false,
      reason: 'sleeping',
    });

    // 3. Sleeping block with active caffeine wake
    const caffeineRel = {
      ...baseRel,
      caffeineWakeUntil: new Date(Date.now() + 3_600_000).toISOString(),
      proactiveHint: true,
      attachmentLevel: 70,
      moodValence: 30,
    };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(caffeineRel, sleepBlock), {
      shouldSend: true,
      reason: 'affectionate_share',
    });

    // 4. Sulking or angry (moodValence <= -35)
    const sulkingRel = { ...baseRel, moodValence: -40, proactiveHint: true };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(sulkingRel, normalBlock), {
      shouldSend: false,
      reason: 'sulking_or_angry',
    });

    // 5. Proactive hint in schedule
    const hintBlock: ScheduleBlock = { ...normalBlock, proactiveHint: true };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(baseRel, hintBlock), {
      shouldSend: true,
      reason: 'affectionate_share',
    });

    // 6. High attachment and positive mood trigger
    const affectionateRel = { ...baseRel, attachmentLevel: 65, moodValence: 25 };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(affectionateRel, normalBlock), {
      shouldSend: true,
      reason: 'affectionate_share',
    });

    // 7. Neutral default
    const neutralRel = { ...baseRel, attachmentLevel: 30, moodValence: 10 };
    assert.deepEqual(affectEngine.evaluateProactiveImpulse(neutralRel, normalBlock), {
      shouldSend: false,
      reason: 'busy_or_neutral',
    });
  });
});

describe('MemoryEngine', () => {
  let repos: Repositories;
  let memoryEngine: MemoryEngine;

  beforeEach(() => {
    const db = createDatabase(':memory:');
    repos = new Repositories(db);
    memoryEngine = new MemoryEngine(repos);

    repos.createUser({ id: 'u1', username: 'testuser', displayName: '测试用户' });
    repos.createCharacter({
      id: 'c1',
      creatorUserId: 'u1',
      name: '双炽',
    });
  });

  it('calculates Ebbinghaus exponential retention correctly', () => {
    // R = S * e^(-0.35 * days)
    const day0 = MemoryEngine.calculateRetention(5.0, 0);
    assert.equal(day0, 5.0);

    const day1 = MemoryEngine.calculateRetention(5.0, 1);
    assert.ok(Math.abs(day1 - 5.0 * Math.exp(-0.35)) < 1e-4);
    assert.ok(day1 > 3.0); // day 1 is still clearRecent

    const day3 = MemoryEngine.calculateRetention(5.0, 3);
    assert.ok(day3 < 3.0 && day3 >= 1.2); // day 3 becomes blurryOlder

    const day7 = MemoryEngine.calculateRetention(5.0, 7);
    assert.ok(day7 < 1.2); // day 7 is forgottenCount
  });

  it('calculates days between dateKeys in UTC', () => {
    assert.equal(MemoryEngine.daysBetween('2026-05-01', '2026-05-01'), 0);
    assert.equal(MemoryEngine.daysBetween('2026-05-01', '2026-05-08'), 7);
    assert.equal(MemoryEngine.daysBetween('2026-05-10', '2026-05-01'), 0); // clamped at 0
  });

  it('partitions active memories into clearRecent, blurryOlder, and forgottenCount while preserving imprints', () => {
    // Add memory imprints
    repos.addMemoryImprint({
      userId: 'u1',
      characterId: 'c1',
      category: 'promise',
      content: '答应主人无论去哪里都会同行',
      emotionalWeight: 10,
    });
    repos.addMemoryImprint({
      userId: 'u1',
      characterId: 'c1',
      category: 'milestone',
      content: '初次相遇于神社廊下',
      emotionalWeight: 9,
    });

    const currentDate = '2026-05-10';

    // 1. Fresh memory (today, days=0, salience=5 -> retention=5.0 >= 3.0)
    repos.addFadingMemory({
      userId: 'u1',
      characterId: 'c1',
      dateKey: '2026-05-10',
      summary: '早晨为主人的茶杯续上热茶',
      salienceScore: 5.0,
    });

    // 2. Mid-term memory (3 days ago, days=3, salience=5 -> retention=5*e^(-1.05)=1.74 -> blurry)
    repos.addFadingMemory({
      userId: 'u1',
      characterId: 'c1',
      dateKey: '2026-05-07',
      summary: '陪主人逛了附近的旧书店',
      salienceScore: 5.0,
    });

    // 3. Old low-salience memory (8 days ago, days=8, salience=4 -> retention=4*e^(-2.8)=0.24 -> forgotten)
    repos.addFadingMemory({
      userId: 'u1',
      characterId: 'c1',
      dateKey: '2026-05-02',
      summary: '闲聊今天天气不错',
      salienceScore: 4.0,
    });

    const active = memoryEngine.getActiveMemories('u1', 'c1', currentDate);

    assert.equal(active.imprints.length, 2);
    assert.equal(active.imprints[0].emotionalWeight, 10);
    assert.equal(active.imprints[0].category, 'promise');

    assert.equal(active.clearRecent.length, 1);
    assert.equal(active.clearRecent[0].summary, '早晨为主人的茶杯续上热茶');

    assert.equal(active.blurryOlder.length, 1);
    assert.equal(active.blurryOlder[0].summary, '陪主人逛了附近的旧书店');

    assert.equal(active.forgottenCount, 1);
  });

  it('records emotional peak imprint when deltaMood or deltaBond is salient', () => {
    // 1. High deltaMood (>= 25)
    const imp1 = memoryEngine.recordEmotionalPeakIfSalient(
      'u1',
      'c1',
      {
        deltaMood: 28,
        deltaBond: 10,
        deltaTrust: 5,
        moodTag: '感动落泪',
        innerMonologue: '从未有人对我如此真心',
      },
      '主人送了一支雕有白狐花纹的折扇',
    );
    assert.ok(imp1);
    assert.equal(imp1.category, 'emotional_peak');
    assert.equal(imp1.content, '主人送了一支雕有白狐花纹的折扇');
    assert.ok(imp1.emotionalWeight >= 6);

    // 2. High deltaBond (>= 15)
    const imp2 = memoryEngine.recordEmotionalPeakIfSalient(
      'u1',
      'c1',
      {
        deltaMood: 5,
        deltaBond: 20,
        deltaTrust: 10,
        moodTag: '深情',
        innerMonologue: '羁绊加深',
      },
      '彼此许下一同看樱花的约定',
    );
    assert.ok(imp2);
    assert.equal(imp2.content, '彼此许下一同看樱花的约定');

    // 3. Low delta values (< 25 and < 15)
    const imp3 = memoryEngine.recordEmotionalPeakIfSalient(
      'u1',
      'c1',
      {
        deltaMood: 10,
        deltaBond: 8,
        deltaTrust: 2,
        moodTag: '微笑',
        innerMonologue: '平常互动',
      },
      '日常闲聊',
    );
    assert.equal(imp3, null);
  });
});

describe('ContextBuilder', () => {
  const dummyChar: Character = {
    id: 'c1',
    creatorUserId: 'u1',
    visibility: 'private',
    name: '双炽',
    description: '忠心不二的九尾狐侍从',
    avatarUrl: 'https://cdn.example.com/avatar.jpg',
    referenceImageDataUrl: 'data:image/png;base64,ref',
    corePersona: '温柔谦逊，对主人有着近乎执念的忠诚。',
    speechStyle: '恭敬有礼，语气细腻体贴，称呼对方为主人。',
    lifestyleProfile: {
      homeLocation: '日式庭院宅邸',
      defaultEnvironment: '清幽木质和室',
      usualPlaces: ['茶室', '书房'],
      dailyBaseline: '每日为主人点茶熏香',
      defaultOutfit: '一袭墨黑羽织',
      defaultCarriedItems: ['折扇'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const dummyRel: CharacterRelationship = {
    id: 'r1',
    userId: 'u1',
    characterId: 'c1',
    currentLocation: '日式宅邸客厅',
    currentSceneDesc: '午后暖阳透过纸窗，空气中有淡淡的白檀香',
    currentActivity: '整理茶具',
    outfitDesc: '素黑羽织与雪白足袋',
    currentMoodTag: '温和惬意',
    innerMonologue: '若能一直这样伴在主人身侧便好',
    relationshipStage: 'friend',
    bondScore: 320,
    trustScore: 85,
    moodValence: 35,
    attachmentLevel: 60,
    unlockedStages: ['stranger', 'acquaintance', 'friend'],
    proactiveEnabled: true,
    caffeineWakeUntil: null,
    updatedAt: '2026-05-10T14:00:00.000Z',
  };

  const dummyBlock: ScheduleBlock = {
    id: 'block-01',
    startMinute: 840, // 14:00
    endMinute: 960,   // 16:00
    category: 'leisure',
    activity: '午后茶歇并整理茶具',
    location: '宅邸客厅',
    environment: '暖阳透过纸窗，白檀香微熏',
    mood: '惬意',
    proactiveHint: true,
    status: 'active',
  };

  const dummyInventory = {
    equipped: [
      {
        id: 'i1',
        userId: 'u1',
        characterId: 'c1',
        scope: 'character_equipped' as const,
        locationTag: '身上',
        name: '墨黑羽织',
        quantity: 1,
        unit: '件',
        description: '正统黑色羽织和服',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    ],
    held: [
      {
        id: 'i2',
        userId: 'u1',
        characterId: 'c1',
        scope: 'character_held' as const,
        locationTag: '手中',
        name: '青瓷茶杯',
        quantity: 1,
        unit: '只',
        description: '温热的抹茶杯',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    ],
    carried: [
      {
        id: 'i3',
        userId: 'u1',
        characterId: 'c1',
        scope: 'character_carried' as const,
        locationTag: '袖袋',
        name: '白狐折扇',
        quantity: 1,
        unit: '把',
        description: '随身折扇',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        id: 'i4',
        userId: 'u1',
        characterId: 'c1',
        scope: 'character_carried' as const,
        locationTag: '袖袋',
        name: '怀表',
        quantity: 1,
        unit: '块',
        description: '银色机械怀表',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    ],
    environmentItems: [
      {
        id: 'i5',
        userId: 'u1',
        characterId: 'c1',
        scope: 'shared_home' as const,
        locationTag: '冰箱',
        name: '鲜牛奶',
        quantity: 2,
        unit: '瓶',
        description: '新鲜牛奶',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        id: 'i6',
        userId: 'u1',
        characterId: 'c1',
        scope: 'shared_home' as const,
        locationTag: '茶几',
        name: '和果子',
        quantity: 3,
        unit: '枚',
        description: '樱花风味点心',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    ],
  };

  const dummyMemories = {
    imprints: [
      {
        id: 'imp1',
        userId: 'u1',
        characterId: 'c1',
        category: 'promise' as const,
        content: '答应主人无论去何处都会同行',
        emotionalWeight: 10,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    clearRecent: [
      {
        id: 'fm1',
        userId: 'u1',
        characterId: 'c1',
        dateKey: '2026-05-10',
        summary: '早晨为主人擦拭了书桌',
        salienceScore: 5.0,
        createdAt: '2026-05-10T00:00:00.000Z',
      },
    ],
    blurryOlder: [
      {
        id: 'fm2',
        userId: 'u1',
        characterId: 'c1',
        dateKey: '2026-05-06',
        summary: '一同在雨天避雨',
        salienceScore: 3.0,
        createdAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  };

  const dummyMessages: ChatMessage[] = [
    {
      id: 'm1',
      userId: 'u1',
      characterId: 'c1',
      role: 'user',
      content: '双炽，你在忙什么呢？手里拿着什么？',
      sourceClient: 'app',
      createdAt: '2026-05-10T14:05:00.000Z',
    },
  ];

  it('builds 3-tier messages with invariant L0, perception L1/L2, and preserves inventory items', () => {
    const messages = ContextBuilder.buildMessages({
      character: dummyChar,
      relationship: dummyRel,
      currentDateKey: '2026-05-10',
      currentMinute: 850, // 14:10
      currentBlock: dummyBlock,
      visibleInventory: dummyInventory,
      activeMemories: dummyMemories,
      recentMessages: dummyMessages,
      availableStickerEmotions: ['害羞', '微笑', '行礼'],
    });

    // 1. Array structure: [L0_System, L1L2_System, UserMessage]
    assert.equal(messages.length, 3);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'system');
    assert.equal(messages[2].role, 'user');

    // 2. L0 Static Soul Check
    const l0 = messages[0].content;
    assert.ok(l0.includes('<character_soul>'));
    assert.ok(l0.includes('角色名称: 双炽'));
    assert.ok(l0.includes('忠心不二的九尾狐侍从'));
    assert.ok(l0.includes('说话风格与人设语气: 恭敬有礼'));
    assert.ok(l0.includes('<affect delta_mood='));
    // L0 must NOT leak dynamic fields
    assert.ok(!l0.includes('2026-05-10'));
    assert.ok(!l0.includes('青瓷茶杯'));
    assert.ok(!l0.includes('冰箱'));

    // 3. L1/L2 Dynamic Prompt Check
    const l1l2 = messages[1].content;
    assert.ok(l1l2.includes('<relationship_and_memory>'));
    assert.ok(l1l2.includes('当前关系阶段: friend'));
    assert.ok(l1l2.includes('羁绊深度: 320 / 1000'));
    assert.ok(l1l2.includes('答应主人无论去何处都会同行'));
    assert.ok(l1l2.includes('早晨为主人擦拭了书桌'));
    assert.ok(l1l2.includes('一同在雨天避雨'));

    assert.ok(l1l2.includes('<current_perception>'));
    assert.ok(l1l2.includes('2026-05-10 14:10'));
    assert.ok(l1l2.includes('日式宅邸客厅'));
    assert.ok(l1l2.includes('14:00-16:00 午后茶歇并整理茶具'));
    assert.ok(l1l2.includes('素黑羽织与雪白足袋'));
    assert.ok(l1l2.includes('青瓷茶杯(1只)')); // Held item
    assert.ok(l1l2.includes('白狐折扇(1把)')); // Carried item
    assert.ok(l1l2.includes('怀表(1块)'));     // Carried item
    assert.ok(l1l2.includes('冰箱: 鲜牛奶(2瓶)')); // Environment fridge item
    assert.ok(l1l2.includes('茶几: 和果子(3枚)'));
    assert.ok(l1l2.includes('害羞、微笑、行礼')); // Stickers

    // 4. Positive guidance check
    assert.ok(
      l1l2.includes(
        '以上是你此刻身处的真实环境与随身/手边物品，在对话中可自然使用这些物品、结合当下正在做的事与心情互动。',
      ),
    );

    // 5. CRITICAL: ZERO negative prohibitions
    const negativeProhibitions = [
      '不要凭空增加',
      '不要凭空改变',
      '严禁改变',
      '严禁凭空',
      '禁止擅自',
      '绝对不可更改',
    ];
    for (const neg of negativeProhibitions) {
      assert.ok(
        !l0.includes(neg),
        `L0 prompt must not contain negative prohibition: "${neg}"`,
      );
      assert.ok(
        !l1l2.includes(neg),
        `L1/L2 prompt must not contain negative prohibition: "${neg}"`,
      );
    }

    // 6. Dialogue history check
    assert.equal(
      messages[2].content,
      '双炽，你在忙什么呢？手里拿着什么？',
    );
  });
});
