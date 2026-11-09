/**
 * Character OS v2 — LLM Provider
 * 南向文本大模型服务对接 (DeepSeek 与 MockProvider)
 */

import type {
  LLMChatMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMProvider,
  LLMToolCall,
  LLMToolDefinition,
} from '../shared/types.ts';

export interface DeepSeekProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof globalThis.fetch;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}

interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export class DeepSeekProvider implements LLMProvider {
  public readonly name: string = 'deepseek';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private fetchFn: typeof globalThis.fetch;
  private timeoutMs: number;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(options: DeepSeekProviderOptions = {}) {
    this.apiKey =
      options.apiKey ??
      (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '');
    this.baseUrl = options.baseUrl ?? 'https://api.deepseek.com/beta';
    this.model = options.model ?? 'deepseek-flash';
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.defaultTemperature = options.temperature ?? 0.7;
    this.defaultMaxTokens = options.maxTokens ?? 4096;
  }

  public async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    const url = `${cleanBase}/chat/completions`;

    const messages: OpenAIChatMessage[] = request.messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
        };
      }
      if (
        msg.role === 'assistant' &&
        msg.toolCalls &&
        msg.toolCalls.length > 0
      ) {
        return {
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.argumentsJson,
            },
          })),
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? this.defaultTemperature,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
    };

    if (request.tools && request.tools.length > 0) {
      const tools: OpenAIToolDef[] = request.tools.map((tool: LLMToolDefinition) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DeepSeek API request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`DeepSeek API error HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: {
              name?: string;
              arguments?: string | Record<string, unknown>;
            };
          }>;
        };
      }>;
    };

    const choice = data.choices?.[0];
    const message = choice?.message;
    const content = typeof message?.content === 'string' ? message.content : '';

    const rawToolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : [];
    const toolCalls: LLMToolCall[] = rawToolCalls.map((tc) => {
      const args = tc.function?.arguments;
      const argumentsJson =
        typeof args === 'string' ? args : JSON.stringify(args ?? {});
      return {
        id: String(tc.id || ''),
        name: String(tc.function?.name || ''),
        argumentsJson,
      };
    });

    return { content, toolCalls };
  }
}

export type LLMHandlerFn = (
  req: LLMCompletionRequest,
) => Promise<LLMCompletionResponse> | LLMCompletionResponse;

export interface MockLLMProviderOptions {
  name?: string;
  handler?: LLMHandlerFn;
}

export class MockLLMProvider implements LLMProvider {
  public readonly name: string;
  public readonly calls: LLMCompletionRequest[] = [];
  private queue: LLMCompletionResponse[] = [];
  private handler: LLMHandlerFn | null;

  constructor(options: MockLLMProviderOptions = {}) {
    this.name = options.name ?? 'mock-llm';
    this.handler = options.handler ?? null;
  }

  public setHandler(handler: LLMHandlerFn | null): void {
    this.handler = handler;
  }

  public enqueueResponse(response: LLMCompletionResponse): void {
    this.queue.push(response);
  }

  public clearQueue(): void {
    this.queue = [];
  }

  public clearCalls(): void {
    this.calls.length = 0;
  }

  public async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    this.calls.push(request);
    if (this.handler) {
      return await this.handler(request);
    }
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    return {
      content: 'Mock response',
      toolCalls: [],
    };
  }
}
