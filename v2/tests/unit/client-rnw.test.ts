/**
 * Character OS v2 — React Native Web Integration & Unit Tests
 * 验证 RN 原语样式与布局、组件树渲染、类 Telegram 聊天窗口/内心OS/抽屉/工坊，以及 HTTP 网关路由
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';

import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  renderVNodeToHtml,
} from '../../src/client/rn-primitives.ts';
import {
  renderAppTree,
  renderAppShellHtml,
  getBrowserClientScript,
  type ClientViewState,
} from '../../src/client/App.ts';
import { createAppServer } from '../../src/server/app.ts';
import { createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';
import { EventHub } from '../../src/server/event-hub.ts';
import { MockLLMProvider } from '../../src/providers/llm.ts';
import { MockMediaProvider } from '../../src/providers/media.ts';
import { ChatOrchestrator } from '../../src/engine/chat-orchestrator.ts';
import type {
  Character,
  CharacterRelationship,
  ChatMessage,
  DailySchedule,
  InventoryItem,
  User,
} from '../../src/shared/types.ts';

function createSimulatedClient(server: http.Server) {
  return (options: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }) => {
    return new Promise<{
      status: number;
      headers: Record<string, string>;
      text: () => Promise<string>;
      json: <T = unknown>() => Promise<T>;
    }>((resolve) => {
      const socket = new Readable({ read() {} });
      const req = new http.IncomingMessage(socket as any);
      req.method = options.method || 'GET';
      req.url = options.url || '/';
      req.headers = { host: 'localhost', ...(options.headers || {}) };

      let resBody = '';
      let statusCode = 200;
      let resHeaders: Record<string, string> = {};

      const resSocket = new Writable({ write(_chunk, _enc, cb) { cb(); } });
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
        req.push(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.push(null);
    });
  };
}

describe('React Native Web Primitives & StyleSheet', () => {
  it('StyleSheet.create preserves typed style maps', () => {
    const rawStyles = { card: { flexDirection: 'row' as const, paddingHorizontal: 12 } };
    assert.deepEqual(StyleSheet.create(rawStyles), rawStyles);
  });

  it('StyleSheet.flatten resolves directional paddings and numeric units', () => {
    const flattened = StyleSheet.flatten({
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 8,
      marginHorizontal: 10,
      marginVertical: 4,
      width: 320,
      opacity: 0.9,
    });

    assert.equal(flattened.flexDirection, 'row');
    assert.equal(flattened.paddingLeft, '16px');
    assert.equal(flattened.paddingRight, '16px');
    assert.equal(flattened.paddingTop, '8px');
    assert.equal(flattened.paddingBottom, '8px');
    assert.equal(flattened.marginLeft, '10px');
    assert.equal(flattened.marginRight, '10px');
    assert.equal(flattened.marginTop, '4px');
    assert.equal(flattened.marginBottom, '4px');
    assert.equal(flattened.width, '320px');
    assert.equal(flattened.opacity, 0.9);
  });

  it('View defaults to React Native flexbox column layout', () => {
    const viewNode = View({ style: { gap: 8 } }, Text(null, 'Hello'));
    assert.equal(viewNode.type, 'View');
    assert.equal(viewNode.style.display, 'flex');
    assert.equal(viewNode.style.flexDirection, 'column');
    assert.equal(viewNode.style.boxSizing, 'border-box');
    assert.equal(viewNode.style.gap, '8px');
  });

  it('renderVNodeToHtml correctly outputs HTML elements and CSS attributes', () => {
    const vnode = View(
      { style: { backgroundColor: '#17212b', paddingHorizontal: 10 } },
      Text({ style: { color: '#ffffff' } }, '标题'),
      TextInput({ id: 'test-input', placeholder: '输入内容' }),
      TouchableOpacity({ 'data-action': 'test-btn' }, Text(null, '点击')),
      Image({ src: 'https://example.com/avatar.jpg' }),
    );

    const html = renderVNodeToHtml(vnode);
    assert.ok(html.includes('class="rn-view"'));
    assert.ok(html.includes('background-color: #17212b'));
    assert.ok(html.includes('padding-left: 10px; padding-right: 10px'));
    assert.ok(html.includes('<span class="rn-text"'));
    assert.ok(html.includes('color: #ffffff'));
    assert.ok(html.includes('>标题</span>'));
    assert.ok(html.includes('class="rn-textinput"'));
    assert.ok(html.includes('id="test-input"'));
    assert.ok(html.includes('placeholder="输入内容"'));
    assert.ok(html.includes('class="rn-touchable"'));
    assert.ok(html.includes('data-action="test-btn"'));
    assert.ok(html.includes('class="rn-image"'));
    assert.ok(html.includes('src="https://example.com/avatar.jpg"'));
  });
});

describe('React Native Web App Views & Components', () => {
  const mockUser: User = { id: 'u-1', username: 'demo_user', displayName: '主人', timezone: 'Asia/Shanghai', telegramUserId: null, createdAt: '', updatedAt: '' };
  const mockCharacter: Character = {
    id: 'c-1', creatorUserId: 'u-1', visibility: 'public', name: '御狐神双炽', description: '妖馆4号室专属妖狐SS',
    avatarUrl: 'https://example.com/avatar.png', referenceImageDataUrl: 'data:image/jpeg;base64,ROLESELF',
    corePersona: '极度忠诚、温柔体贴', speechStyle: '常称呼用户为“主人”',
    lifestyleProfile: { homeLocation: '妖馆4号室(家)', defaultEnvironment: '起居室', usualPlaces: ['妖馆4号室(家)'], dailyBaseline: '侍奉主人', defaultOutfit: '黑色修身执事西装与白手套', defaultCarriedItems: ['银色怀表'] },
    createdAt: '', updatedAt: '',
  };
  const mockRelationship: CharacterRelationship = {
    id: 'rel-1', userId: 'u-1', characterId: 'c-1', currentLocation: '妖馆4号室(家)', currentSceneDesc: '起居室', currentActivity: '整理茶点', outfitDesc: '黑色修身执事西装与白手套',
    currentMoodTag: '欣喜', innerMonologue: '只要能侍奉在主人身旁，便是我最大的幸福', relationshipStage: 'friend', bondScore: 320, trustScore: 45, moodValence: 60, attachmentLevel: 50,
    unlockedStages: ['stranger', 'acquaintance', 'friend'], proactiveEnabled: true, caffeineWakeUntil: null, updatedAt: '',
  };
  const mockSchedule: DailySchedule = {
    id: 'sch-1', userId: 'u-1', characterId: 'c-1', dateKey: '2026-11-09', timezone: 'Asia/Shanghai', source: 'model',
    blocks: [
      { id: 'b-1', startMinute: 0, endMinute: 480, category: 'sleep', activity: '静谧睡眠', location: '妖馆4号室', environment: '卧室', mood: '安详', proactiveHint: false, status: 'completed' },
      { id: 'b-2', startMinute: 480, endMinute: 1440, category: 'routine', activity: '为主人备餐与整理起居', location: '妖馆4号室', environment: '客厅', mood: '欣喜', proactiveHint: true, status: 'active' },
    ],
    createdAt: '', updatedAt: '',
  };
  const mockInventory: InventoryItem[] = [
    { id: 'i-1', userId: 'u-1', characterId: 'c-1', scope: 'character_equipped', locationTag: '身上', name: '黑色修身执事西装与白手套', quantity: 1, unit: '套', description: '执事服', updatedAt: '' },
    { id: 'i-2', userId: 'u-1', characterId: 'c-1', scope: 'character_carried', locationTag: '随身口袋', name: '银色怀表', quantity: 1, unit: '块', description: '怀表', updatedAt: '' },
    { id: 'i-3', userId: 'u-1', characterId: 'c-1', scope: 'shared_home', locationTag: '冰箱', name: '全脂牛奶', quantity: 2, unit: '瓶', description: '牛奶', updatedAt: '' },
  ];
  const mockMessages: ChatMessage[] = [
    { id: 'm-1', userId: 'u-1', characterId: 'c-1', role: 'user', content: '双炽，早安！今天辛苦你啦。', sourceClient: 'web', createdAt: '' },
    {
      id: 'm-2', userId: 'u-1', characterId: 'c-1', role: 'assistant', content: '主人，早安。能听到您的问候，双炽感到无上荣幸。', sourceClient: 'app',
      affectReaction: { deltaMood: 20, deltaBond: 15, deltaTrust: 10, moodTag: '欣喜雀跃', innerMonologue: '主人的笑容真美，今天也要全心全意侍奉主人。', stickerEmotion: '害羞' },
      stickerId: '害羞', createdAt: '',
    },
  ];

  it('renders Chat Window, affect monologue badge, Drawer with items/schedule, and Studio Modal', () => {
    const state: ClientViewState = {
      currentUser: mockUser,
      characters: [mockCharacter],
      activeCharacterId: mockCharacter.id,
      relationship: mockRelationship,
      schedule: mockSchedule,
      inventory: mockInventory,
      imprints: [{ id: 'imp-1', userId: mockUser.id, characterId: mockCharacter.id, category: 'milestone', content: '契约建立', emotionalWeight: 9, createdAt: '' }],
      messages: mockMessages,
      mediaTasks: [],
      drawerOpen: true,
      studioModalOpen: true,
    };

    const tree = renderAppTree(state);
    const html = renderVNodeToHtml(tree);

    // Sidebar & Chat Window
    assert.ok(html.includes('Character OS v2'));
    assert.ok(html.includes('御狐神双炽'));
    assert.ok(html.includes('双炽，早安！今天辛苦你啦。'));
    assert.ok(html.includes('主人，早安。能听到您的问候'));

    // Affect monologue capsule & sticker badge
    assert.ok(html.includes('💭 内心OS: 主人的笑容真美'));
    assert.ok(html.includes('心情 欣喜雀跃 (羁绊+15)'));
    assert.ok(html.includes('🏷️ 贴纸: 害羞'));

    // Right State Drawer
    assert.ok(html.includes('三层情感与深刻印记'));
    assert.ok(html.includes('羁绊 (Bond): 320 / 1000'));
    assert.ok(html.includes('银色怀表 x1'));
    assert.ok(html.includes('全脂牛奶 x 2 瓶'));
    assert.ok(html.includes('00:00 - 08:00'));
    assert.ok(html.includes('08:00 - 24:00'));

    // Character Studio Modal
    assert.ok(html.includes('角色工坊 (Character Studio)'));
    assert.ok(html.includes('char-name'));
    assert.ok(html.includes('char-persona'));
    assert.ok(html.includes('🎨 用 VVdance Seedream 生成人设底图'));
  });

  it('renderAppShellHtml provides full HTML document with assets link', () => {
    const shell = renderAppShellHtml('Character OS v2 — React Native Web');
    assert.ok(shell.startsWith('<!DOCTYPE html>'));
    assert.ok(shell.includes('<title>Character OS v2 — React Native Web</title>'));
    assert.ok(shell.includes('<div id="rn-root">'));
    assert.ok(shell.includes('<script type="module" src="/assets/rn-web-app.js"></script>'));
  });

  it('getBrowserClientScript provides interactive browser client runtime', () => {
    const script = getBrowserClientScript();
    assert.ok(script.includes('export function h('));
    assert.ok(script.includes('/api/state'));
    assert.ok(script.includes('/api/seed-demo'));
    assert.ok(script.includes('/api/studio/generate-avatar'));
  });
});

describe('HTTP Server RNW Integration Endpoints', () => {
  const db = createDatabase(':memory:');
  const repos = new Repositories(db);
  const eventHub = new EventHub();
  const mockDialogueLlm = new MockLLMProvider({ name: 'mock-dialogue' });
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

  const request = createSimulatedClient(server);

  it('GET / and GET /index.html serve React Native Web HTML shell', async () => {
    const resRoot = await request({ method: 'GET', url: '/' });
    assert.equal(resRoot.status, 200);
    assert.equal(resRoot.headers['Content-Type'], 'text/html; charset=utf-8');
    const rootText = await resRoot.text();
    assert.ok(rootText.includes('<!DOCTYPE html>'));
    assert.ok(rootText.includes('Character OS v2 — React Native Web'));
    assert.ok(rootText.includes('id="rn-root"'));

    const resIndex = await request({ method: 'GET', url: '/index.html' });
    assert.equal(resIndex.status, 200);
    const indexText = await resIndex.text();
    assert.equal(indexText, rootText);
  });

  it('GET /assets/rn-web-app.js serves interactive client script', async () => {
    const res = await request({ method: 'GET', url: '/assets/rn-web-app.js' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'application/javascript; charset=utf-8');
    const text = await res.text();
    assert.ok(text.includes('export function h('));
  });

  it('POST /api/seed-demo initializes demo environment and GET /api/state retrieves it', async () => {
    const seedRes = await request({ method: 'POST', url: '/api/seed-demo' });
    assert.equal(seedRes.status, 200);
    const seedData = await seedRes.json<{ user: User; character: Character }>();

    assert.ok(seedData.user);
    assert.equal(seedData.user.username, 'demo_master');
    assert.equal(seedData.user.displayName, '主人');

    assert.ok(seedData.character);
    assert.equal(seedData.character.name, '御狐神双炽');
    assert.equal(seedData.character.lifestyleProfile.homeLocation, '妖馆4号室(家)');

    // Verify GET /api/state retrieves the seeded state
    const stateRes = await request({
      method: 'GET',
      url: `/api/state?userId=${seedData.user.id}&characterId=${seedData.character.id}`,
    });
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json<{
      relationship: CharacterRelationship;
      inventory: InventoryItem[];
    }>();

    assert.ok(state.relationship);
    assert.equal(state.relationship.currentLocation, '妖馆4号室(家)');
    assert.equal(state.relationship.outfitDesc, '黑色修身执事西装与白手套');

    // Verify inventory contains carried watch, handkerchief, fridge milk, cake, tea
    const invNames = state.inventory.map((i) => i.name);
    assert.ok(invNames.includes('银色怀表'), 'carried watch exists');
    assert.ok(invNames.includes('丝质手帕'), 'carried handkerchief exists');
    assert.ok(invNames.includes('全脂牛奶'), 'fridge milk exists');
    assert.ok(invNames.includes('草莓切片蛋糕'), 'fridge cake exists');
    assert.ok(invNames.includes('大吉岭红茶包'), 'tea bags exist');

    const milk = state.inventory.find((i) => i.name === '全脂牛奶');
    assert.equal(milk?.quantity, 2);
    assert.equal(milk?.scope, 'shared_home');
    assert.equal(milk?.locationTag, '冰箱');

    // Verify calling POST /api/seed-demo again is idempotent
    const seedAgainRes = await request({ method: 'POST', url: '/api/seed-demo' });
    assert.equal(seedAgainRes.status, 200);
    const seedAgainData = await seedAgainRes.json<{ user: User; character: Character }>();
    assert.equal(seedAgainData.user.id, seedData.user.id);
    assert.equal(seedAgainData.character.id, seedData.character.id);
  });

  it('POST /api/studio/generate-avatar invokes media provider and handles validation', async () => {
    // 1. Empty prompt returns 400
    const emptyRes = await request({
      method: 'POST',
      url: '/api/studio/generate-avatar',
      body: { prompt: '   ' },
    });
    assert.equal(emptyRes.status, 400);
    const emptyData = await emptyRes.json<{ ok: boolean; error: string }>();
    assert.equal(emptyData.ok, false);

    // 2. Valid prompt returns generated avatar URL
    const genRes = await request({
      method: 'POST',
      url: '/api/studio/generate-avatar',
      body: {
        prompt: 'Anime male butler with silver fox ears and two-toned eyes',
        aspectRatio: '1:1',
      },
    });
    assert.equal(genRes.status, 200);
    const genData = await genRes.json<{ ok: boolean; url: string }>();
    assert.equal(genData.ok, true);
    assert.ok(genData.url);
    assert.ok(genData.url.startsWith('https://'));
  });
});
