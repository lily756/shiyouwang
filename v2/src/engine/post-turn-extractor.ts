/**
 * Character OS v2 — Post-Turn State Extractor
 * 回合后置异步状态提取器：根据当轮对话提取衣着、地点、物品增减、日程变更与深刻约定
 */

import type {
  Character,
  LLMProvider,
  MemoryImprintCategory,
  RawScheduleBlockCandidate,
} from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';
import type { ScheduleEngine } from './schedule-engine.ts';
import type { InventoryEngine, InventoryMutation } from './inventory-engine.ts';
import type { MemoryEngine } from './memory-engine.ts';
import { safeParseJson } from '../shared/schemas.ts';

export interface PostTurnExtractionPayload {
  locationChange?: {
    location?: string;
    sceneDesc?: string;
    activity?: string;
  } | null;
  inventoryMutations?: InventoryMutation[];
  scheduleUpdates?: RawScheduleBlockCandidate[];
  fadingMemory?: {
    summary?: string;
    salienceScore?: number;
  } | null;
  imprint?: {
    category?: MemoryImprintCategory;
    content?: string;
    emotionalWeight?: number;
  } | null;
}

export class PostTurnExtractor {
  private readonly repos: Repositories;
  private readonly scheduleEngine: ScheduleEngine;
  private readonly inventoryEngine: InventoryEngine;
  private readonly memoryEngine: MemoryEngine;
  private readonly extractorLlm: LLMProvider;

  constructor(
    repos: Repositories,
    scheduleEngine: ScheduleEngine,
    inventoryEngine: InventoryEngine,
    memoryEngine: MemoryEngine,
    extractorLlm: LLMProvider,
  ) {
    this.repos = repos;
    this.scheduleEngine = scheduleEngine;
    this.inventoryEngine = inventoryEngine;
    this.memoryEngine = memoryEngine;
    this.extractorLlm = extractorLlm;
  }

  /**
   * 从当轮回合对话中提取实体与状态变更，并更新数据库
   */
  public async extractAndSync(params: {
    userId: string;
    character: Character;
    dateKey: string;
    currentMinute: number;
    userMessage: string;
    assistantReply: string;
  }): Promise<{
    inventoryMutated: boolean;
    scheduleRescheduled: boolean;
    memoryAdded: boolean;
  }> {
    const prompt = `你是角色【${params.character.name}】的对话状态提取分析器。
请分析以下本轮对话，提取出可能存在的：地点变化、穿着换装、物品拿取/消耗/放入背包/新增库存、日程变动约定、重要约定印记与日常记忆小结。

[用户输入]: ${params.userMessage}
[角色回复]: ${params.assistantReply}

必须返回合法纯JSON对象格式（若无对应变更则填 null 或空数组 []）：
{
  "locationChange": { "location": "地点名", "sceneDesc": "场景环境", "activity": "当前活动" },
  "inventoryMutations": [
    { "action": "set_outfit|hold|put_in_bag|consume_or_remove|add_home_item", "name": "物品名", "quantity": 1, "unit": "个|瓶|件|套", "locationTag": "位置标签" }
  ],
  "scheduleUpdates": [
    { "start": "HH:MM", "end": "HH:MM", "category": "leisure|work|meal|social", "activity": "活动", "location": "地点", "environment": "环境", "mood": "心情", "proactiveHint": false }
  ],
  "fadingMemory": { "summary": "今日闲聊小结", "salienceScore": 5 },
  "imprint": { "category": "promise|user_fact|milestone", "content": "重要承诺或事实", "emotionalWeight": 8 }
}`;

    let parsed: PostTurnExtractionPayload | null = null;
    try {
      const resp = await this.extractorLlm.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });
      parsed = safeParseJson<PostTurnExtractionPayload>(resp.content);
    } catch {
      // 容错返回
    }

    if (!parsed) {
      return { inventoryMutated: false, scheduleRescheduled: false, memoryAdded: false };
    }

    let inventoryMutated = false;
    let scheduleRescheduled = false;
    let memoryAdded = false;

    // 1. 地点与空间快照更新
    if (parsed.locationChange?.location) {
      this.repos.updateRelationship(params.userId, params.character.id, {
        currentLocation: parsed.locationChange.location,
        ...(parsed.locationChange.sceneDesc ? { currentSceneDesc: parsed.locationChange.sceneDesc } : {}),
        ...(parsed.locationChange.activity ? { currentActivity: parsed.locationChange.activity } : {}),
      });
    }

    // 2. 物品变动
    if (Array.isArray(parsed.inventoryMutations) && parsed.inventoryMutations.length > 0) {
      this.inventoryEngine.applyInventoryMutations(
        params.userId,
        params.character.id,
        parsed.inventoryMutations,
      );
      inventoryMutated = true;
    }

    // 3. 日程重排
    if (Array.isArray(parsed.scheduleUpdates) && parsed.scheduleUpdates.length > 0) {
      this.scheduleEngine.rescheduleFromDialogue(
        params.userId,
        params.character.id,
        params.dateKey,
        params.currentMinute,
        parsed.scheduleUpdates,
      );
      scheduleRescheduled = true;
    }

    // 4. 艾宾浩斯记忆与深刻印记沉淀
    if (parsed.fadingMemory?.summary && parsed.fadingMemory.summary.trim()) {
      this.repos.addFadingMemory({
        userId: params.userId,
        characterId: params.character.id,
        dateKey: params.dateKey,
        summary: parsed.fadingMemory.summary.trim(),
        salienceScore: parsed.fadingMemory.salienceScore ?? 5,
      });
      memoryAdded = true;
    }

    if (parsed.imprint?.content && parsed.imprint.content.trim()) {
      this.repos.addMemoryImprint({
        userId: params.userId,
        characterId: params.character.id,
        category: parsed.imprint.category || 'promise',
        content: parsed.imprint.content.trim(),
        emotionalWeight: parsed.imprint.emotionalWeight ?? 8,
      });
      memoryAdded = true;
    }

    return { inventoryMutated, scheduleRescheduled, memoryAdded };
  }
}
