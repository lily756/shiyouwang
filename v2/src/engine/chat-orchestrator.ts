/**
 * Character OS v2 — Chat Orchestrator
 * 主对话多模态编排器：串联 Context -> LLM/Tools -> Media -> Affect -> Extractor -> EventHub
 */

import type {
  AffectReaction, CharacterRelationship, ChatMessage, DailySchedule, LLMProvider,
  LLMToolDefinition, MediaProvider, MediaTaskKind, MediaTaskRecord, StickerRecord,
  SyncEvent, SyncEventType,
} from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';
import { ScheduleEngine } from './schedule-engine.ts';
import { InventoryEngine, type InventoryMutation } from './inventory-engine.ts';
import { AffectEngine } from './affect-engine.ts';
import { MemoryEngine } from './memory-engine.ts';
import { ContextBuilder } from './context-builder.ts';
import { StickerEngine } from './sticker-engine.ts';
import { PostTurnExtractor } from './post-turn-extractor.ts';
import { composeCharacterMediaPrompt } from '../providers/media.ts';
import { safeParseJson } from '../shared/schemas.ts';

export interface ChatOrchestratorDeps {
  repos: Repositories;
  dialogueLlm: LLMProvider;
  extractorLlm?: LLMProvider;
  mediaProvider: MediaProvider;
  onSyncEvent?: (event: SyncEvent) => void;
}

export interface HandleUserTurnInput {
  userId: string;
  characterId: string;
  text: string;
  sourceClient?: 'app' | 'web' | 'telegram';
  inboundSticker?: { fileHash: string; imageUrl: string };
  dateKey?: string;
  minuteOfDay?: number;
}

export interface HandleUserTurnResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  affect: AffectReaction | null;
  matchedSticker: StickerRecord | null;
  mediaTasks: MediaTaskRecord[];
  relationship: CharacterRelationship;
  schedule: DailySchedule;
}

const ORCHESTRATOR_TOOLS: LLMToolDefinition[] = [
  {
    name: 'generate_character_image',
    description: '生成角色的即时照片/自拍照或场景环境照片',
    parameters: {
      type: 'object',
      properties: {
        action_intent: { type: 'string', description: '画面核心意图' },
        include_self: { type: 'boolean', description: '是否包含角色本人' },
        reply_text: { type: 'string', description: '伴随生图回复文本' },
      },
      required: ['action_intent'],
    },
  },
  {
    name: 'generate_character_video',
    description: '生成角色的一段小视频',
    parameters: {
      type: 'object',
      properties: {
        action_intent: { type: 'string', description: '视频核心动态意图' },
        include_self: { type: 'boolean', description: '是否包含角色本人' },
        duration: { type: 'number', description: '时长秒数' },
        reply_text: { type: 'string', description: '伴随视频回复文本' },
      },
      required: ['action_intent'],
    },
  },
  {
    name: 'update_character_items',
    description: '显式更新角色穿戴、拿取、入包或消耗物品',
    parameters: {
      type: 'object',
      properties: {
        mutations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['set_outfit', 'hold', 'put_in_bag', 'consume_or_remove', 'add_home_item'] },
              name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' },
              locationTag: { type: 'string' }, description: { type: 'string' },
            },
            required: ['action', 'name'],
          },
        },
      },
      required: ['mutations'],
    },
  },
];

export class ChatOrchestrator {
  private readonly repos: Repositories;
  private readonly dialogueLlm: LLMProvider;
  private readonly extractorLlm?: LLMProvider;
  private readonly mediaProvider: MediaProvider;
  private readonly onSyncEvent?: (event: SyncEvent) => void;

  public readonly scheduleEngine: ScheduleEngine;
  public readonly inventoryEngine: InventoryEngine;
  public readonly affectEngine: AffectEngine;
  public readonly memoryEngine: MemoryEngine;
  public readonly contextBuilder: ContextBuilder;
  public readonly stickerEngine: StickerEngine;
  public readonly postTurnExtractor: PostTurnExtractor;

  constructor(deps: ChatOrchestratorDeps) {
    this.repos = deps.repos;
    this.dialogueLlm = deps.dialogueLlm;
    this.extractorLlm = deps.extractorLlm;
    this.mediaProvider = deps.mediaProvider;
    this.onSyncEvent = deps.onSyncEvent;

    this.scheduleEngine = new ScheduleEngine(this.repos, this.dialogueLlm);
    this.inventoryEngine = new InventoryEngine(this.repos);
    this.affectEngine = new AffectEngine(this.repos);
    this.memoryEngine = new MemoryEngine(this.repos);
    this.contextBuilder = new ContextBuilder();
    this.stickerEngine = new StickerEngine(this.repos, this.dialogueLlm);
    this.postTurnExtractor = new PostTurnExtractor(
      this.repos, this.scheduleEngine, this.inventoryEngine, this.memoryEngine,
      this.extractorLlm ?? this.dialogueLlm,
    );
  }

  public async handleUserTurn(input: HandleUserTurnInput): Promise<HandleUserTurnResult> {
    const character = this.repos.getCharacterById(input.characterId);
    if (!character) throw new Error(`Character not found: ${input.characterId}`);

    this.repos.ensureRelationship(input.userId, input.characterId, character);
    this.inventoryEngine.initializeDefaultInventory(input.userId, character);

    const dateKey = input.dateKey || new Date().toISOString().slice(0, 10);
    const minuteOfDay = input.minuteOfDay ?? 540;

    let schedule = await this.scheduleEngine.ensureDailySchedule(input.userId, input.characterId, dateKey, minuteOfDay);
    const currentBlock = this.scheduleEngine.getCurrentBlock(schedule, minuteOfDay);

    // 1. 入站表情包分析
    let effectiveText = input.text || '';
    let inboundSticker: StickerRecord | null = null;
    if (input.inboundSticker) {
      inboundSticker = await this.stickerEngine.recognizeInboundSticker({
        fileHash: input.inboundSticker.fileHash, imageUrl: input.inboundSticker.imageUrl, characterId: input.characterId,
      });
      effectiveText = `[用户发送了表情包（${inboundSticker.emotionTag}）：${inboundSticker.semanticMeaning}] ${effectiveText}`.trim();
    }

    // 2. 持久化并广播用户消息
    const userMessage = this.repos.appendMessage({
      userId: input.userId, characterId: input.characterId, role: 'user', content: effectiveText,
      sourceClient: input.sourceClient ?? 'app', ...(inboundSticker ? { stickerId: inboundSticker.id } : {}),
    });
    this.emitSync('message.created', input.userId, input.characterId, userMessage);

    // 3. 构建上下文并请求模型
    const relationship = this.repos.getRelationship(input.userId, input.characterId)!;
    const visibleInventory = this.inventoryEngine.getVisibleInventoryForPerception(input.userId, character, relationship.currentLocation);
    const activeMemories = this.memoryEngine.getActiveMemories(input.userId, input.characterId, dateKey);
    const recentMessages = this.repos.listRecentMessages(input.userId, input.characterId, 20);

    const llmMessages = this.contextBuilder.buildMessages({
      character, relationship, currentDateKey: dateKey, currentMinute: minuteOfDay,
      currentBlock, visibleInventory, activeMemories, recentMessages,
      availableStickerEmotions: ['害羞', '开心', '傲娇', '困倦', '吃醋', '生气', '微笑'],
    });

    const llmResp = await this.dialogueLlm.complete({ messages: llmMessages, tools: ORCHESTRATOR_TOOLS, temperature: 0.7 });
    const mediaTasks: MediaTaskRecord[] = [];
    const mediaUrls: string[] = [];
    let rawReply = llmResp.content || '';

    // 4. 执行 Tool Calls
    for (const tc of llmResp.toolCalls) {
      if (tc.name === 'update_character_items') {
        const args = safeParseJson<{ mutations?: InventoryMutation[] }>(tc.argumentsJson);
        if (args?.mutations?.length) {
          this.inventoryEngine.applyInventoryMutations(input.userId, input.characterId, args.mutations);
          this.emitSync('inventory.updated', input.userId, input.characterId, { mutations: args.mutations });
        }
      } else if (tc.name === 'generate_character_image') {
        const args = safeParseJson<{ action_intent?: string; include_self?: boolean; reply_text?: string }>(tc.argumentsJson) ?? {};
        const actionIntent = args.action_intent || '自拍照';
        const includeSelf = args.include_self !== false;
        if (!rawReply && args.reply_text) rawReply = args.reply_text;

        const heldItems = visibleInventory.held.map((i) => i.name);
        const composed = composeCharacterMediaPrompt({ character, relationship, heldItems, actionIntent, includeSelf });
        const kind: MediaTaskKind = includeSelf ? 'image_i2i' : 'image_t2i';
        const task = this.repos.createMediaTask({
          userId: input.userId, characterId: input.characterId, kind, status: 'pending',
          actionIntent, composedPrompt: composed.prompt,
        });

        const res = await this.mediaProvider.generateImage({ prompt: composed.prompt, referenceImages: composed.referenceImages });
        const updated = this.repos.updateMediaTask(task.id, {
          status: res.ok ? 'succeeded' : 'failed', resultUrl: res.url ?? null, errorMessage: res.error ?? null,
        })!;
        mediaTasks.push(updated);
        if (res.url) mediaUrls.push(res.url);
        this.emitSync('media.updated', input.userId, input.characterId, updated);
      } else if (tc.name === 'generate_character_video') {
        const args = safeParseJson<{ action_intent?: string; include_self?: boolean; duration?: number; reply_text?: string }>(tc.argumentsJson) ?? {};
        const actionIntent = args.action_intent || '动态视频';
        const includeSelf = args.include_self !== false;
        if (!rawReply && args.reply_text) rawReply = args.reply_text;

        const heldItems = visibleInventory.held.map((i) => i.name);
        const composed = composeCharacterMediaPrompt({ character, relationship, heldItems, actionIntent, includeSelf });
        const task = this.repos.createMediaTask({
          userId: input.userId, characterId: input.characterId, kind: 'video', status: 'pending',
          actionIntent, composedPrompt: composed.prompt,
        });

        const res = await this.mediaProvider.submitVideoTask({
          prompt: composed.prompt, referenceImages: composed.referenceImages, duration: args.duration,
        });
        const updated = this.repos.updateMediaTask(task.id, {
          status: res.ok ? 'running' : 'failed', externalTaskId: res.taskId ?? null, errorMessage: res.error ?? null,
        })!;
        mediaTasks.push(updated);
        this.emitSync('media.updated', input.userId, input.characterId, updated);
      }
    }

    // 5. 情感突变与回复持久化
    const affectRes = this.affectEngine.processReplyAffect(input.userId, input.characterId, rawReply);
    this.memoryEngine.recordEmotionalPeakIfSalient(input.userId, input.characterId, affectRes.affect, affectRes.cleanContent.slice(0, 50));
    this.emitSync('relationship.updated', input.userId, input.characterId, affectRes.relationship);
    if (affectRes.matchedSticker) this.emitSync('sticker.sent', input.userId, input.characterId, affectRes.matchedSticker);

    const assistantMessage = this.repos.appendMessage({
      userId: input.userId, characterId: input.characterId, role: 'assistant', content: affectRes.cleanContent,
      sourceClient: input.sourceClient ?? 'app', ...(mediaUrls.length ? { mediaUrls } : {}),
      ...(affectRes.matchedSticker ? { stickerId: affectRes.matchedSticker.id } : {}),
      ...(affectRes.affect ? { affectReaction: affectRes.affect } : {}),
    });
    this.emitSync('message.created', input.userId, input.characterId, assistantMessage);

    // 6. 回合后置异步提取
    if (this.extractorLlm) {
      const ext = await this.postTurnExtractor.extractAndSync({
        userId: input.userId, character, dateKey, currentMinute: minuteOfDay,
        userMessage: effectiveText, assistantReply: affectRes.cleanContent,
      });
      if (ext.inventoryMutated) this.emitSync('inventory.updated', input.userId, input.characterId, {});
      if (ext.scheduleRescheduled) {
        schedule = this.repos.getDailySchedule(input.userId, input.characterId, dateKey)!;
        this.emitSync('schedule.updated', input.userId, input.characterId, schedule);
      }
    }

    return {
      userMessage, assistantMessage, affect: affectRes.affect, matchedSticker: affectRes.matchedSticker,
      mediaTasks, relationship: this.repos.getRelationship(input.userId, input.characterId)!, schedule,
    };
  }

  private emitSync(type: SyncEventType, userId: string, characterId: string, payload: unknown): void {
    if (this.onSyncEvent) {
      this.onSyncEvent({ type, userId, characterId, timestamp: new Date().toISOString(), payload });
    }
  }
}
