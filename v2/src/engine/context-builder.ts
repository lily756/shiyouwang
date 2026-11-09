/**
 * Character OS v2 — 3-Tier Context Builder
 * 三层自然衰减上下文组装器：
 * - L0: 静态灵魂层 (纯静态不可变，前置命中 DeepSeek 硬盘前缀缓存)
 * - L1: 深刻印记与艾宾浩斯自然衰减记忆层
 * - L2: 紧凑对话窗 + 正向第一人称感官快照 (<current_perception>)
 */

import type {
  Character,
  CharacterRelationship,
  ChatMessage,
  FadingMemory,
  InventoryItem,
  LLMChatMessage,
  MemoryImprint,
  ScheduleBlock,
} from '../shared/types.ts';
import { formatMinuteToTime } from '../shared/schemas.ts';
import fs from 'node:fs';

export interface BuildContextParams {
  character: Character;
  relationship: CharacterRelationship;
  currentDateKey: string;
  currentMinute: number;
  currentBlock: ScheduleBlock;
  visibleInventory: {
    equipped: InventoryItem[];
    held: InventoryItem[];
    carried: InventoryItem[];
    environmentItems: InventoryItem[];
  };
  activeMemories: {
    imprints: MemoryImprint[];
    clearRecent: FadingMemory[];
    blurryOlder: FadingMemory[];
  };
  recentMessages: ChatMessage[];
  availableStickerEmotions?: string[];
}

export class ContextBuilder {
  /**
   * 组装用于大模型对话的 LLMChatMessage 列表，严格保证 messages[0] 为 L0 静态前缀
   */
  public static buildMessages(params: BuildContextParams): LLMChatMessage[] {
    const {
      character,
      relationship,
      currentDateKey,
      currentMinute,
      currentBlock,
      visibleInventory,
      activeMemories,
      recentMessages,
      availableStickerEmotions,
    } = params;

    // 1. L0 静态灵魂层（严格保证同一角色永远保持完全一致的静态文本，以命中大模型前缀缓存）
    const l0Parts: string[] = [
      fs.readFileSync(new URL('../shared/character_soul_prefix.txt', import.meta.url), 'utf-8'),
      '<character_soul>',
      `角色名称: ${character.name}`,
    ];
    if (character.description) {
      l0Parts.push(`设定描述: ${character.description}`);
    }
    l0Parts.push(
      `核心灵魂设定: ${character.corePersona}`,
      `说话风格与人设语气: ${character.speechStyle}`,
      '【内心OS与情绪突变反馈规范】',
      '在每一轮对话回复的最开头，若内心产生情感波动或真实内心OS，必须使用 <affect> 标签标明：',
      '<affect delta_mood="+10" delta_bond="+5" delta_trust="+2" mood="高兴" sticker="微笑">内心真实OS独白</affect>',
      '若当前心境平稳无明显突变，可省略 <affect> 标签直接输出干净正文回复。',
      '</character_soul>',
    );
    const l0StaticSoul = l0Parts.join('\n');

    // 2. L1 记忆层
    const imprintLines =
      activeMemories.imprints.length > 0
        ? activeMemories.imprints
            .map(
              (imp) =>
                `- [${imp.category}] ${imp.content} (情感权重: ${imp.emotionalWeight})`,
            )
            .join('\n')
        : '暂无重大印记';

    const recentMemoryLines =
      activeMemories.clearRecent.length > 0
        ? activeMemories.clearRecent
            .map((mem) => `- [${mem.dateKey}] ${mem.summary}`)
            .join('\n')
        : '暂无近期清晰记忆';

    const blurryMemoryLines =
      activeMemories.blurryOlder.length > 0
        ? activeMemories.blurryOlder
            .map((mem) => `- [${mem.dateKey}] ${mem.summary}`)
            .join('\n')
        : '无';

    const memorySection = [
      '<relationship_and_memory>',
      `当前关系阶段: ${relationship.relationshipStage}`,
      `羁绊深度: ${relationship.bondScore} / 1000`,
      `信任程度: ${relationship.trustScore} / 100`,
      '【深刻印记】',
      imprintLines,
      '【近期清晰记忆】',
      recentMemoryLines,
      '【有些模糊的早期印象——细节已淡忘，若用户提起可自然表示记不太清】',
      blurryMemoryLines,
      '</relationship_and_memory>',
    ].join('\n');

    // 3. L2 第一人称感官快照与正向感知引导
    const timeStr = `${currentDateKey} ${formatMinuteToTime(currentMinute)}`;
    const envDesc = currentBlock.environment || relationship.currentSceneDesc;
    const locationStr = `${relationship.currentLocation}${envDesc ? ` — ${envDesc}` : ''}`;
    const scheduleStr = `${formatMinuteToTime(currentBlock.startMinute)}-${formatMinuteToTime(currentBlock.endMinute)} ${currentBlock.activity}`;

    const outfitStr =
      relationship.outfitDesc ||
      (visibleInventory.equipped.length > 0
        ? visibleInventory.equipped.map((i) => i.name).join('、')
        : '日常便服');

    const heldStr =
      visibleInventory.held.length > 0
        ? visibleInventory.held
            .map((i) => `${i.name}(${i.quantity}${i.unit})`)
            .join('、')
        : '双手空着，可随时拿取身边物品';

    const carriedStr =
      visibleInventory.carried.length > 0
        ? visibleInventory.carried
            .map((i) => `${i.name}(${i.quantity}${i.unit})`)
            .join('、')
        : '无随身物品';

    const environmentItemsStr =
      visibleInventory.environmentItems.length > 0
        ? visibleInventory.environmentItems
            .map(
              (i) =>
                `${i.locationTag ? `${i.locationTag}: ` : ''}${i.name}(${i.quantity}${i.unit})`,
            )
            .join('；')
        : '无特别可用物品';

    const moodStr = `当前心境: ${relationship.currentMoodTag}${relationship.innerMonologue ? ` | 内心独白: ${relationship.innerMonologue}` : ''}`;

    const stickerStr =
      availableStickerEmotions && availableStickerEmotions.length > 0
        ? `可发送的表情包情绪标签: ${availableStickerEmotions.join('、')}`
        : '';

    const perceptionSection = [
      '<current_perception>',
      `当前时间: ${timeStr}`,
      `所在位置与环境: ${locationStr}`,
      `当前日程活动: ${scheduleStr}`,
      `当前穿着: ${outfitStr}`,
      `当前手持物品: ${heldStr}`,
      `随身携带物品: ${carriedStr}`,
      `当前场景/家里可用物品: ${environmentItemsStr}`,
      moodStr,
      stickerStr,
      '以上是你此刻身处的真实环境与随身/手边物品，在对话中可自然使用这些物品、结合当下正在做的事与心情互动。',
      '</current_perception>',
    ]
      .filter(Boolean)
      .join('\n');

    const dynamicSystemMessageContent = `${memorySection}\n\n${perceptionSection}`;

    // 4. 历史对话窗映射
    const historyMessages: LLMChatMessage[] = recentMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    return [
      { role: 'system', content: l0StaticSoul },
      { role: 'system', content: dynamicSystemMessageContent },
      ...historyMessages,
    ];
  }

  public buildMessages(params: BuildContextParams): LLMChatMessage[] {
    return ContextBuilder.buildMessages(params);
  }
}
