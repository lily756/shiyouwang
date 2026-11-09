/**
 * Character OS v2 — Multi-Client EventHub
 * 实时同步广播中心，支持进程内订阅者回调与 HTTP Server-Sent Events (SSE) 多端推送
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SyncEvent } from '../shared/types.ts';

export type EventListener = (event: SyncEvent) => void;

interface ListenerEntry {
  listener: EventListener;
  userId?: string;
}

interface SseClientEntry {
  res: ServerResponse;
  userId?: string;
}

export class EventHub {
  private readonly listeners: ListenerEntry[] = [];
  private readonly sseClients: SseClientEntry[] = [];

  /**
   * 注册进程内事件监听回调，可选绑定特定 userId
   * 返回解除订阅函数 () => void
   */
  public subscribe(listener: EventListener, userId?: string): () => void {
    const entry: ListenerEntry = { listener, userId };
    this.listeners.push(entry);

    return () => {
      const idx = this.listeners.indexOf(entry);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  /**
   * 接入 HTTP SSE 客户端长连接
   */
  public attachSseClient(
    req: IncomingMessage,
    res: ServerResponse,
    userId?: string,
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');

    const client: SseClientEntry = { res, userId };
    this.sseClients.push(client);

    const cleanup = (): void => {
      const idx = this.sseClients.indexOf(client);
      if (idx !== -1) {
        this.sseClients.splice(idx, 1);
      }
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  /**
   * 发布事件，广播给匹配的进程内监听者与 SSE 长连接端
   */
  public publish(event: SyncEvent): void {
    // 1. 进程内监听分发
    for (const sub of [...this.listeners]) {
      if (!sub.userId || sub.userId === event.userId) {
        try {
          sub.listener(event);
        } catch (err) {
          console.error('[EventHub] Listener error:', err);
        }
      }
    }

    // 2. SSE 客户端数据包格式化并分发
    const payloadStr = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of [...this.sseClients]) {
      if (!client.userId || client.userId === event.userId) {
        if (!client.res.writableEnded) {
          try {
            client.res.write(payloadStr);
          } catch {
            const idx = this.sseClients.indexOf(client);
            if (idx !== -1) this.sseClients.splice(idx, 1);
          }
        }
      }
    }
  }

  /**
   * 关闭所有活跃连接并清空监听者
   */
  public close(): void {
    for (const client of this.sseClients) {
      if (!client.res.writableEnded) {
        try {
          client.res.end();
        } catch {
          // ignore
        }
      }
    }
    this.sseClients.length = 0;
    this.listeners.length = 0;
  }
}
