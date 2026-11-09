/**
 * Character OS v2 — Reactive Schedule Engine Unit Tests
 * 验证间隙自愈、首尾闭合、LLM 容错兜底与对话动态重排
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';
import { ScheduleEngine } from '../../src/engine/schedule-engine.ts';
import { MockLLMProvider } from '../../src/providers/llm.ts';
import type { Character } from '../../src/shared/types.ts';

describe('ScheduleEngine — normalizeAndHealBlocks (Self-Healing)', () => {
  const db = createDatabase();
  const repos = new Repositories(db);
  const mockLLM = new MockLLMProvider();
  const engine = new ScheduleEngine(repos, mockLLM);

  const mockCharacter: Character = {
    id: 'char_1',
    creatorUserId: 'user_1',
    visibility: 'public',
    name: '双炽',
    description: '',
    avatarUrl: '',
    referenceImageDataUrl: '',
    corePersona: '忠诚妖仆',
    speechStyle: '',
    lifestyleProfile: {
      homeLocation: '妖馆404室',
      defaultEnvironment: '和式茶室',
      usualPlaces: ['妖馆404室', '庭院'],
      dailyBaseline: '泡茶侍奉',
      defaultOutfit: '黑色西装',
      defaultCarriedItems: ['怀表'],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('heals leading gap, intermediate gaps, and extends sleep tail to 24:00 without discarding blocks', () => {
    // 模拟 LLM 仅返回零散时段：08:00~12:00, 13:00~18:00, 19:00~21:30 (sleep)
    const rawBlocks = [
      { start: '08:00', end: '12:00', category: 'work', activity: '整理古籍', location: '书房' },
      { start: '13:00', end: '18:00', category: 'routine', activity: '泡茶与侍奉', location: '妖馆茶室' },
      { start: '19:00', end: '21:30', category: 'sleep', activity: '提前就寝', location: '妖馆404室' },
    ];

    const healed = engine.normalizeAndHealBlocks(rawBlocks, mockCharacter);

    // 1. 验证首段从 00:00 开始
    assert.equal(healed[0].startMinute, 0);
    assert.equal(healed[0].endMinute, 480);
    assert.equal(healed[0].category, 'sleep');
    assert.equal(healed[0].activity, '夜间熟睡');

    // 2. 验证有效工作块保留
    assert.equal(healed[1].startMinute, 480);
    assert.equal(healed[1].endMinute, 720);
    assert.equal(healed[1].activity, '整理古籍');

    // 3. 验证中间 12:00~13:00 间隙被自愈为休息时段
    assert.equal(healed[2].startMinute, 720);
    assert.equal(healed[2].endMinute, 780);
    assert.equal(healed[2].category, 'leisure');

    // 4. 验证 13:00~18:00 日常时段保留
    assert.equal(healed[3].startMinute, 780);
    assert.equal(healed[3].endMinute, 1080);
    assert.equal(healed[3].activity, '泡茶与侍奉');

    // 5. 验证 18:00~19:00 间隙被自愈为休息时段
    assert.equal(healed[4].startMinute, 1080);
    assert.equal(healed[4].endMinute, 1140);
    assert.equal(healed[4].category, 'leisure');

    // 6. 验证末尾的睡眠时段从 19:00 (1140) 自动延伸闭合至 24:00 (1440)，而非丢弃
    assert.equal(healed[5].startMinute, 1140);
    assert.equal(healed[5].endMinute, 1440);
    assert.equal(healed[5].category, 'sleep');

    // 7. 验证全天无缝连续连接
    for (let i = 0; i < healed.length - 1; i++) {
      assert.equal(healed[i].endMinute, healed[i + 1].startMinute);
    }
    assert.equal(healed[healed.length - 1].endMinute, 1440);
  });

  it('clamps overlapping blocks seamlessly', () => {
    const rawBlocks = [
      { start: '08:00', end: '11:00', category: 'work', activity: '工作' },
      { start: '10:30', end: '12:00', category: 'leisure', activity: '早退休息' }, // 重叠 30 分钟
    ];
    const healed = engine.normalizeAndHealBlocks(rawBlocks, mockCharacter);

    const bWork = healed.find((b) => b.activity === '工作')!;
    const bRest = healed.find((b) => b.activity === '早退休息')!;
    assert.ok(bWork && bRest);
    assert.equal(bWork.startMinute, 480);
    assert.equal(bWork.endMinute, 660);
    // 重叠部分被平滑顺延
    assert.equal(bRest.startMinute, 660);
    assert.equal(bRest.endMinute, 720);
  });
});

describe('ScheduleEngine — ensureDailySchedule & Dynamic Rescheduling', () => {
  const db = createDatabase();
  const repos = new Repositories(db);
  const mockLLM = new MockLLMProvider();
  const engine = new ScheduleEngine(repos, mockLLM);

  const user = repos.createUser({ username: 'akira', displayName: 'Akira' });
  const character = repos.createCharacter({
    creatorUserId: user.id,
    name: '双炽',
    corePersona: '忠诚侍奉',
    lifestyleProfile: {
      homeLocation: '妖馆404室',
      defaultEnvironment: '和式茶室',
      usualPlaces: ['妖馆404室', '庭院'],
      dailyBaseline: '泡茶侍奉',
      defaultOutfit: '黑色西装',
      defaultCarriedItems: ['怀表'],
    },
  });

  it('generates daily schedule via LLM, heals it, and refreshes block statuses', async () => {
    mockLLM.enqueueResponse({
      content: JSON.stringify({
        blocks: [
          { start: '08:00', end: '09:00', category: 'meal', activity: '早餐', location: '妖馆404室' },
          { start: '09:00', end: '12:00', category: 'work', activity: '侍奉主人', location: '妖馆茶室' },
          { start: '12:00', end: '13:00', category: 'meal', activity: '午餐', location: '妖馆404室' },
          { start: '13:00', end: '18:00', category: 'routine', activity: '庭院修剪', location: '庭院' },
          { start: '18:00', end: '23:00', category: 'leisure', activity: '自由晚间时光', location: '妖馆404室' },
        ],
      }),
      toolCalls: [],
    });

    // 假设当前时间是上午 10:30 (630 分钟)
    const schedule = await engine.ensureDailySchedule(user.id, character.id, '2026-11-09', 630);
    assert.equal(schedule.source, 'model');

    // 验证状态分配：08:00~09:00 completed, 09:00~12:00 active, 12:00+ planned
    const b08 = schedule.blocks.find((b) => b.activity === '早餐')!;
    const b09 = schedule.blocks.find((b) => b.activity === '侍奉主人')!;
    const b12 = schedule.blocks.find((b) => b.activity === '午餐')!;

    assert.equal(b08.status, 'completed');
    assert.equal(b09.status, 'active');
    assert.equal(b12.status, 'planned');

    // 验证当前状态已同步到关系表
    const rel = repos.getRelationship(user.id, character.id);
    assert.equal(rel?.currentActivity, '侍奉主人');
    assert.equal(rel?.currentLocation, '妖馆茶室');

    // 二次调用命中已有日程，直接返回且不再消耗 LLM 队列
    const cached = await engine.ensureDailySchedule(user.id, character.id, '2026-11-09', 630);
    assert.equal(cached.id, schedule.id);
  });

  it('falls back to character profile baseline when LLM fails', async () => {
    mockLLM.setHandler(() => {
      throw new Error('LLM rate limit error');
    });

    const schedule = await engine.ensureDailySchedule(user.id, character.id, '2026-11-10', 480);
    assert.equal(schedule.source, 'fallback');
    assert.ok(schedule.blocks.length >= 6);
    assert.equal(schedule.blocks[0].startMinute, 0);
    assert.equal(schedule.blocks[schedule.blocks.length - 1].endMinute, 1440);
  });

  it('correctly reschedules future blocks while preserving past blocks when dialogue triggers schedule change', async () => {
    mockLLM.setHandler(null);
    mockLLM.enqueueResponse({
      content: JSON.stringify({
        blocks: [
          { start: '08:00', end: '10:00', category: 'work', activity: '上午整理', location: '书房' },
          { start: '10:00', end: '12:00', category: 'routine', activity: '原本的读书计划', location: '茶室' },
          { start: '13:00', end: '18:00', category: 'routine', activity: '原本的修剪花木', location: '庭院' },
        ],
      }),
      toolCalls: [],
    });

    // 初始状态：已过去 08:00~10:00，当前是 10:30 (630 分钟)
    await engine.ensureDailySchedule(user.id, character.id, '2026-11-11', 630);

    // 对话触发：在 10:30 用户提议“现在马上陪我去游乐园玩到下午16:00”
    const rescheduled = engine.rescheduleFromDialogue(user.id, character.id, '2026-11-11', 630, [
      { start: '10:30', end: '16:00', category: 'social', activity: '陪主人在游乐园玩耍', location: '欢乐游乐园', environment: '热闹的乐园' },
      { start: '16:00', end: '18:00', category: 'leisure', activity: '乐园甜品店休息', location: '甜品店', environment: '香甜温馨' },
    ]);

    assert.equal(rescheduled.source, 'repaired');

    // 1. 过去已完成的 08:00~10:00 必须完整保留
    const past08 = rescheduled.blocks.find((b) => b.activity === '上午整理')!;
    assert.ok(past08);
    assert.equal(past08.startMinute, 480);
    assert.equal(past08.endMinute, 600);
    assert.equal(past08.status, 'completed');

    // 2. 原本 10:00~12:00 的活动被精准截断在 10:30 (630) 并标记 completed
    const truncated = rescheduled.blocks.find((b) => b.activity === '原本的读书计划')!;
    assert.ok(truncated);
    assert.equal(truncated.startMinute, 600);
    assert.equal(truncated.endMinute, 630);
    assert.equal(truncated.status, 'completed');

    // 3. 从 10:30 (630) 开始执行新插入的游乐园日程
    const themePark = rescheduled.blocks.find((b) => b.activity === '陪主人在游乐园玩耍')!;
    assert.ok(themePark);
    assert.equal(themePark.startMinute, 630);
    assert.equal(themePark.endMinute, 960);
    assert.equal(themePark.status, 'active');

    // 4. 角色当前关系表中的位置与活动立即同步为游乐园
    const rel = repos.getRelationship(user.id, character.id);
    assert.equal(rel?.currentLocation, '欢乐游乐园');
    assert.equal(rel?.currentActivity, '陪主人在游乐园玩耍');
  });

  it('getCurrentBlock handles edge minutes accurately', () => {
    const schedule = repos.getDailySchedule(user.id, character.id, '2026-11-09')!;
    const first = engine.getCurrentBlock(schedule, 0);
    assert.equal(first.startMinute, 0);

    const endOfDay = engine.getCurrentBlock(schedule, 1440);
    assert.equal(endOfDay.endMinute, 1440);
  });
});
