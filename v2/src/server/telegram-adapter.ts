/**
 * Character OS v2 — Telegram Adapter
 * 轻量解耦的双向 Telegram 适配器：
 * 1. 入站消息/贴纸转交 ChatOrchestrator 推进主世界线；
 * 2. 监听 EventHub 同步来自 Web/App 的对话变更、主动关怀与媒体生成结果至 Telegram。
 */

import type {
  ChatMessage,
  MediaTaskRecord,
  StickerRecord,
  SyncEvent,
} from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';
import type {
  ChatOrchestrator,
  HandleUserTurnResult,
} from '../engine/chat-orchestrator.ts';
import type { EventHub } from './event-hub.ts';
import { AuthService } from './auth.ts';

export interface TelegramMessagePayload {
  text?: string;
  mediaUrls?: string[];
  stickerUrl?: string;
}

export type SendTelegramMessageFn = (
  telegramUserId: string,
  payload: TelegramMessagePayload,
) => Promise<void>;

export interface TelegramAdapterDeps {
  repos: Repositories;
  orchestrator: ChatOrchestrator;
  eventHub: EventHub;
  sendTelegramMessage: SendTelegramMessageFn;
  authService?: AuthService;
}

export class TelegramAdapter {
  private readonly repos: Repositories;
  private readonly orchestrator: ChatOrchestrator;
  private readonly eventHub: EventHub;
  private readonly sendTelegramMessage: SendTelegramMessageFn;
  private readonly authService: AuthService;
  private unsubscribeEventHub: (() => void) | null = null;

  constructor(deps: TelegramAdapterDeps) {
    this.repos = deps.repos;
    this.orchestrator = deps.orchestrator;
    this.eventHub = deps.eventHub;
    this.sendTelegramMessage = deps.sendTelegramMessage;
    this.authService = deps.authService ?? new AuthService(deps.repos);

    this.unsubscribeEventHub = this.eventHub.subscribe((event) => {
      void this.handleSyncEvent(event);
    });
  }

  public destroy(): void {
    if (this.unsubscribeEventHub) {
      this.unsubscribeEventHub();
      this.unsubscribeEventHub = null;
    }
  }

  /**
   * 处理 Telegram /bind <CODE> 账号绑定指令
   */
  public async handleBindCommand(telegramUserId: string, code: string): Promise<boolean> {
    const boundUser = this.authService.consumeTelegramBindCode(code, telegramUserId);
    if (!boundUser) {
      await this.sendTelegramMessage(telegramUserId, {
        text: '❌ 绑定码无效或已过期，请在 Web 端重新生成绑定码。',
      });
      return false;
    }
    await this.sendTelegramMessage(telegramUserId, {
      text: `✅ 已成功绑定到账号：${boundUser.displayName} (@${boundUser.username})！现在 Web 端与 Telegram 共享同一世界线。`,
    });
    return true;
  }

  /**
   * 处理 Telegram 入站用户消息并交由 ChatOrchestrator 推进回合
   */
  public async handleInboundMessage(params: {
    telegramUserId: string;
    text: string;
    characterId?: string;
    sticker?: { fileHash: string; imageUrl: string };
    dateKey?: string;
    minuteOfDay?: number;
  }): Promise<HandleUserTurnResult> {
    let user = this.repos.getUserByTelegramId(params.telegramUserId);
    if (!user) {
      user = this.repos.createUser({
        username: `tg_${params.telegramUserId}`,
        displayName: `TG User ${params.telegramUserId}`,
        telegramUserId: params.telegramUserId,
      });
    }

    let characterId = params.characterId;
    if (!characterId) {
      const chars = this.repos.listCharactersForUser(user.id);
      if (chars.length === 0) {
        throw new Error(`No available character found for user ${user.id}`);
      }
      characterId = chars[0].id;
    }

    const result = await this.orchestrator.handleUserTurn({
      userId: user.id,
      characterId,
      text: params.text,
      sourceClient: 'telegram',
      inboundSticker: params.sticker,
      dateKey: params.dateKey,
      minuteOfDay: params.minuteOfDay,
    });

    await this.sendTelegramMessage(params.telegramUserId, {
      text: result.assistantMessage.content,
      mediaUrls: result.assistantMessage.mediaUrls,
      stickerUrl: result.matchedSticker?.imageUrl,
    });

    return result;
  }

  /**
   * 当其他端（Web / App）或后台 Proactive 产生消息/媒体变动时，同步转发至绑定的 Telegram
   */
  public async handleSyncEvent(event: SyncEvent): Promise<void> {
    const user = this.repos.getUserById(event.userId);
    if (!user?.telegramUserId) return;

    const tgId = user.telegramUserId;

    if (event.type === 'message.created') {
      const msg = event.payload as ChatMessage;
      // 如果是其它客户端发起的对话回复或主动唤醒消息，同步给 Telegram
      if (msg.role === 'assistant' && msg.sourceClient !== 'telegram') {
        await this.sendTelegramMessage(tgId, {
          text: msg.content,
          mediaUrls: msg.mediaUrls,
        });
      }
    } else if (event.type === 'media.updated') {
      const task = event.payload as MediaTaskRecord;
      if (task.status === 'succeeded' && task.resultUrl) {
        await this.sendTelegramMessage(tgId, {
          text: `[生成完毕] ${task.actionIntent || '媒体文件'}`,
          mediaUrls: [task.resultUrl],
        });
      }
    } else if (event.type === 'sticker.sent') {
      const sticker = event.payload as StickerRecord;
      if (sticker?.imageUrl) {
        await this.sendTelegramMessage(tgId, {
          stickerUrl: sticker.imageUrl,
        });
      }
    }
  }
}
