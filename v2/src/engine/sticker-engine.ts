/**
 * Character OS v2 — Sticker Engine
 * 表情包识别引擎：入站哈希秒级缓存命中与多模态/大模型语义反查
 */

import type { LLMProvider, StickerRecord } from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';
import { safeParseJson } from '../shared/schemas.ts';

export class StickerEngine {
  private readonly repos: Repositories;
  private readonly visionLlm: LLMProvider;

  constructor(repos: Repositories, visionLlm: LLMProvider) {
    this.repos = repos;
    this.visionLlm = visionLlm;
  }

  /**
   * 识别入站表情包：优先根据文件哈希查本地数据库缓存，未命中则调用 LLM 分析并持久化
   */
  public async recognizeInboundSticker(params: {
    fileHash: string;
    imageUrl: string;
    characterId?: string | null;
  }): Promise<StickerRecord> {
    const cached = this.repos.getStickerByHash(params.fileHash);
    if (cached) {
      return cached;
    }

    const prompt = `请分析以下表情包图片链接，识别其主要情绪与梗/画面语义：
图片链接: ${params.imageUrl}

请直接输出合法的纯JSON对象格式：
{
  "emotionTag": "害羞|开心|生气|傲娇|困倦|吃醋|无奈|日常",
  "semanticMeaning": "一两句话概括画面内容与梗意图"
}`;

    let emotionTag = '日常';
    let semanticMeaning = '用户发送的表情包';

    try {
      const resp = await this.visionLlm.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });
      const parsed = safeParseJson<{ emotionTag?: string; semanticMeaning?: string }>(resp.content);
      if (parsed?.emotionTag) {
        emotionTag = parsed.emotionTag.trim();
      }
      if (parsed?.semanticMeaning) {
        semanticMeaning = parsed.semanticMeaning.trim();
      }
    } catch {
      // 容错兜底
    }

    return this.repos.upsertSticker({
      characterId: params.characterId ?? null,
      fileHash: params.fileHash,
      imageUrl: params.imageUrl,
      emotionTag,
      semanticMeaning,
    });
  }
}
