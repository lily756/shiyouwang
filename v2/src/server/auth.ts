/**
 * Character OS v2 — Authentication & Telegram Account Binding Service
 * 基于 node:crypto (scryptSync + randomBytes + timingSafeEqual) 的零依赖账号注册、登录、会话校验与 Telegram 绑定服务
 */

import http from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Repositories } from '../db/repositories.ts';
import type { User } from '../shared/types.ts';

export class AuthError extends Error {
  public readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return timingSafeEqual(derived, keyBuf);
}

export class AuthService {
  private readonly repos: Repositories;

  constructor(repos: Repositories) {
    this.repos = repos;
  }

  public register(params: {
    username: string;
    password: string;
    displayName?: string;
    timezone?: string;
  }): { user: User; token: string } {
    const username = (params.username ?? '').trim();
    const password = params.password ?? '';
    const displayName = (params.displayName ?? '').trim() || username;
    const timezone = params.timezone ?? 'Asia/Shanghai';

    if (!username || username.length < 2) {
      throw new AuthError(400, '用户名长度至少为 2 个字符');
    }
    if (!password || password.length < 4) {
      throw new AuthError(400, '密码长度至少为 4 个字符');
    }

    const existing = this.repos.db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1')
      .get(username) as { id: string } | undefined;

    if (existing) {
      throw new AuthError(409, '该用户名已被注册');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    this.repos.db
      .prepare(
        'INSERT INTO users (id, username, display_name, password_hash, timezone, telegram_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
      )
      .run(id, username, displayName, passwordHash, timezone, now, now);

    const user = this.repos.getUserById(id)!;
    const token = this.createSession(user.id);
    return { user, token };
  }

  public login(params: { username: string; password: string }): { user: User; token: string } {
    const username = (params.username ?? '').trim();
    const password = params.password ?? '';

    if (!username || !password) {
      throw new AuthError(400, '请输入用户名和密码');
    }

    const row = this.repos.db
      .prepare('SELECT id, password_hash FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1')
      .get(username) as { id: string; password_hash: string } | undefined;

    if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) {
      throw new AuthError(401, '用户名或密码错误');
    }

    const user = this.repos.getUserById(row.id)!;
    const token = this.createSession(user.id);
    return { user, token };
  }

  public createSession(userId: string, ttlDays: number = 30): string {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 86400_000).toISOString();
    this.repos.db
      .prepare('INSERT INTO auth_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, expiresAt, now.toISOString());
    return token;
  }

  public verifyToken(token: string | null | undefined): User | null {
    if (!token) return null;
    const clean = token.replace(/^Bearer\s+/i, '').trim();
    if (!clean) return null;

    const row = this.repos.db
      .prepare('SELECT user_id, expires_at FROM auth_sessions WHERE token = ? LIMIT 1')
      .get(clean) as { user_id: string; expires_at: string } | undefined;

    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.repos.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(clean);
      return null;
    }

    return this.repos.getUserById(row.user_id);
  }

  public logout(token: string | null | undefined): void {
    if (!token) return;
    const clean = token.replace(/^Bearer\s+/i, '').trim();
    if (!clean) return;
    this.repos.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(clean);
  }

  public createTelegramBindCode(userId: string): { code: string; expiresAt: string } {
    const user = this.repos.getUserById(userId);
    if (!user) throw new AuthError(404, '用户不存在');

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    this.repos.db.prepare('DELETE FROM telegram_bind_codes WHERE user_id = ?').run(userId);
    this.repos.db
      .prepare('INSERT INTO telegram_bind_codes (code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(code, userId, expiresAt, now.toISOString());

    return { code, expiresAt };
  }

  public consumeTelegramBindCode(code: string, telegramUserId: string): User | null {
    const cleanCode = (code ?? '').trim().toUpperCase();
    const cleanTgId = (telegramUserId ?? '').trim();
    if (!cleanCode || !cleanTgId) return null;

    const row = this.repos.db
      .prepare('SELECT user_id, expires_at FROM telegram_bind_codes WHERE UPPER(code) = ? LIMIT 1')
      .get(cleanCode) as { user_id: string; expires_at: string } | undefined;

    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.repos.db.prepare('DELETE FROM telegram_bind_codes WHERE UPPER(code) = ?').run(cleanCode);
      return null;
    }

    const now = new Date().toISOString();
    // 解除旧临时账号上的同 telegram_user_id 占用，避免 UNIQUE 冲突
    this.repos.db
      .prepare('UPDATE users SET telegram_user_id = NULL, updated_at = ? WHERE telegram_user_id = ? AND id != ?')
      .run(now, cleanTgId, row.user_id);

    this.repos.db
      .prepare('UPDATE users SET telegram_user_id = ?, updated_at = ? WHERE id = ?')
      .run(cleanTgId, now, row.user_id);

    this.repos.db.prepare('DELETE FROM telegram_bind_codes WHERE UPPER(code) = ?').run(cleanCode);
    return this.repos.getUserById(row.user_id);
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export async function handleAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  query: URLSearchParams,
  authService: AuthService,
): Promise<boolean> {
  if (!pathname.startsWith('/api/auth/')) return false;

  try {
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await readJsonBody<{
        username: string;
        password: string;
        displayName?: string;
        timezone?: string;
      }>(req);
      const result = authService.register(body);
      sendJson(res, 201, { ok: true, ...result });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJsonBody<{ username: string; password: string }>(req);
      const result = authService.login(body);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const authHeader = req.headers.authorization ?? '';
      const body = await readJsonBody<{ token?: string }>(req).catch(() => ({ token: undefined }));
      authService.logout(authHeader || body.token);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const token = (req.headers.authorization as string | undefined) ?? query.get('token');
      const user = authService.verifyToken(token);
      if (!user) {
        sendJson(res, 401, { ok: false, error: '未登录或会话已过期' });
        return true;
      }
      sendJson(res, 200, { ok: true, user });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/auth/telegram-bind-code') {
      const body = await readJsonBody<{ userId?: string }>(req);
      const tokenUser = authService.verifyToken(req.headers.authorization as string | undefined);
      const userId = tokenUser?.id ?? body.userId ?? '';
      if (!userId) {
        sendJson(res, 401, { ok: false, error: '缺少有效用户信息' });
        return true;
      }
      const { code, expiresAt } = authService.createTelegramBindCode(userId);
      sendJson(res, 200, { ok: true, code, expiresAt, command: `/bind ${code}` });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/auth/telegram-bind') {
      const body = await readJsonBody<{ code: string; telegramUserId: string }>(req);
      const user = authService.consumeTelegramBindCode(body.code, body.telegramUserId);
      if (!user) {
        sendJson(res, 400, { ok: false, error: '绑定码无效或已过期' });
        return true;
      }
      sendJson(res, 200, { ok: true, user });
      return true;
    }

    sendJson(res, 404, { ok: false, error: `Auth route not found: ${pathname}` });
    return true;
  } catch (err) {
    if (err instanceof AuthError) {
      sendJson(res, err.statusCode, { ok: false, error: err.message });
      return true;
    }
    throw err;
  }
}
