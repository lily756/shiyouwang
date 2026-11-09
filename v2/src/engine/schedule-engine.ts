/**
 * Character OS v2 — Reactive Schedule Engine
 * 弹性生活日程生成、间隙与未闭合自愈、状态刷新与对话驱动动态重排
 */

import { randomUUID } from 'node:crypto';
import type {
  Character,
  DailySchedule,
  LLMProvider,
  RawScheduleBlockCandidate,
  ScheduleBlock,
  ScheduleBlockStatus,
  ScheduleCategory,
} from '../shared/types.ts';
import {
  normalizeScheduleCategory,
  parseTimeToMinute,
  safeParseJson,
} from '../shared/schemas.ts';
import type { Repositories } from '../db/repositories.ts';

export class ScheduleEngine {
  private readonly repos: Repositories;
  private readonly llm: LLMProvider;

  constructor(repos: Repositories, llm: LLMProvider) {
    this.repos = repos;
    this.llm = llm;
  }

  /**
   * 核心自愈算法：首尾补齐 00:00~24:00，间隙自愈，绝不丢弃有效日程
   */
  public normalizeAndHealBlocks(
    rawBlocks: RawScheduleBlockCandidate[],
    character: Character,
  ): ScheduleBlock[] {
    const valid: ScheduleBlock[] = [];

    for (const raw of rawBlocks) {
      const start = parseTimeToMinute(raw.startMinute ?? raw.start, false);
      const end = parseTimeToMinute(raw.endMinute ?? raw.end, true);
      if (start == null || end == null || end <= start) continue;

      valid.push({
        id: raw.id || randomUUID(),
        startMinute: start,
        endMinute: end,
        category: normalizeScheduleCategory(raw.category),
        activity: String(raw.activity || '自由活动'),
        location: String(raw.location || character.lifestyleProfile.homeLocation || '家中'),
        environment: String(raw.environment || character.lifestyleProfile.defaultEnvironment || '室内'),
        mood: String(raw.mood || '平静'),
        proactiveHint: Boolean(raw.proactiveHint),
        status: (raw.status || 'planned') as ScheduleBlockStatus,
      });
    }

    valid.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

    const healed: ScheduleBlock[] = [];
    let cursor = 0;

    for (const block of valid) {
      if (cursor >= 1440) break;

      if (block.startMinute > cursor) {
        if (cursor === 0 && block.startMinute <= 600) {
          healed.push({
            id: randomUUID(),
            startMinute: 0,
            endMinute: block.startMinute,
            category: 'sleep',
            activity: '夜间熟睡',
            location: character.lifestyleProfile.homeLocation || '家中',
            environment: character.lifestyleProfile.defaultEnvironment || '安静的卧室',
            mood: '熟睡',
            proactiveHint: false,
            status: 'planned',
          });
        } else {
          const prev = healed[healed.length - 1];
          healed.push({
            id: randomUUID(),
            startMinute: cursor,
            endMinute: block.startMinute,
            category: 'leisure',
            activity: cursor === 0 ? '在家自由休息' : '自由休息与放松',
            location: prev?.location || character.lifestyleProfile.homeLocation || '家中',
            environment: prev?.environment || character.lifestyleProfile.defaultEnvironment || '室内',
            mood: '轻松',
            proactiveHint: false,
            status: 'planned',
          });
        }
        cursor = block.startMinute;
      }

      const effectiveStart = Math.max(cursor, block.startMinute);
      if (block.endMinute <= effectiveStart) {
        continue;
      }

      healed.push({
        ...block,
        startMinute: effectiveStart,
        endMinute: Math.min(1440, block.endMinute),
      });
      cursor = Math.min(1440, block.endMinute);
    }

    if (cursor < 1440) {
      const last = healed[healed.length - 1];
      if (last && last.category === 'sleep') {
        last.endMinute = 1440;
      } else {
        healed.push({
          id: randomUUID(),
          startMinute: cursor,
          endMinute: 1440,
          category: 'sleep',
          activity: '洗漱并进入夜间睡眠',
          location: character.lifestyleProfile.homeLocation || '家中',
          environment: character.lifestyleProfile.defaultEnvironment || '安静的卧室',
          mood: '安稳入眠',
          proactiveHint: false,
          status: 'planned',
        });
      }
    }

    return healed;
  }

  /**
   * 确保当日日程存在并按当前分钟数刷新时段状态
   */
  public async ensureDailySchedule(
    userId: string,
    characterId: string,
    dateKey: string,
    currentMinute = 480,
  ): Promise<DailySchedule> {
    let schedule = this.repos.getDailySchedule(userId, characterId, dateKey);
    const character = this.repos.getCharacterById(characterId);
    if (!character) {
      throw new Error(`Character not found: ${characterId}`);
    }

    this.repos.ensureRelationship(userId, characterId, character);

    if (schedule) {
      for (const b of schedule.blocks) {
        if (b.status === 'rescheduled') continue;
        b.status = b.endMinute <= currentMinute ? 'completed' : b.startMinute <= currentMinute ? 'active' : 'planned';
      }
      this.repos.upsertDailySchedule(schedule);
      const curr = this.getCurrentBlock(schedule, currentMinute);
      this.repos.updateRelationship(userId, characterId, {
        currentLocation: curr.location,
        currentSceneDesc: curr.environment,
        currentActivity: curr.activity,
      });
      return schedule;
    }

    // 查阅前一日日记作为上下文参考
    const prevDate = new Date(`${dateKey}T00:00:00Z`);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevDateKey = prevDate.toISOString().slice(0, 10);
    const yesterdayDiary = this.repos.getCharacterDiary(userId, characterId, prevDateKey);

    const prompt = `你是角色【${character.name}】的生活节奏编排引擎。
角色核心人设: ${character.corePersona}
日常生活基调: ${character.lifestyleProfile.dailyBaseline}
家所在位置: ${character.lifestyleProfile.homeLocation}
常去地点: ${character.lifestyleProfile.usualPlaces.join(', ')}
${yesterdayDiary ? `角色昨晚日记总结: ${yesterdayDiary.moodSummary}，内容: ${yesterdayDiary.content}` : ''}

请为角色生成今日(${dateKey})的专属生活日程（6~10个时段），必须返回合法纯JSON对象格式：
{
  "blocks": [
    {
      "start": "08:00",
      "end": "09:00",
      "category": "meal",
      "activity": "做早餐与用餐",
      "location": "${character.lifestyleProfile.homeLocation}",
      "environment": "${character.lifestyleProfile.defaultEnvironment}",
      "mood": "宁静",
      "proactiveHint": false
    }
  ]
}`;

    let rawBlocks: RawScheduleBlockCandidate[] = [];
    let isFallback = false;

    try {
      const resp = await this.llm.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });
      const parsed = safeParseJson<{ blocks?: RawScheduleBlockCandidate[] } | RawScheduleBlockCandidate[]>(resp.content);
      if (Array.isArray(parsed)) {
        rawBlocks = parsed;
      } else if (parsed && Array.isArray(parsed.blocks)) {
        rawBlocks = parsed.blocks;
      }
    } catch {
      // 容错走 fallback
    }

    if (!rawBlocks || rawBlocks.length === 0) {
      isFallback = true;
      rawBlocks = this.buildCharacterFallbackBlocks(character);
    }

    const healed = this.normalizeAndHealBlocks(rawBlocks, character);
    for (const b of healed) {
      b.status = b.endMinute <= currentMinute ? 'completed' : b.startMinute <= currentMinute ? 'active' : 'planned';
    }

    schedule = this.repos.upsertDailySchedule({
      userId,
      characterId,
      dateKey,
      timezone: 'Asia/Shanghai',
      source: isFallback ? 'fallback' : 'model',
      blocks: healed,
    });

    const curr = this.getCurrentBlock(schedule, currentMinute);
    this.repos.updateRelationship(userId, characterId, {
      currentLocation: curr.location,
      currentSceneDesc: curr.environment,
      currentActivity: curr.activity,
    });

    return schedule;
  }

  /**
   * 获取指定分钟对应的日程块
   */
  public getCurrentBlock(schedule: DailySchedule, minuteOfDay: number): ScheduleBlock {
    const clamped = Math.max(0, Math.min(1440, minuteOfDay));
    const match = schedule.blocks.find(
      (b) => b.startMinute <= clamped && (clamped < b.endMinute || (clamped === 1440 && b.endMinute === 1440)),
    );
    if (match) return match;
    return schedule.blocks[schedule.blocks.length - 1];
  }

  /**
   * 对话触发动态重排：保留已过去时段，截断当前时段，重排并补齐后续时段
   */
  public rescheduleFromDialogue(
    userId: string,
    characterId: string,
    dateKey: string,
    currentMinute: number,
    newBlocksRaw: RawScheduleBlockCandidate[],
  ): DailySchedule {
    const character = this.repos.getCharacterById(characterId);
    if (!character) {
      throw new Error(`Character not found: ${characterId}`);
    }

    let existing = this.repos.getDailySchedule(userId, characterId, dateKey);
    if (!existing) {
      const fallbackBlocks = this.buildCharacterFallbackBlocks(character);
      const healed = this.normalizeAndHealBlocks(fallbackBlocks, character);
      existing = this.repos.upsertDailySchedule({
        userId,
        characterId,
        dateKey,
        timezone: 'Asia/Shanghai',
        source: 'fallback',
        blocks: healed,
      });
    }

    const preserved: ScheduleBlock[] = [];
    for (const b of existing.blocks) {
      if (b.endMinute <= currentMinute) {
        preserved.push({ ...b, status: 'completed' });
      } else if (b.startMinute < currentMinute && b.endMinute > currentMinute) {
        preserved.push({ ...b, endMinute: currentMinute, status: 'completed' });
      }
    }

    const futureCandidates: RawScheduleBlockCandidate[] = [];
    for (const raw of newBlocksRaw) {
      const start = parseTimeToMinute(raw.startMinute ?? raw.start, false);
      const end = parseTimeToMinute(raw.endMinute ?? raw.end, true);
      if (start == null || end == null || end <= currentMinute) continue;
      const clampedStart = Math.max(currentMinute, start);
      if (end <= clampedStart) continue;

      futureCandidates.push({
        ...raw,
        id: raw.id || randomUUID(),
        startMinute: clampedStart,
        endMinute: end,
        status: currentMinute >= clampedStart && currentMinute < end ? 'active' : 'rescheduled',
      });
    }

    const combined: RawScheduleBlockCandidate[] = [...preserved, ...futureCandidates];
    const healed = this.normalizeAndHealBlocks(combined, character);

    for (const b of healed) {
      if (b.endMinute <= currentMinute) {
        b.status = 'completed';
      } else if (b.startMinute <= currentMinute && currentMinute < b.endMinute) {
        b.status = 'active';
      } else if (b.status !== 'rescheduled') {
        b.status = 'planned';
      }
    }

    const updated = this.repos.upsertDailySchedule({
      id: existing.id,
      userId,
      characterId,
      dateKey,
      timezone: existing.timezone,
      source: 'repaired',
      blocks: healed,
    });

    const curr = this.getCurrentBlock(updated, currentMinute);
    this.repos.updateRelationship(userId, characterId, {
      currentLocation: curr.location,
      currentSceneDesc: curr.environment,
      currentActivity: curr.activity,
    });

    return updated;
  }

  private buildCharacterFallbackBlocks(character: Character): RawScheduleBlockCandidate[] {
    const home = character.lifestyleProfile.homeLocation || '家中';
    const env = character.lifestyleProfile.defaultEnvironment || '安静的室内';
    const place1 = character.lifestyleProfile.usualPlaces[0] || home;
    const place2 = character.lifestyleProfile.usualPlaces[1] || home;
    const baseline = character.lifestyleProfile.dailyBaseline || '日常生活';

    return [
      { start: '00:00', end: '08:00', category: 'sleep', activity: '夜间熟睡', location: home, environment: env, mood: '熟睡', proactiveHint: false },
      { start: '08:00', end: '09:00', category: 'meal', activity: '早餐与晨间整理', location: home, environment: env, mood: '清爽', proactiveHint: false },
      { start: '09:00', end: '12:00', category: 'routine', activity: baseline, location: place1, environment: env, mood: '专注', proactiveHint: false },
      { start: '12:00', end: '13:00', category: 'meal', activity: '午餐与片刻休息', location: home, environment: env, mood: '轻松', proactiveHint: false },
      { start: '13:00', end: '18:00', category: 'routine', activity: `${baseline}（午后）`, location: place2, environment: env, mood: '沉浸', proactiveHint: true },
      { start: '18:00', end: '19:30', category: 'meal', activity: '晚餐时光', location: home, environment: env, mood: '惬意', proactiveHint: false },
      { start: '19:30', end: '22:30', category: 'leisure', activity: '自由夜生活与品茶', location: home, environment: env, mood: '放松', proactiveHint: true },
      { start: '22:30', end: '24:00', category: 'sleep', activity: '洗漱与准备入眠', location: home, environment: env, mood: '安稳', proactiveHint: false },
    ];
  }
}
