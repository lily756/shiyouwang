/**
 * Character OS v2 — Full-Lifecycle End-to-End Integration Test
 * 端到端全链路闭环测试：
 * 创角 -> 日程懒加载自愈 -> 聊天感知 -> 情绪突变与羁绊解锁 -> 喝牛奶扣库存 -> 动态重排日程 -> VVdance多模态生图/生视频 -> 多端WS/SSE与Telegram实时同步
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';

import { createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';
import { MockLLMProvider } from '../../src/providers/llm.ts';
import { MockMediaProvider } from '../../src/providers/media.ts';
import { EventHub } from '../../src/server/event-hub.ts';
import { TelegramAdapter } from '../../src/server/telegram-adapter.ts';
import { ChatOrchestrator } from '../../src/engine/chat-orchestrator.ts';
import { createAppServer } from '../../src/server/app.ts';
import type {
  HandleUserTurnResult,
  LLMCompletionRequest,
  MediaTaskRecord,
  SyncEvent,
} from '../../src/shared/types.ts';

interface SimulatedResponse {
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
}

function createSimulatedClient(server: http.Server) {
  const request = (options: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<SimulatedResponse> => {
    return new Promise((resolve) => {
      const socket = new Readable({ read() {} });
      const req = new http.IncomingMessage(socket as any);
      req.method = options.method || 'GET';
      req.url = options.url || '/';
      req.headers = { host: 'localhost', ...(options.headers || {}) };

      let resBody = '';
      let statusCode = 200;
      let resHeaders: Record<string, string> = {};

      const resSocket = new Writable({
        write(_chunk, _enc, cb) {
          cb();
        },
      });

      const res = new http.ServerResponse(req);
      res.assignSocket(resSocket as any);

      res.writeHead = (code: number, headers?: any) => {
        statusCode = code;
        if (headers) resHeaders = { ...resHeaders, ...headers };
        return res;
      };

      res.write = (chunk: any) => {
        resBody += chunk.toString();
        return true;
      };

      res.end = (chunk?: any) => {
        if (chunk) resBody += chunk.toString();
        resolve({
          status: statusCode,
          headers: resHeaders,
          text: async () => resBody,
          json: async () => (resBody ? JSON.parse(resBody) : {}),
        });
        return res;
      };

      server.emit('request', req, res);

      if (options.body !== undefined) {
        req.push(
          typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
        );
      }
      req.push(null);
    });
  };

  const connectSse = (
    url: string,
    onEvent: (event: SyncEvent) => void,
  ): (() => void) => {
    const socket = new Readable({ read() {} });
    const req = new http.IncomingMessage(socket as any);
    req.method = 'GET';
    req.url = url;
    req.headers = { host: 'localhost' };

    const resSocket = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });

    const res = new http.ServerResponse(req);
    res.assignSocket(resSocket as any);

    let buffer = '';
    res.write = (chunk: any) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              onEvent(JSON.parse(line.slice(6)));
            } catch {
              // ignore
            }
          }
        }
      }
      return true;
    };

    server.emit('request', req, res);
    req.push(null);

    return () => {
      req.emit('close');
      res.emit('close');
    };
  };

  return { request, connectSse };
}

describe('Character OS v2 — Full Lifecycle E2E Test', () => {
  it('executes full multi-client lifecycle with DeepSeek & VVdance providers', async () => {
    // -------------------------------------------------------------
    // Step 1: 系统环境初始化与多端同步总线搭建
    // -------------------------------------------------------------
    const db = createDatabase(':memory:');
    const repos = new Repositories(db);
    const eventHub = new EventHub();

    const mockDialogueLlm = new MockLLMProvider({ name: 'mock-deepseek' });
    const mockExtractorLlm = new MockLLMProvider({ name: 'mock-extractor' });
    const mockMediaProvider = new MockMediaProvider();

    const orchestrator = new ChatOrchestrator({
      repos,
      dialogueLlm: mockDialogueLlm,
      extractorLlm: mockExtractorLlm,
      mediaProvider: mockMediaProvider,
      onSyncEvent: (event) => eventHub.publish(event),
    });

    const server = createAppServer({
      repos,
      orchestrator,
      eventHub,
      mediaProvider: mockMediaProvider,
    });

    const client = createSimulatedClient(server);

    // -------------------------------------------------------------
    // Step 2: 创角工坊 (Character Studio) 与空间物品初始化
    // -------------------------------------------------------------
    // 1. 创建绑定 Telegram ID 的用户
    const userRes = await client.request({
      method: 'POST',
      url: '/api/users',
      body: {
        username: 'akira',
        displayName: '主人',
        timezone: 'Asia/Shanghai',
        telegramUserId: 'tg_999',
      },
    });
    assert.equal(userRes.status, 201);
    const user = await userRes.json<{ id: string }>();

    // 2. 创建角色“御狐神双炽”
    const charRes = await client.request({
      method: 'POST',
      url: '/api/characters',
      body: {
        creatorUserId: user.id,
        name: '御狐神双炽',
        description: '九尾狐转世执事侍从',
        referenceImageDataUrl: 'data:image/jpeg;base64,ROLESELF',
        corePersona: '忠心耿耿，温柔克制且深情的侍从。',
        speechStyle: '恭谨温和，称呼主人。',
        lifestyleProfile: {
          homeLocation: '家中',
          defaultEnvironment: '日式和室',
          usualPlaces: ['家中', '城市游乐园'],
          dailyBaseline: '整理内务，侍奉主人',
          defaultOutfit: '黑色执事西装',
          defaultCarriedItems: ['银色怀表', '手帕'],
        },
      },
    });
    assert.equal(charRes.status, 201);
    const character = await charRes.json<{ id: string }>();

    // 3. 注册角色专属情绪表情包
    repos.upsertSticker({
      characterId: character.id,
      fileHash: 'hash-shy-99',
      imageUrl: 'https://cdn.example.com/stickers/shy.png',
      emotionTag: '害羞',
      semanticMeaning: '双炽脸红低头微笑',
    });

    // 4. 家里冰箱放入“牛奶 x 2瓶”
    const invRes = await client.request({
      method: 'POST',
      url: '/api/inventory',
      body: {
        userId: user.id,
        characterId: character.id,
        scope: 'shared_home',
        locationTag: '冰箱',
        name: '牛奶',
        quantity: 2,
        unit: '瓶',
        description: '新鲜牛奶',
      },
    });
    assert.equal(invRes.status, 200);

    // -------------------------------------------------------------
    // Step 3: 多端实时监听建立 (SSE 长连接 + Telegram 双向同步适配器)
    // -------------------------------------------------------------
    const sseReceivedEvents: SyncEvent[] = [];
    const closeSse = client.connectSse(
      `/api/events?userId=${user.id}`,
      (event) => {
        sseReceivedEvents.push(event);
      },
    );

    const telegramDispatched: Array<{
      telegramUserId: string;
      payload: { text?: string; mediaUrls?: string[]; stickerUrl?: string };
    }> = [];

    const telegramAdapter = new TelegramAdapter({
      repos,
      orchestrator,
      eventHub,
      sendTelegramMessage: async (telegramUserId, payload) => {
        telegramDispatched.push({ telegramUserId, payload });
      },
    });

    // -------------------------------------------------------------
    // Turn 1: 懒加载日程生成 + 第一人称感知快照验证
    // -------------------------------------------------------------
    let turn1PromptCaptured = '';
    mockDialogueLlm.setHandler((req: LLMCompletionRequest) => {
      // 若是 ScheduleEngine 发起的日程生成提示词
      if (req.messages[0]?.content.includes('生活节奏编排引擎')) {
        return {
          content: JSON.stringify([
            {
              start: '08:00',
              end: '12:00',
              category: 'routine',
              activity: '整理宅邸与茶室',
              location: '家中',
              environment: '日式和室',
              mood: '专注',
            },
            {
              start: '12:00',
              end: '13:30',
              category: 'meal',
              activity: '准备并享用午餐',
              location: '家中',
              environment: '饭厅',
              mood: '轻松',
            },
            {
              start: '13:30',
              end: '18:00',
              category: 'routine',
              activity: '日常家务与侍奉',
              location: '家中',
              environment: '日式和室',
              mood: '温和',
            },
            {
              start: '18:00',
              end: '22:00',
              category: 'leisure',
              activity: '晚间品茶侍奉',
              location: '家中',
              environment: '茶室',
              mood: '安详',
            },
          ]),
          toolCalls: [],
        };
      }

      // 否则为本轮对话
      turn1PromptCaptured = req.messages[1]?.content || '';
      return {
        content:
          '早上好，主人。我正在整理茶具，随身携带着银色怀表，冰箱里还有两瓶牛奶呢。',
        toolCalls: [],
      };
    });

    const turn1Res = await client.request({
      method: 'POST',
      url: '/api/chat',
      body: {
        userId: user.id,
        characterId: character.id,
        text: '早上好双炽，你在干嘛？身上带着什么？家里冰箱有什么？',
        dateKey: '2026-05-10',
        minuteOfDay: 540, // 09:00
      },
    });
    assert.equal(turn1Res.status, 200);
    const turn1Data = await turn1Res.json<HandleUserTurnResult>();

    // 检验 1: ScheduleEngine 自动补齐首尾 00:00~24:00，绝不丢弃
    assert.ok(turn1Data.schedule.blocks.length >= 4);
    assert.equal(turn1Data.schedule.blocks[0].startMinute, 0);
    assert.equal(
      turn1Data.schedule.blocks[turn1Data.schedule.blocks.length - 1].endMinute,
      1440,
    );

    // 检验 2: 第一人称感知快照包含随身物、穿着、冰箱库存，且绝对无负面禁令
    assert.ok(turn1PromptCaptured.includes('银色怀表'));
    assert.ok(turn1PromptCaptured.includes('黑色执事西装'));
    assert.ok(turn1PromptCaptured.includes('牛奶(2瓶)'));

    const negativeProhibitions = [
      '不要凭空增加',
      '不要凭空改变',
      '严禁改变',
      '严禁凭空',
      '禁止擅自',
      '绝对不可更改',
    ];
    for (const neg of negativeProhibitions) {
      assert.ok(
        !turn1PromptCaptured.includes(neg),
        `Perception prompt must not contain prohibition: "${neg}"`,
      );
    }

    // -------------------------------------------------------------
    // Turn 2: 情感即时突变 + 喝牛奶扣库存 + 动态改日程
    // -------------------------------------------------------------
    mockDialogueLlm.setHandler(() => ({
      content:
        '<affect delta_mood="+30" delta_bond="+25" delta_trust="+10" mood="害羞又感动" sticker="害羞">被主人夸奖了，好开心</affect>遵命，主人～我现在就把牛奶喝掉，下午专心陪您去游乐园！',
      toolCalls: [],
    }));

    mockExtractorLlm.setHandler(() => ({
      content: JSON.stringify({
        inventoryMutations: [
          { action: 'consume_or_remove', name: '牛奶', quantity: 1 },
        ],
        scheduleUpdates: [
          {
            start: '14:00',
            end: '18:00',
            category: 'leisure',
            activity: '陪主人去游乐园',
            location: '城市游乐园',
            environment: '热闹非凡',
            mood: '开心',
          },
        ],
        locationChange: {
          location: '城市游乐园',
          sceneDesc: '游乐园热闹非凡',
          activity: '陪主人玩耍',
        },
      }),
      toolCalls: [],
    }));

    const turn2Res = await client.request({
      method: 'POST',
      url: '/api/chat',
      body: {
        userId: user.id,
        characterId: character.id,
        text: '双炽你今天真帅！把冰箱里的牛奶喝掉一瓶吧，然后下午14:00到18:00别做家务了，陪我去游乐园玩！',
        dateKey: '2026-05-10',
        minuteOfDay: 600, // 10:00
      },
    });
    assert.equal(turn2Res.status, 200);
    const turn2Data = await turn2Res.json<HandleUserTurnResult>();

    // 检验 1: <affect> 标签被干净剥离
    assert.equal(
      turn2Data.assistantMessage.content,
      '遵命，主人～我现在就把牛奶喝掉，下午专心陪您去游乐园！',
    );

    // 检验 2: 情感量化指标更新与表情包匹配
    assert.equal(turn2Data.relationship.bondScore, 25);
    assert.equal(turn2Data.relationship.moodValence, 30);
    assert.ok(turn2Data.matchedSticker);
    assert.equal(turn2Data.matchedSticker.emotionTag, '害羞');
    assert.equal(
      turn2Data.matchedSticker.imageUrl,
      'https://cdn.example.com/stickers/shy.png',
    );

    // 检验 3: 情绪起伏自动沉淀为深刻印记
    const imprints = repos.listMemoryImprints(user.id, character.id);
    assert.ok(imprints.some((i) => i.category === 'emotional_peak'));

    // 检验 4: 冰箱牛奶从 2 瓶自动扣减为 1 瓶
    const milkItem = repos
      .listInventoryItems(user.id, character.id, ['shared_home'])
      .find((i) => i.name === '牛奶');
    assert.ok(milkItem);
    assert.equal(milkItem.quantity, 1);

    // 检验 5: 下午时段成功重排为去游乐园，随身物品“银色怀表”跨日程保留
    const afternoonBlock = turn2Data.schedule.blocks.find(
      (b) => b.startMinute <= 900 && b.endMinute > 900, // 15:00
    );
    assert.ok(afternoonBlock);
    assert.equal(afternoonBlock.activity, '陪主人去游乐园');
    assert.equal(afternoonBlock.location, '城市游乐园');

    const carriedItems = repos.listInventoryItems(user.id, character.id, [
      'character_carried',
    ]);
    assert.ok(carriedItems.some((i) => i.name === '银色怀表'));

    // -------------------------------------------------------------
    // Turn 3: 触发 VVdance Seedream 生图与 Seedance 视频生成
    // -------------------------------------------------------------
    mockDialogueLlm.setHandler(() => ({
      content: '主人请看，这是我在游乐园自拍的照片和小视频～',
      toolCalls: [
        {
          id: 'call-img-1',
          name: 'generate_character_image',
          argumentsJson: JSON.stringify({
            action_intent: '在游乐园摩天轮前自拍微笑',
            include_self: true,
            reply_text: '主人请看，这是我在游乐园自拍的照片和小视频～',
          }),
        },
        {
          id: 'call-vid-1',
          name: 'generate_character_video',
          argumentsJson: JSON.stringify({
            action_intent: '在游乐园向主人挥手致意',
            include_self: true,
            duration: 5,
          }),
        },
      ],
    }));

    mockMediaProvider.nextImageUrl = 'https://vvdance-cdn.com/selfie-park.jpg';
    mockMediaProvider.nextTaskId = 'task-seedance-video-999';

    const turn3Res = await client.request({
      method: 'POST',
      url: '/api/chat',
      body: {
        userId: user.id,
        characterId: character.id,
        text: '拍张你在游乐园的自拍和一段小视频发给我！',
        dateKey: '2026-05-10',
        minuteOfDay: 930, // 15:30
      },
    });
    assert.equal(turn3Res.status, 200);
    const turn3Data = await turn3Res.json<HandleUserTurnResult>();

    // 检验 1: Media Prompt Composer 自动结合当前地点（城市游乐园）、穿着（黑色执事西装）与人设底图
    assert.equal(mockMediaProvider.imageCalls.length, 1);
    const imgReq = mockMediaProvider.imageCalls[0];
    assert.ok(imgReq.prompt.includes('城市游乐园'));
    assert.ok(imgReq.prompt.includes('黑色执事西装'));
    assert.ok(imgReq.prompt.includes('在游乐园摩天轮前自拍微笑'));
    assert.deepEqual(imgReq.referenceImages, [
      'data:image/jpeg;base64,ROLESELF',
    ]);

    assert.equal(mockMediaProvider.videoSubmissions.length, 1);
    const vidReq = mockMediaProvider.videoSubmissions[0];
    assert.ok(vidReq.prompt.includes('城市游乐园'));
    assert.ok(vidReq.prompt.includes('黑色执事西装'));
    assert.deepEqual(vidReq.referenceImages, [
      'data:image/jpeg;base64,ROLESELF',
    ]);

    // 检验 2: 轮询媒体任务并验证多端广播
    const videoTaskRecord = turn3Data.mediaTasks.find(
      (t) => t.kind === 'video',
    );
    assert.ok(videoTaskRecord);
    assert.equal(videoTaskRecord.status, 'running');
    assert.equal(videoTaskRecord.externalTaskId, 'task-seedance-video-999');

    // 模拟后台视频任务渲染完成
    mockMediaProvider.nextTaskStatus = {
      status: 'succeeded',
      videoUrl: 'https://vvdance-cdn.com/final-rollercoaster.mp4',
    };

    const pollRes = await client.request({
      method: 'POST',
      url: `/api/media/poll/${encodeURIComponent(videoTaskRecord.id)}`,
    });
    assert.equal(pollRes.status, 200);
    const polledTask = await pollRes.json<MediaTaskRecord>();
    assert.equal(polledTask.status, 'succeeded');
    assert.equal(
      polledTask.resultUrl,
      'https://vvdance-cdn.com/final-rollercoaster.mp4',
    );

    // -------------------------------------------------------------
    // Step 4: 验证 SSE 与 Telegram 多端实时同步
    // -------------------------------------------------------------
    // 等待微任务清空
    await new Promise((r) => setTimeout(r, 20));

    // 验证 SSE 收到一系列状态事件
    const sseEventTypes = sseReceivedEvents.map((e) => e.type);
    assert.ok(sseEventTypes.includes('message.created'));
    assert.ok(sseEventTypes.includes('relationship.updated'));
    assert.ok(sseEventTypes.includes('media.updated'));

    // 验证 Telegram 适配器收到同步消息与视频更新
    assert.ok(telegramDispatched.length >= 2);
    const tgVideos = telegramDispatched.filter(
      (m) =>
        m.payload.mediaUrls &&
        m.payload.mediaUrls.some((u) => u.includes('final-rollercoaster')),
    );
    assert.ok(
      tgVideos.length > 0,
      'Telegram adapter must receive finished video notification',
    );

    // -------------------------------------------------------------
    // Step 5: 清理连接与服务
    // -------------------------------------------------------------
    telegramAdapter.destroy();
    eventHub.close();
    closeSse();
  });
});
