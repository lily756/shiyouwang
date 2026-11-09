/**
 * Character OS v2 — HTTP REST & SSE Server
 * 提供北向强类型 REST API 与实时多端同步事件流 (SSE)
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Repositories } from '../db/repositories.ts';
import type { MediaProvider, User } from '../shared/types.ts';
import type { ChatOrchestrator } from '../engine/chat-orchestrator.ts';
import type { EventHub } from './event-hub.ts';
import { AuthService, handleAuthRequest } from './auth.ts';
import { renderAppShellHtml, getBrowserClientScript } from '../client/App.ts';

export interface AppServerDeps {
  repos: Repositories;
  orchestrator: ChatOrchestrator;
  eventHub: EventHub;
  mediaProvider: MediaProvider;
  authService?: AuthService;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as T) : ({} as T));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

export function createAppServer(deps: AppServerDeps): http.Server {
  const authService = deps.authService ?? new AuthService(deps.repos);

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(
      req.url ?? '/',
      `http://${req.headers.host || 'localhost'}`,
    );
    const pathname = urlObj.pathname;
    const query = urlObj.searchParams;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    try {
      // 0. React Native Web Client Shell & Assets
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(renderAppShellHtml('Character OS v2 — React Native Web'));
        return;
      }

      if (req.method === 'GET' && pathname === '/assets/rn-web-app.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(getBrowserClientScript());
        return;
      }

      // 1. Health check
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, version: '2.0.0' });
      }

      // 1b. Auth & Telegram Account Binding Routes (/api/auth/*)
      if (await handleAuthRequest(req, res, pathname, query, authService)) {
        return;
      }

      // 2. Real-time SSE Events Stream
      if (req.method === 'GET' && pathname === '/api/events') {
        const userId = query.get('userId') ?? undefined;
        deps.eventHub.attachSseClient(req, res, userId);
        return;
      }

      // 3. Create User
      if (req.method === 'POST' && pathname === '/api/users') {
        const body = await readJsonBody<{
          username: string;
          displayName: string;
          timezone?: string;
          telegramUserId?: string | null;
        }>(req);
        const user = deps.repos.createUser(body);
        return sendJson(res, 201, user);
      }

      // 4. Create Character
      if (req.method === 'POST' && pathname === '/api/characters') {
        const body = await readJsonBody<{
          creatorUserId: string;
          name: string;
          description?: string;
          avatarUrl?: string;
          referenceImageDataUrl?: string;
          corePersona?: string;
          speechStyle?: string;
          lifestyleProfile?: any;
        }>(req);
        const char = deps.repos.createCharacter(body);
        return sendJson(res, 201, char);
      }

      // 5. List Characters
      if (req.method === 'GET' && pathname === '/api/characters') {
        const userId = query.get('userId') ?? '';
        const characters = deps.repos.listCharactersForUser(userId);
        return sendJson(res, 200, characters);
      }

      // 6. Get Comprehensive State
      if (req.method === 'GET' && pathname === '/api/state') {
        const userId = query.get('userId') ?? '';
        const characterId = query.get('characterId') ?? '';
        const dateKey =
          query.get('dateKey') ?? new Date().toISOString().slice(0, 10);

        const relationship = deps.repos.ensureRelationship(userId, characterId);
        const schedule = deps.repos.getDailySchedule(userId, characterId, dateKey);
        const inventory = deps.repos.listInventoryItems(userId, characterId);
        const imprints = deps.repos.listMemoryImprints(userId, characterId);
        const messages = deps.repos.listRecentMessages(userId, characterId, 50);
        const mediaTasks = deps.repos.listMediaTasks(userId, characterId);

        return sendJson(res, 200, {
          relationship,
          schedule,
          inventory,
          imprints,
          messages,
          mediaTasks,
        });
      }

      // 7. Mutate Inventory
      if (req.method === 'POST' && pathname === '/api/inventory') {
        const body = await readJsonBody<{
          id?: string;
          userId: string;
          characterId: string;
          scope: any;
          locationTag?: string;
          name: string;
          quantity: number;
          unit?: string;
          description?: string;
        }>(req);

        const item = deps.repos.upsertInventoryItem(body);
        if (item) {
          deps.eventHub.publish({
            type: 'inventory.updated',
            userId: item.userId,
            characterId: item.characterId,
            timestamp: new Date().toISOString(),
            payload: item,
          });
        }
        return sendJson(res, 200, item);
      }

      // 8. Chat Turn
      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await readJsonBody<{
          userId: string;
          characterId: string;
          text: string;
          sourceClient?: 'app' | 'web' | 'telegram';
          inboundSticker?: { fileHash: string; imageUrl: string };
          dateKey?: string;
          minuteOfDay?: number;
        }>(req);

        const result = await deps.orchestrator.handleUserTurn(body);
        return sendJson(res, 200, result);
      }

      // 9. Poll & Sync Media Task
      const mediaPollMatch = /^\/api\/media\/poll\/([^/?]+)$/.exec(pathname);
      if (req.method === 'POST' && mediaPollMatch) {
        const taskId = decodeURIComponent(mediaPollMatch[1]);
        const task = deps.repos.getMediaTask(taskId);
        if (!task) {
          return sendJson(res, 404, { error: 'Media task not found' });
        }

        if (
          task.externalTaskId &&
          (task.status === 'pending' || task.status === 'running')
        ) {
          const pollResult = await deps.mediaProvider.getVideoTaskStatus(
            task.externalTaskId,
          );
          const updated = deps.repos.updateMediaTask(taskId, {
            status: pollResult.status,
            resultUrl: pollResult.videoUrl ?? task.resultUrl,
            errorMessage: pollResult.error ?? task.errorMessage,
          });

          if (updated) {
            deps.eventHub.publish({
              type: 'media.updated',
              userId: updated.userId,
              characterId: updated.characterId,
              timestamp: new Date().toISOString(),
              payload: updated,
            });
            return sendJson(res, 200, updated);
          }
        }
        return sendJson(res, 200, task);
      }

      // 10. Character Studio Avatar Generation
      if (req.method === 'POST' && pathname === '/api/studio/generate-avatar') {
        const body = await readJsonBody<{
          prompt?: string;
          aspectRatio?: string;
          referenceImages?: string[];
        }>(req);

        if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
          return sendJson(res, 400, { ok: false, error: 'Prompt is required' });
        }

        const result = await deps.mediaProvider.generateImage({
          prompt: body.prompt.trim(),
          aspectRatio: body.aspectRatio,
          referenceImages: body.referenceImages,
        });

        return sendJson(res, 200, {
          ok: result.ok,
          url: result.url,
          error: result.error,
        });
      }

      // 11. Seed Demo Environment
      if (req.method === 'POST' && pathname === '/api/seed-demo') {
        const body = await readJsonBody<{ userId?: string }>(req).catch(() => ({}));

        // 1. Finds or creates demo user
        let user: User | null = deps.repos.getUserById('demo_user_master');
        if (!user && (deps.repos as unknown as { db?: { prepare: (sql: string) => { get: (param: string) => { id: string } | undefined } } }).db) {
          try {
            const row = (deps.repos as unknown as { db: { prepare: (sql: string) => { get: (param: string) => { id: string } | undefined } } }).db
              .prepare('SELECT id FROM users WHERE username = ? LIMIT 1')
              .get('demo_master');
            if (row?.id) {
              user = deps.repos.getUserById(row.id);
            }
          } catch {
            // ignore fallback
          }
        }
        if (!user) {
          user = deps.repos.createUser({
            id: 'demo_user_master',
            username: 'demo_master',
            displayName: '主人',
            timezone: 'Asia/Shanghai',
          });
        }

        // 2. Finds or creates demo character "御狐神双炽"
        const existingChars = deps.repos.listCharactersForUser(user.id);
        let character = existingChars.find((c) => c.name === '御狐神双炽');
        if (!character) {
          character = deps.repos.createCharacter({
            creatorUserId: user.id,
            name: '御狐神双炽',
            description: '妖馆4号室专属妖狐SS，温柔忠诚又带点腹黑粘人的执事',
            corePersona:
              '你是御狐神双炽，对主人极度忠诚、温柔体贴，说话敬语中带着一丝粘人与微小的占有欲。',
            speechStyle: '常称呼用户为“主人”，语气温和优雅。',
            referenceImageDataUrl: 'data:image/jpeg;base64,ROLESELF',
            lifestyleProfile: {
              homeLocation: '妖馆4号室(家)',
              defaultEnvironment: '温暖整洁的起居室，茶香袅袅',
              usualPlaces: ['妖馆4号室(家)', '庭院花园', '商店街超市'],
              dailyBaseline: '为准备主人的三餐、茶点、整理房间与贴身侍奉而忙碌',
              defaultOutfit: '黑色修身执事西装与白手套',
              defaultCarriedItems: ['银色怀表', '丝质手帕', '房间钥匙'],
            },
          });
        }

        // 3. Ensures relationship & default inventory
        const targetUserIds = new Set<string>([user.id]);
        if (body?.userId && typeof body.userId === 'string') targetUserIds.add(body.userId);

        const demoItems = [
          { scope: 'character_equipped' as const, locationTag: '身上', name: '黑色修身执事西装与白手套', quantity: 1, unit: '套', description: '黑色修身执事西装与白手套' },
          { scope: 'character_carried' as const, locationTag: '随身口袋', name: '银色怀表', quantity: 1, unit: '块', description: '银色怀表' },
          { scope: 'character_carried' as const, locationTag: '随身口袋', name: '丝质手帕', quantity: 1, unit: '条', description: '丝质手帕' },
          { scope: 'shared_home' as const, locationTag: '冰箱', name: '全脂牛奶', quantity: 2, unit: '瓶', description: '全脂纯牛奶' },
          { scope: 'shared_home' as const, locationTag: '冰箱', name: '草莓切片蛋糕', quantity: 1, unit: '份', description: '草莓切片蛋糕' },
          { scope: 'shared_home' as const, locationTag: '吧台', name: '大吉岭红茶包', quantity: 5, unit: '包', description: '大吉岭红茶包' },
        ];

        for (const uid of targetUserIds) {
          deps.repos.ensureRelationship(uid, character.id, character);
          for (const it of demoItems) {
            deps.repos.upsertInventoryItem({ userId: uid, characterId: character.id, ...it });
          }
        }

        // 4. Upserts default stickers
        const demoStickers = [
          { fileHash: 'demo_sticker_shy', emotionTag: '害羞', semanticMeaning: '双炽脸红害羞的表情' },
          { fileHash: 'demo_sticker_happy', emotionTag: '开心', semanticMeaning: '双炽温柔微笑开心的表情' },
          { fileHash: 'demo_sticker_hug', emotionTag: '贴贴', semanticMeaning: '双炽向主人撒娇求贴贴' },
        ];
        for (const st of demoStickers) {
          deps.repos.upsertSticker({
            characterId: character.id,
            imageUrl: `https://cdn.example.com/stickers/${st.fileHash}.png`,
            ...st,
          });
        }

        // 5. Returns 200 with { user, character }
        return sendJson(res, 200, { user, character });
      }

      // 404 Not Found
      return sendJson(res, 404, { error: 'Not Found' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return sendJson(res, 500, { error: message });
    }
  });

  return server;
}
