/**
 * Character OS v2 — Media Provider
 * 南向多模态媒体服务对接 (VVdance: Seedream 图片 + Seedance 视频 与 MockProvider)
 */

import type {
  Character,
  CharacterRelationship,
  ImageGenerationRequest,
  ImageGenerationResult,
  MediaProvider,
  VideoGenerationRequest,
  VideoTaskPollResult,
  VideoTaskSubmissionResult,
} from '../shared/types.ts';

export interface ComposeMediaPromptParams {
  character: Character;
  relationship: CharacterRelationship;
  heldItems: string[];
  actionIntent: string;
  includeSelf: boolean;
}

export interface ComposedMediaPromptResult {
  prompt: string;
  referenceImages: string[];
}

/**
 * 自动结合角色当前地点、环境、穿着、手持物品与动作意图构图。
 * includeSelf=true 时自动携带角色底图锁脸；false 时仅保留场景氛围与物品意图。
 */
export function composeCharacterMediaPrompt(
  params: ComposeMediaPromptParams,
): ComposedMediaPromptResult {
  const { character, relationship, heldItems, actionIntent, includeSelf } = params;

  if (includeSelf) {
    const parts: string[] = [];
    if (character.name) parts.push(`角色：${character.name}`);
    const scene = [relationship.currentLocation, relationship.currentSceneDesc].filter(Boolean);
    if (scene.length > 0) parts.push(`场景：${scene.join('，')}`);
    if (relationship.outfitDesc) parts.push(`穿着：${relationship.outfitDesc}`);
    if (heldItems.length > 0) parts.push(`手持物品：${heldItems.join('、')}`);
    if (actionIntent) parts.push(`动作意图：${actionIntent}`);

    const ref = character.referenceImageDataUrl?.trim();
    return {
      prompt: parts.join('；'),
      referenceImages: ref ? [ref] : [],
    };
  }

  const parts: string[] = [];
  const scene = [relationship.currentLocation, relationship.currentSceneDesc].filter(Boolean);
  if (scene.length > 0) parts.push(`场景与氛围：${scene.join('，')}`);
  if (actionIntent) parts.push(`画面内容：${actionIntent}`);

  return {
    prompt: parts.join('；'),
    referenceImages: [],
  };
}

export interface VVdanceMediaProviderOptions {
  seedreamBaseUrl?: string;
  seedreamApiKey?: string;
  seedreamModel?: string;
  seedreamImageSize?: string;
  seedanceBaseUrl?: string;
  seedanceApiToken?: string;
  seedanceVideoModel?: string;
  seedanceResolution?: string;
  seedanceRatio?: string;
  fetchFn?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class VVdanceMediaProvider implements MediaProvider {
  public readonly name: string = 'vvdance';
  private seedreamBaseUrl: string;
  private seedreamApiKey: string;
  private seedreamModel: string;
  private seedreamImageSize: string;
  private seedanceBaseUrl: string;
  private seedanceApiToken: string;
  private seedanceVideoModel: string;
  private seedanceResolution: string;
  private seedanceRatio: string;
  private fetchFn: typeof globalThis.fetch;
  private timeoutMs: number;

  constructor(options: VVdanceMediaProviderOptions = {}) {
    this.seedreamBaseUrl = options.seedreamBaseUrl ?? 'https://vvdance.ai';
    this.seedreamApiKey = options.seedreamApiKey ?? (process.env.SEEDREAM_API_KEY || '');
    this.seedreamModel = options.seedreamModel ?? 'dola-seedream-5-0-pro-260628';
    this.seedreamImageSize = options.seedreamImageSize ?? '1K';
    this.seedanceBaseUrl = options.seedanceBaseUrl ?? 'https://vvdance.ai';
    this.seedanceApiToken = options.seedanceApiToken ?? (process.env.SEEDANCE_API_TOKEN || process.env.SEEDANCE_API_KEY || '');
    this.seedanceVideoModel = options.seedanceVideoModel ?? 'dreamina-seedance-2-0-mini-260615';
    this.seedanceResolution = options.seedanceResolution ?? '720p';
    this.seedanceRatio = options.seedanceRatio ?? '9:16';
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  public async generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const cleanBase = this.seedreamBaseUrl.replace(/\/+$/, '');
    const url = `${cleanBase}/api/v3/images/generations`;

    const body: Record<string, unknown> = {
      model: this.seedreamModel,
      prompt: request.prompt,
      ...(request.referenceImages?.length ? { image: request.referenceImages } : {}),
      size: this.seedreamImageSize,
      response_format: 'url',
      stream: false,
      output_format: 'jpeg',
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.seedreamApiKey) headers['Authorization'] = `Bearer ${this.seedreamApiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `Seedream API error HTTP ${res.status}: ${errText}` };
      }

      const payload = (await res.json()) as {
        data?: Array<{ url?: string }>;
        error?: { message?: string } | string;
      };

      const imageUrl = payload.data?.[0]?.url;
      if (!imageUrl) {
        const errorMsg = typeof payload.error === 'string'
          ? payload.error
          : payload.error?.message || 'No image URL returned by Seedream';
        return { ok: false, error: errorMsg };
      }

      return { ok: true, url: imageUrl };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Seedream request failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  public async submitVideoTask(
    request: VideoGenerationRequest,
  ): Promise<VideoTaskSubmissionResult> {
    const cleanBase = this.seedanceBaseUrl.replace(/\/+$/, '');
    const url = `${cleanBase}/api/v3/contents/generations/ark/tasks`;

    const content = [
      { type: 'text', text: request.prompt },
      ...(request.referenceImages || []).map((imgUrl) => ({
        type: 'image_url',
        role: 'reference_image',
        image_url: { url: imgUrl },
      })),
    ];

    const body = {
      model: this.seedanceVideoModel,
      content,
      ratio: request.ratio || this.seedanceRatio,
      resolution: this.seedanceResolution,
      duration: request.duration ?? -1,
      generate_audio: request.generateAudio ?? true,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.seedanceApiToken) headers['Authorization'] = `Bearer ${this.seedanceApiToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `Seedance task submission error HTTP ${res.status}: ${errText}` };
      }

      const payload = (await res.json()) as {
        data?: { id?: string; task_id?: string };
        id?: string;
        task_id?: string;
        error?: { message?: string } | string;
      };

      const taskId = payload.data?.id || payload.data?.task_id || payload.id || payload.task_id;
      if (!taskId) {
        const errorMsg = typeof payload.error === 'string'
          ? payload.error
          : payload.error?.message || 'No task ID returned by Seedance';
        return { ok: false, error: errorMsg };
      }

      return { ok: true, taskId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Seedance submission failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  public async getVideoTaskStatus(taskId: string): Promise<VideoTaskPollResult> {
    const cleanBase = this.seedanceBaseUrl.replace(/\/+$/, '');
    const url = `${cleanBase}/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`;

    const headers: Record<string, string> = {};
    if (this.seedanceApiToken) headers['Authorization'] = `Bearer ${this.seedanceApiToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { status: 'failed', error: `Seedance task query HTTP ${res.status}: ${errText}` };
      }

      const payload = (await res.json()) as {
        data?: { status?: string; content?: { video_url?: string }; video_url?: string; error?: unknown };
        status?: string;
        content?: { video_url?: string };
        video_url?: string;
        error?: unknown;
      };

      const task = payload.data ?? payload;
      const rawStatus = String(task.status ?? 'pending').toLowerCase();
      let status: 'pending' | 'running' | 'succeeded' | 'failed' = 'pending';

      if (rawStatus === 'succeeded' || rawStatus === 'success') {
        status = 'succeeded';
      } else if (rawStatus === 'running' || rawStatus === 'in_progress' || rawStatus === 'processing') {
        status = 'running';
      } else if (rawStatus === 'failed' || rawStatus === 'error') {
        status = 'failed';
      }

      const videoUrl = task.content?.video_url || task.video_url;
      const error = task.error
        ? (typeof task.error === 'string' ? task.error : JSON.stringify(task.error))
        : undefined;

      return { status, ...(videoUrl ? { videoUrl } : {}), ...(error ? { error } : {}) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failed', error: `Seedance task query failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type MockImageHandler = (
  req: ImageGenerationRequest,
) => Promise<ImageGenerationResult> | ImageGenerationResult;

export type MockVideoSubmissionHandler = (
  req: VideoGenerationRequest,
) => Promise<VideoTaskSubmissionResult> | VideoTaskSubmissionResult;

export type MockVideoStatusHandler = (
  taskId: string,
) => Promise<VideoTaskPollResult> | VideoTaskPollResult;

export class MockMediaProvider implements MediaProvider {
  public readonly name: string;
  public readonly imageCalls: ImageGenerationRequest[] = [];
  public readonly videoSubmissions: VideoGenerationRequest[] = [];
  public readonly videoStatusQueries: string[] = [];

  public nextImageUrl = 'https://mock.media/image.jpg';
  public nextTaskId = 'mock-task-123';
  public nextTaskStatus: VideoTaskPollResult = {
    status: 'succeeded',
    videoUrl: 'https://mock.media/video.mp4',
  };

  private imageHandler: MockImageHandler | null = null;
  private videoSubmissionHandler: MockVideoSubmissionHandler | null = null;
  private videoStatusHandler: MockVideoStatusHandler | null = null;

  constructor(options: { name?: string } = {}) {
    this.name = options.name ?? 'mock-media';
  }

  public setImageHandler(handler: MockImageHandler | null): void {
    this.imageHandler = handler;
  }

  public setVideoSubmissionHandler(handler: MockVideoSubmissionHandler | null): void {
    this.videoSubmissionHandler = handler;
  }

  public setVideoStatusHandler(handler: MockVideoStatusHandler | null): void {
    this.videoStatusHandler = handler;
  }

  public async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    this.imageCalls.push(request);
    return this.imageHandler ? await this.imageHandler(request) : { ok: true, url: this.nextImageUrl };
  }

  public async submitVideoTask(request: VideoGenerationRequest): Promise<VideoTaskSubmissionResult> {
    this.videoSubmissions.push(request);
    return this.videoSubmissionHandler
      ? await this.videoSubmissionHandler(request)
      : { ok: true, taskId: this.nextTaskId };
  }

  public async getVideoTaskStatus(taskId: string): Promise<VideoTaskPollResult> {
    this.videoStatusQueries.push(taskId);
    return this.videoStatusHandler
      ? await this.videoStatusHandler(taskId)
      : this.nextTaskStatus;
  }
}
