/**
 * Character OS v2 — Auth, Session & Telegram Account Binding Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';

import { createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';
import { EventHub } from '../../src/server/event-hub.ts';
import { MockLLMProvider } from '../../src/providers/llm.ts';
import { MockMediaProvider } from '../../src/providers/media.ts';
import { ChatOrchestrator } from '../../src/engine/chat-orchestrator.ts';
import { createAppServer } from '../../src/server/app.ts';
import { TelegramAdapter, type TelegramMessagePayload } from '../../src/server/telegram-adapter.ts';
import { renderAppTree } from '../../src/client/App.ts';
import { renderVNodeToHtml } from '../../src/client/rn-primitives.ts';
import type { User } from '../../src/shared/types.ts';

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

describe('Auth Service & HTTP Endpoints (Register / Login / Session / Telegram Bind)', () => {
  const db = createDatabase(':memory:');
  const repos = new Repositories(db);
  const eventHub = new EventHub();
  const orchestrator = new ChatOrchestrator({
    repos,
    dialogueLlm: new MockLLMProvider({ name: 'dialogue' }),
    extractorLlm: new MockLLMProvider({ name: 'extractor' }),
    mediaProvider: new MockMediaProvider(),
    onSyncEvent: (ev) => eventHub.publish(ev),
  });

  const server = createAppServer({
    repos,
    orchestrator,
    eventHub,
    mediaProvider: new MockMediaProvider(),
  });
  const request = createSimulatedClient(server);

  it('registers a new account, prevents duplicate username, logs in, verifies session, and logs out', async () => {
    // 1. Register
    const regRes = await request({
      method: 'POST',
      url: '/api/auth/register',
      body: { username: 'akira', password: 'secret_password', displayName: '主人Akira' },
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json<{ ok: boolean; user: User; token: string }>();
    assert.equal(regData.ok, true);
    assert.equal(regData.user.username, 'akira');
    assert.equal(regData.user.displayName, '主人Akira');
    assert.ok(regData.token.length >= 32);

    // 2. Duplicate username returns 409
    const dupRes = await request({
      method: 'POST',
      url: '/api/auth/register',
      body: { username: 'AKIRA', password: 'another_password' },
    });
    assert.equal(dupRes.status, 409);

    // 3. Login with wrong password returns 401
    const badLoginRes = await request({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'akira', password: 'wrong_password' },
    });
    assert.equal(badLoginRes.status, 401);

    // 4. Login with valid password returns 200 and new token
    const loginRes = await request({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'akira', password: 'secret_password' },
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json<{ ok: boolean; user: User; token: string }>();
    assert.equal(loginData.user.id, regData.user.id);

    // 5. Verify /api/auth/me with Bearer token
    const meRes = await request({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json<{ ok: boolean; user: User }>();
    assert.equal(meData.user.id, regData.user.id);

    // 6. Logout invalidates token
    const logoutRes = await request({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(logoutRes.status, 200);

    const meAfterLogout = await request({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(meAfterLogout.status, 401);
  });

  it('generates a Telegram bind code and binds Telegram account via TelegramAdapter /bind command', async () => {
    const loginRes = await request({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'akira', password: 'secret_password' },
    });
    const { user, token } = await loginRes.json<{ user: User; token: string }>();

    // Generate bind code
    const codeRes = await request({
      method: 'POST',
      url: '/api/auth/telegram-bind-code',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(codeRes.status, 200);
    const codeData = await codeRes.json<{ ok: boolean; code: string; command: string }>();
    assert.equal(codeData.ok, true);
    assert.equal(codeData.code.length, 6);
    assert.equal(codeData.command, `/bind ${codeData.code}`);

    // Bind via TelegramAdapter
    const sentMessages: Array<{ tgId: string; payload: TelegramMessagePayload }> = [];
    const tgAdapter = new TelegramAdapter({
      repos,
      orchestrator,
      eventHub,
      sendTelegramMessage: async (tgId, payload) => {
        sentMessages.push({ tgId, payload });
      },
    });

    const boundOk = await tgAdapter.handleBindCommand('tg_998877', codeData.code);
    assert.equal(boundOk, true);
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].payload.text?.includes('已成功绑定到账号：主人Akira (@akira)'));

    const updatedUser = repos.getUserById(user.id);
    assert.equal(updatedUser?.telegramUserId, 'tg_998877');

    tgAdapter.destroy();
  });

  it('renders Auth Modal when logged out and User Account Badge when logged in', () => {
    const loggedOutHtml = renderVNodeToHtml(
      renderAppTree({
        currentUser: null,
        authMode: 'register',
        authError: '密码过短',
        characters: [],
        activeCharacterId: null,
        relationship: null,
        schedule: null,
        inventory: [],
        imprints: [],
        messages: [],
        mediaTasks: [],
        drawerOpen: false,
        studioModalOpen: false,
      }),
    );

    assert.ok(loggedOutHtml.includes('账号登录 / 注册'));
    assert.ok(loggedOutHtml.includes('注册并进入世界'));
    assert.ok(loggedOutHtml.includes('⚠️ 密码过短'));

    const loggedInHtml = renderVNodeToHtml(
      renderAppTree({
        currentUser: {
          id: 'u-1',
          username: 'akira',
          displayName: '主人Akira',
          timezone: 'Asia/Shanghai',
          telegramUserId: 'tg_998877',
          createdAt: '',
          updatedAt: '',
        },
        bindCommand: '/bind ABC123',
        characters: [],
        activeCharacterId: null,
        relationship: null,
        schedule: null,
        inventory: [],
        imprints: [],
        messages: [],
        mediaTasks: [],
        drawerOpen: false,
        studioModalOpen: false,
      }),
    );

    assert.ok(!loggedInHtml.includes('账号登录 / 注册'));
    assert.ok(loggedInHtml.includes('👤 主人Akira (@akira)'));
    assert.ok(loggedInHtml.includes('✅ 已绑定 TG: tg_998877'));
    assert.ok(loggedInHtml.includes('📌 向 TG 发送: /bind ABC123'));
  });
});
