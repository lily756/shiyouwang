/**
 * Character OS v2 — Salience-Decaying Memory Engine
 * 艾宾浩斯指数衰减记忆计算与高情感权重深刻印记管理
 */

import type {
  AffectReaction,
  FadingMemory,
  MemoryImprint,
} from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';

export class MemoryEngine {
  private readonly repos: Repositories;

  constructor(repos: Repositories) {
    this.repos = repos;
  }

  /**
   * 艾宾浩斯指数保留度公式: R = S * e^(-0.35 * days)
   */
  public static calculateRetention(
    salienceScore: number,
    daysElapsed: number,
  ): number {
    return salienceScore * Math.exp(-0.35 * Math.max(0, daysElapsed));
  }

  /**
   * 计算两个 YYYY-MM-DD 日期之间的天数差 (tB - tA)
   */
  public static daysBetween(dateKeyA: string, dateKeyB: string): number {
    const parse = (k: string): number => {
      const parts = k.split('-').map(Number);
      return Date.UTC(parts[0] || 2026, (parts[1] || 1) - 1, parts[2] || 1);
    };
    const tA = parse(dateKeyA);
    const tB = parse(dateKeyB);
    return Math.max(0, Math.round((tB - tA) / 86_400_000));
  }

  /**
   * 获取当前活跃记忆切片：深刻印记（前 12 条高权重）、清晰近期记忆与模糊早期印象
   */
  public getActiveMemories(
    userId: string,
    characterId: string,
    currentDateKey: string,
  ): {
    imprints: MemoryImprint[];
    clearRecent: FadingMemory[];
    blurryOlder: FadingMemory[];
    forgottenCount: number;
  } {
    const allImprints = this.repos.listMemoryImprints(userId, characterId);
    const imprints = [...allImprints]
      .sort((a, b) => b.emotionalWeight - a.emotionalWeight)
      .slice(0, 12);

    const fading = this.repos.listFadingMemories(userId, characterId);
    const clearRecent: FadingMemory[] = [];
    const blurryOlder: FadingMemory[] = [];
    let forgottenCount = 0;

    for (const mem of fading) {
      const days = MemoryEngine.daysBetween(mem.dateKey, currentDateKey);
      const retention = MemoryEngine.calculateRetention(mem.salienceScore, days);

      if (retention >= 3.0) {
        clearRecent.push(mem);
      } else if (retention >= 1.2) {
        blurryOlder.push(mem);
      } else {
        forgottenCount++;
      }
    }

    return { imprints, clearRecent, blurryOlder, forgottenCount };
  }

  /**
   * 当单次回合发生强烈情感起伏时，自动沉淀为高权重深刻印记 (MemoryImprint)
   */
  public recordEmotionalPeakIfSalient(
    userId: string,
    characterId: string,
    affect: AffectReaction | null,
    eventSummary: string,
  ): MemoryImprint | null {
    if (!affect) return null;

    const absMood = Math.abs(affect.deltaMood);
    const absBond = Math.abs(affect.deltaBond);

    if (absMood >= 25 || absBond >= 15) {
      const emotionalWeight = Math.min(
        10,
        Math.max(6, Math.round((absMood + absBond) / 6)),
      );
      return this.repos.addMemoryImprint({
        userId,
        characterId,
        category: 'emotional_peak',
        content: eventSummary || '重要情感波动时刻',
        emotionalWeight,
      });
    }

    return null;
  }
}
