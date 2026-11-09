/**
 * Character OS v2 — 生产环境服务启动入口
 * 自动加载根目录或当前目录 .env 配置，装配 node:sqlite、DeepSeek 与 VVdance 驱动并启动多端同步 Server。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../db/connection.ts';
import { Repositories } from '../db/repositories.ts';
import { DeepSeekProvider } from '../providers/llm.ts';
import { VVdanceMediaProvider } from '../providers/media.ts';
import { ChatOrchestrator } from '../engine/chat-orchestrator.ts';
import { EventHub } from './event-hub.ts';
import { createAppServer } from './app.ts';

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawVal = trimmed.slice(eqIndex + 1).trim();
    const val = rawVal.replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

export function bootstrapServer(options?: {
  dbPath?: string;
  port?: number;
}) {
  // 依次尝试加载当前目录与父目录的 .env
  loadEnvFile(path.resolve(process.cwd(), '.env'));
  loadEnvFile(path.resolve(process.cwd(), '../.env'));

  const dbPath =
    options?.dbPath ||
    process.env.V2_SQLITE_PATH ||
    path.resolve(process.cwd(), 'data.v2.sqlite');

  const db = createDatabase(dbPath);
  const repos = new Repositories(db);
  const eventHub = new EventHub();

  const deepseek = new DeepSeekProvider({
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_API_BASE_URL || 'https://api.deepseek.com/beta',
    model: process.env.OPENAI_MODEL || 'deepseek-flash',
  });

  const vvdance = new VVdanceMediaProvider({
    seedreamBaseUrl: process.env.SEEDREAM_API_BASE_URL || 'https://vvdance.ai',
    seedreamApiKey: process.env.SEEDREAM_API_KEY || '',
    seedreamModel:
      process.env.SEEDREAM_MODEL || 'dola-seedream-5-0-pro-260628',
    seedreamImageSize: process.env.SEEDREAM_IMAGE_SIZE || '1K',
    seedanceBaseUrl: process.env.SEEDANCE_API_BASE_URL || 'https://vvdance.ai',
    seedanceApiToken:
      process.env.SEEDANCE_API_TOKEN || process.env.SEEDREAM_API_KEY || '',
    seedanceVideoModel:
      process.env.SEEDANCE_VIDEO_MODEL ||
      'dreamina-seedance-2-0-mini-260615',
    seedanceResolution: process.env.SEEDANCE_VIDEO_RESOLUTION || '720p',
    seedanceRatio: process.env.SEEDANCE_VIDEO_RATIO || '9:16',
  });

  const orchestrator = new ChatOrchestrator({
    repos,
    dialogueLlm: deepseek,
    extractorLlm: deepseek,
    mediaProvider: vvdance,
    onSyncEvent: (event) => eventHub.publish(event),
  });

  const server = createAppServer({
    repos,
    orchestrator,
    eventHub,
    mediaProvider: vvdance,
  });

  const port = options?.port ?? Number(process.env.V2_PORT || 3200);
  server.listen(port, () => {
    console.log(
      `[Character OS v2] Server listening on http://localhost:${port} (SQLite: ${dbPath})`,
    );
  });

  return { db, repos, eventHub, orchestrator, server };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  bootstrapServer();
}
