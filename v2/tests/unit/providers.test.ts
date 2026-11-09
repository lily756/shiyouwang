/**
 * Character OS v2 — Providers Unit Tests
 * 针对 DeepSeekProvider, composeCharacterMediaPrompt, VVdanceMediaProvider 与 Mock Providers 的全方位测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  Character,
  CharacterRelationship,
  LLMCompletionRequest,
} from '../../src/shared/types.ts';
import {
  DeepSeekProvider,
  MockLLMProvider,
} from '../../src/providers/llm.ts';
import {
  composeCharacterMediaPrompt,
  MockMediaProvider,
  VVdanceMediaProvider,
} from '../../src/providers/media.ts';

const dummyCharacter: Character = {
  id: 'char-101',
  creatorUserId: 'user-001',
  visibility: 'private',
  name: '双炽',
  description: '九尾狐转世侍从',
  avatarUrl: 'https://example.com/avatar.jpg',
  referenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  corePersona: '极度忠诚、温和克制的侍从',
  speechStyle: '称呼主人，礼貌温存',
  lifestyleProfile: {
    homeLocation: '宅邸和室',
    defaultEnvironment: '安静的木质和风居所',
    usualPlaces: ['书房', '茶室'],
    dailyBaseline: '每日早起为主人泡茶点香',
    defaultOutfit: '一袭墨黑羽织和服',
    defaultCarriedItems: ['折扇', '式神符纸'],
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const dummyRelationship: CharacterRelationship = {
  id: 'rel-101',
  userId: 'user-001',
  characterId: 'char-101',
  currentLocation: '日式茶室',
  currentSceneDesc: '窗外竹影摇曳，微风拂动风铃',
  currentActivity: '整理茶具',
  outfitDesc: '素黑羽织与雪白足袋',
  currentMoodTag: '欣喜平静',
  innerMonologue: '今日能陪伴在主人身旁，倍感幸福',
  relationshipStage: 'friend',
  bondScore: 150,
  trustScore: 80,
  moodValence: 45,
  attachmentLevel: 65,
  unlockedStages: ['stranger', 'acquaintance', 'friend'],
  proactiveEnabled: true,
  caffeineWakeUntil: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DeepSeekProvider', () => {
  it('constructs correct endpoint for default, trailing-slash, and custom base URLs', async () => {
    const urlsCalled: string[] = [];
    const dummyFetch: typeof globalThis.fetch = async (input) => {
      urlsCalled.push(String(input));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
        }),
        { status: 200 },
      );
    };

    // 1. Default baseUrl: https://api.deepseek.com/beta
    const p1 = new DeepSeekProvider({ apiKey: 'k1', fetchFn: dummyFetch });
    await p1.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(urlsCalled[0], 'https://api.deepseek.com/beta/chat/completions');

    // 2. Trailing slash: https://api.deepseek.com/beta///
    const p2 = new DeepSeekProvider({
      apiKey: 'k2',
      baseUrl: 'https://api.deepseek.com/beta///',
      fetchFn: dummyFetch,
    });
    await p2.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(urlsCalled[1], 'https://api.deepseek.com/beta/chat/completions');

    // 3. Non-beta custom proxy: https://my-proxy.com/v1
    const p3 = new DeepSeekProvider({
      apiKey: 'k3',
      baseUrl: 'https://my-proxy.com/v1',
      fetchFn: dummyFetch,
    });
    await p3.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(urlsCalled[2], 'https://my-proxy.com/v1/chat/completions');

    // 4. Non-versioned base: https://api.deepseek.com
    const p4 = new DeepSeekProvider({
      apiKey: 'k4',
      baseUrl: 'https://api.deepseek.com',
      fetchFn: dummyFetch,
    });
    await p4.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(urlsCalled[3], 'https://api.deepseek.com/chat/completions');
  });

  it('serializes headers, preserved L0 system prompt order, and tools payload', async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl: string | undefined;

    const dummyFetch: typeof globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '正在为您更新日程',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'update_schedule',
                      arguments: '{"newActivity":"游乐园"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const provider = new DeepSeekProvider({
      apiKey: 'secret-ds-token',
      fetchFn: dummyFetch,
      temperature: 0.8,
      maxTokens: 2048,
    });

    const request: LLMCompletionRequest = {
      messages: [
        { role: 'system', content: 'L0: 你是双炽，忠诚侍从' },
        { role: 'user', content: '下午陪我去游乐园吧' },
        {
          role: 'assistant',
          content: '遵命',
          toolCalls: [
            { id: 'prev-call', name: 'check_items', argumentsJson: '{}' },
          ],
        },
        { role: 'tool', content: '{"status":"ok"}', toolCallId: 'prev-call' },
      ],
      tools: [
        {
          name: 'update_schedule',
          description: '更新日程时段',
          parameters: {
            type: 'object',
            properties: { newActivity: { type: 'string' } },
            required: ['newActivity'],
          },
        },
      ],
    };

    const res = await provider.complete(request);

    assert.equal(
      capturedUrl,
      'https://api.deepseek.com/beta/chat/completions',
    );
    assert.ok(capturedInit);

    const headers = capturedInit.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer secret-ds-token');
    assert.equal(headers['Content-Type'], 'application/json');

    const body = JSON.parse(String(capturedInit.body));
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.temperature, 0.8);
    assert.equal(body.max_tokens, 2048);

    // Verify messages[0] is the untouched L0 system prompt
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, 'L0: 你是双炽，忠诚侍从');
    assert.equal(body.messages[1].role, 'user');
    assert.equal(body.messages[2].role, 'assistant');
    assert.equal(body.messages[2].tool_calls?.[0]?.id, 'prev-call');
    assert.equal(body.messages[3].role, 'tool');
    assert.equal(body.messages[3].tool_call_id, 'prev-call');

    // Verify tools payload
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].type, 'function');
    assert.equal(body.tools[0].function.name, 'update_schedule');

    // Verify response parsing
    assert.equal(res.content, '正在为您更新日程');
    assert.equal(res.toolCalls.length, 1);
    assert.equal(res.toolCalls[0].id, 'call-1');
    assert.equal(res.toolCalls[0].name, 'update_schedule');
    assert.equal(res.toolCalls[0].argumentsJson, '{"newActivity":"游乐园"}');
  });

  it('omits tools and tool_choice when no tools are passed', async () => {
    let capturedBody: any;
    const dummyFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
        }),
        { status: 200 },
      );
    };

    const provider = new DeepSeekProvider({ apiKey: 'key', fetchFn: dummyFetch });
    await provider.complete({
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.equal(capturedBody.tools, undefined);
    assert.equal(capturedBody.tool_choice, undefined);
  });

  it('throws descriptive error on HTTP 4xx/5xx failures', async () => {
    const errorFetch: typeof globalThis.fetch = async () => {
      return new Response('Invalid API Key', { status: 401 });
    };

    const provider = new DeepSeekProvider({ apiKey: 'bad-key', fetchFn: errorFetch });
    await assert.rejects(
      async () => {
        await provider.complete({
          messages: [{ role: 'user', content: 'hi' }],
        });
      },
      /DeepSeek API error HTTP 401: Invalid API Key/,
    );
  });
});

describe('MockLLMProvider', () => {
  it('records requests and shifts responses from FIFO queue', async () => {
    const mock = new MockLLMProvider();
    mock.enqueueResponse({
      content: 'first reply',
      toolCalls: [],
    });
    mock.enqueueResponse({
      content: 'second reply',
      toolCalls: [{ id: 'tc-1', name: 'call_me', argumentsJson: '{}' }],
    });

    const res1 = await mock.complete({
      messages: [{ role: 'user', content: 'msg 1' }],
    });
    assert.equal(res1.content, 'first reply');
    assert.equal(mock.calls.length, 1);

    const res2 = await mock.complete({
      messages: [{ role: 'user', content: 'msg 2' }],
    });
    assert.equal(res2.content, 'second reply');
    assert.equal(res2.toolCalls.length, 1);
    assert.equal(mock.calls.length, 2);

    // Default fallback when queue exhausted
    const res3 = await mock.complete({
      messages: [{ role: 'user', content: 'msg 3' }],
    });
    assert.equal(res3.content, 'Mock response');
    assert.equal(mock.calls.length, 3);
  });

  it('executes custom handler when provided', async () => {
    const mock = new MockLLMProvider();
    mock.setHandler((req) => ({
      content: `Echo: ${req.messages[0].content}`,
      toolCalls: [],
    }));

    const res = await mock.complete({
      messages: [{ role: 'user', content: 'custom prompt' }],
    });
    assert.equal(res.content, 'Echo: custom prompt');
  });
});

describe('composeCharacterMediaPrompt', () => {
  it('combines location, outfit, held items, intent and reference image when includeSelf is true', () => {
    const result = composeCharacterMediaPrompt({
      character: dummyCharacter,
      relationship: dummyRelationship,
      heldItems: ['温热的抹茶茶碗', '折扇'],
      actionIntent: '将茶碗轻放在案几上，抬头温柔微笑',
      includeSelf: true,
    });

    assert.ok(result.prompt.includes('角色：双炽'));
    assert.ok(result.prompt.includes('日式茶室'));
    assert.ok(result.prompt.includes('素黑羽织与雪白足袋'));
    assert.ok(result.prompt.includes('温热的抹茶茶碗、折扇'));
    assert.ok(result.prompt.includes('将茶碗轻放在案几上，抬头温柔微笑'));

    assert.equal(result.referenceImages.length, 1);
    assert.equal(result.referenceImages[0], dummyCharacter.referenceImageDataUrl);
  });

  it('does NOT include reference image or outfit when includeSelf is false (scenery photo)', () => {
    const result = composeCharacterMediaPrompt({
      character: dummyCharacter,
      relationship: dummyRelationship,
      heldItems: ['保温杯'],
      actionIntent: '茶室窗外的竹林特写，细雨中的青石小径',
      includeSelf: false,
    });

    // Scenery photo should not lock character face or outfit
    assert.equal(result.referenceImages.length, 0);
    assert.ok(!result.prompt.includes('素黑羽织'));
    assert.ok(!result.prompt.includes('角色：双炽'));
    assert.ok(result.prompt.includes('茶室窗外的竹林特写，细雨中的青石小径'));
    assert.ok(result.prompt.includes('日式茶室'));
  });

  it('handles empty referenceImageDataUrl gracefully when includeSelf is true', () => {
    const noRefChar = { ...dummyCharacter, referenceImageDataUrl: '' };
    const result = composeCharacterMediaPrompt({
      character: noRefChar,
      relationship: dummyRelationship,
      heldItems: [],
      actionIntent: '安静看书',
      includeSelf: true,
    });

    assert.equal(result.referenceImages.length, 0);
    assert.ok(result.prompt.includes('安静看书'));
  });
});

describe('VVdanceMediaProvider (Seedream & Seedance)', () => {
  it('generates Seedream image with correct POST url, auth header and payload', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    const dummyFetch: typeof globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          data: [{ url: 'https://vvdance-cdn.com/generated-img.jpg' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const provider = new VVdanceMediaProvider({
      seedreamBaseUrl: 'https://vvdance.ai',
      seedreamApiKey: 'seedream-test-token',
      fetchFn: dummyFetch,
    });

    const res = await provider.generateImage({
      prompt: '双炽在茶室静坐',
      referenceImages: ['data:image/jpeg;base64,ref1'],
    });

    assert.equal(res.ok, true);
    assert.equal(res.url, 'https://vvdance-cdn.com/generated-img.jpg');

    assert.equal(
      capturedUrl,
      'https://vvdance.ai/api/v3/images/generations',
    );
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer seedream-test-token');

    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.model, 'dola-seedream-5-0-pro-260628');
    assert.equal(body.prompt, '双炽在茶室静坐');
    assert.deepEqual(body.image, ['data:image/jpeg;base64,ref1']);
    assert.equal(body.size, '1K');
    assert.equal(body.response_format, 'url');
    assert.equal(body.stream, false);
    assert.equal(body.output_format, 'jpeg');
  });

  it('submits Seedance video task with structured content array containing reference_image role', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    const dummyFetch: typeof globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          data: { id: 'task-ark-9999' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const provider = new VVdanceMediaProvider({
      seedanceBaseUrl: 'https://vvdance.ai',
      seedanceApiToken: 'seedance-test-token',
      fetchFn: dummyFetch,
    });

    const res = await provider.submitVideoTask({
      prompt: '双炽端起茶杯轻抿一口',
      referenceImages: ['https://cdn.example.com/ref.png'],
      duration: 5,
      generateAudio: true,
    });

    assert.equal(res.ok, true);
    assert.equal(res.taskId, 'task-ark-9999');

    assert.equal(
      capturedUrl,
      'https://vvdance.ai/api/v3/contents/generations/ark/tasks',
    );
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer seedance-test-token');

    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.model, 'dreamina-seedance-2-0-mini-260615');
    assert.equal(body.ratio, '9:16');
    assert.equal(body.resolution, '720p');
    assert.equal(body.duration, 5);
    assert.equal(body.generate_audio, true);

    assert.equal(body.content.length, 2);
    assert.deepEqual(body.content[0], {
      type: 'text',
      text: '双炽端起茶杯轻抿一口',
    });
    assert.deepEqual(body.content[1], {
      type: 'image_url',
      role: 'reference_image',
      image_url: { url: 'https://cdn.example.com/ref.png' },
    });
  });

  it('polls Seedance video task status correctly for succeeded and running states', async () => {
    let callCount = 0;
    const dummyFetch: typeof globalThis.fetch = async (input) => {
      callCount++;
      assert.equal(
        String(input),
        'https://vvdance.ai/api/v3/contents/generations/tasks/task-ark-123',
      );
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            data: { status: 'running' },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            status: 'succeeded',
            content: { video_url: 'https://vvdance-cdn.com/final-video.mp4' },
          },
        }),
        { status: 200 },
      );
    };

    const provider = new VVdanceMediaProvider({
      seedanceApiToken: 'seedance-test-token',
      fetchFn: dummyFetch,
    });

    const status1 = await provider.getVideoTaskStatus('task-ark-123');
    assert.equal(status1.status, 'running');
    assert.equal(status1.videoUrl, undefined);

    const status2 = await provider.getVideoTaskStatus('task-ark-123');
    assert.equal(status2.status, 'succeeded');
    assert.equal(status2.videoUrl, 'https://vvdance-cdn.com/final-video.mp4');
  });

  it('handles Seedream and Seedance error responses cleanly without throwing unhandled exceptions', async () => {
    const dummyFetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/images/generations')) {
        return new Response(
          JSON.stringify({ error: { message: 'Seedream rate limited' } }),
          { status: 429 },
        );
      }
      return new Response(
        JSON.stringify({ error: { message: 'Seedance task failed' } }),
        { status: 500 },
      );
    };

    const provider = new VVdanceMediaProvider({
      seedreamApiKey: 'tok',
      seedanceApiToken: 'tok',
      fetchFn: dummyFetch,
    });

    const imgRes = await provider.generateImage({ prompt: 'test' });
    assert.equal(imgRes.ok, false);
    assert.ok(imgRes.error?.includes('429'));

    const vidRes = await provider.submitVideoTask({ prompt: 'test' });
    assert.equal(vidRes.ok, false);
    assert.ok(vidRes.error?.includes('500'));

    const pollRes = await provider.getVideoTaskStatus('failed-id');
    assert.equal(pollRes.status, 'failed');
    assert.ok(pollRes.error?.includes('500'));
  });
});

describe('MockMediaProvider', () => {
  it('records calls and returns mock image and video results', async () => {
    const mock = new MockMediaProvider();

    const imgRes = await mock.generateImage({ prompt: 'pic of fox' });
    assert.equal(imgRes.ok, true);
    assert.equal(imgRes.url, 'https://mock.media/image.jpg');
    assert.equal(mock.imageCalls.length, 1);
    assert.equal(mock.imageCalls[0].prompt, 'pic of fox');

    const vidRes = await mock.submitVideoTask({ prompt: 'video of fox' });
    assert.equal(vidRes.ok, true);
    assert.equal(vidRes.taskId, 'mock-task-123');
    assert.equal(mock.videoSubmissions.length, 1);

    const pollRes = await mock.getVideoTaskStatus('mock-task-123');
    assert.equal(pollRes.status, 'succeeded');
    assert.equal(pollRes.videoUrl, 'https://mock.media/video.mp4');
    assert.equal(mock.videoStatusQueries.length, 1);
  });

  it('supports custom handlers for testing edge conditions', async () => {
    const mock = new MockMediaProvider();
    mock.setImageHandler(() => ({ ok: false, error: 'simulated error' }));
    mock.setVideoSubmissionHandler(() => ({ ok: false, error: 'task queue full' }));
    mock.setVideoStatusHandler(() => ({ status: 'failed', error: 'render failed' }));

    const img = await mock.generateImage({ prompt: 'test' });
    assert.equal(img.ok, false);
    assert.equal(img.error, 'simulated error');

    const vid = await mock.submitVideoTask({ prompt: 'test' });
    assert.equal(vid.ok, false);
    assert.equal(vid.error, 'task queue full');

    const poll = await mock.getVideoTaskStatus('t-1');
    assert.equal(poll.status, 'failed');
    assert.equal(poll.error, 'render failed');
  });
});
