/**
 * Character OS v2 — Tri-Layer Affect Engine
 * 三层情感计算引擎：Layer 1 即时推理突变、Layer 2 叙事心境独白、Layer 3 量化指标与阶段阈值解锁
 */

import type {
  AffectReaction,
  CharacterRelationship,
  RelationshipStage,
  ScheduleBlock,
  StickerRecord,
} from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';
import { clampNumber, extractAffectTagFromReply } from '../shared/schemas.ts';

export class AffectEngine {
  private readonly repos: Repositories;

  constructor(repos: Repositories) {
    this.repos = repos;
  }

  /**
   * 根据当前量化羁绊值 (bondScore: 0~1000) 映射关系发展阶段
   */
  public static resolveStageFromBond(bondScore: number): RelationshipStage {
    if (bondScore < 100) return 'stranger';
    if (bondScore < 250) return 'acquaintance';
    if (bondScore < 500) return 'friend';
    if (bondScore < 750) return 'ambiguous';
    if (bondScore < 920) return 'lover';
    return 'devoted';
  }

  /**
   * 解析模型回复开头的情感标签，执行三层情感更新与阶段解锁，匹配对应表情包
   */
  public processReplyAffect(
    userId: string,
    characterId: string,
    rawReply: string,
  ): {
    cleanContent: string;
    affect: AffectReaction | null;
    relationship: CharacterRelationship;
    matchedSticker: StickerRecord | null;
  } {
    const { cleanContent, affect } = extractAffectTagFromReply(rawReply);
    const rel = this.repos.ensureRelationship(userId, characterId);

    if (!affect) {
      return {
        cleanContent,
        affect: null,
        relationship: rel,
        matchedSticker: null,
      };
    }

    // 防御性校验：若 moodTag 因子串匹配取到了 delta_mood 的数值，则使用词边界匹配精确的 mood="..."
    const exactMoodMatch = /\bmood\s*=\s*["']([^"']*)["']/i.exec(rawReply);
    if (exactMoodMatch && exactMoodMatch[1].trim()) {
      affect.moodTag = exactMoodMatch[1].trim();
    }

    const moodValence = clampNumber(rel.moodValence + affect.deltaMood, -100, 100);
    const bondScore = clampNumber(rel.bondScore + affect.deltaBond, 0, 1000);
    const trustScore = clampNumber(rel.trustScore + affect.deltaTrust, 0, 100);
    const newStage = AffectEngine.resolveStageFromBond(bondScore);

    const unlockedStages = rel.unlockedStages.includes(newStage)
      ? rel.unlockedStages
      : [...rel.unlockedStages, newStage];

    const updatedRel = this.repos.updateRelationship(userId, characterId, {
      moodValence,
      bondScore,
      trustScore,
      relationshipStage: newStage,
      unlockedStages,
      currentMoodTag: affect.moodTag || rel.currentMoodTag,
      innerMonologue: affect.innerMonologue || rel.innerMonologue,
    });

    let matchedSticker: StickerRecord | null = null;
    if (affect.stickerEmotion && affect.stickerEmotion.trim().length > 0) {
      matchedSticker = this.repos.findStickerByEmotion(
        characterId,
        affect.stickerEmotion.trim(),
      );
    }

    return {
      cleanContent,
      affect,
      relationship: updatedRel ?? rel,
      matchedSticker,
    };
  }

  /**
   * 评估主动消息发起冲动（Proactive Impulse）
   */
  public evaluateProactiveImpulse(
    relationship: CharacterRelationship,
    currentBlock: ScheduleBlock,
  ): { shouldSend: boolean; reason: string } {
    if (!relationship.proactiveEnabled) {
      return { shouldSend: false, reason: 'disabled' };
    }

    if (currentBlock.category === 'sleep') {
      const isCaffeineActive =
        relationship.caffeineWakeUntil != null &&
        new Date(relationship.caffeineWakeUntil).getTime() > Date.now();
      if (!isCaffeineActive) {
        return { shouldSend: false, reason: 'sleeping' };
      }
    }

    if (relationship.moodValence <= -35) {
      return { shouldSend: false, reason: 'sulking_or_angry' };
    }

    if (
      currentBlock.proactiveHint ||
      (relationship.attachmentLevel >= 60 && relationship.moodValence >= 20)
    ) {
      return { shouldSend: true, reason: 'affectionate_share' };
    }

    return { shouldSend: false, reason: 'busy_or_neutral' };
  }
}
