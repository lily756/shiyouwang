const fs = require("node:fs");
const dotenv = require("dotenv");
const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_API_BASE_URL = "https://api.minimaxi.com/v1";
const MINIMAX_H3_VIDEO_MODEL = "MiniMax-H3";
const IMAGE_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "4:3",
  "3:2",
  "2:3",
  "3:4",
  "9:16",
  "21:9",
]);
const VIDEO_V2_RATIOS = new Set([
  "adaptive",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
]);

function readEnvFile(envFile) {
  if (!envFile || !fs.existsSync(envFile)) {
    return {};
  }

  try {
    return dotenv.parse(fs.readFileSync(envFile, "utf8"));
  } catch (error) {
    throw new Error(`读取 MiniMax 配置文件失败：${error.message}`);
  }
}

function getValue(fileEnv, runtimeEnv, key, fallback = "") {
  if (Object.prototype.hasOwnProperty.call(fileEnv, key)) {
    return String(fileEnv[key] ?? "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(runtimeEnv, key)) {
    return String(runtimeEnv[key] ?? "").trim();
  }
  return fallback;
}

function parseBoolean(value, fallback) {
  if (value === "") {
    return fallback;
  }
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function parseOptionalInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function normalizeApiRootUrl(value) {
  return normalizeBaseUrl(value).replace(/\/v1$/i, "");
}

function normalizeAspectRatio(value, fallback = "1:1") {
  const normalized = String(value || "").trim();
  return IMAGE_ASPECT_RATIOS.has(normalized) ? normalized : fallback;
}

function normalizeVideoV2Ratio(value, fallback = "16:9") {
  const normalized = String(value || "").trim();
  return VIDEO_V2_RATIOS.has(normalized) ? normalized : fallback;
}

function normalizeVideoV2Duration(value, fallback = 5) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 4 && number <= 15 ? number : fallback;
}

function isMiniMaxH3VideoModel(model) {
  return String(model || "").trim() === MINIMAX_H3_VIDEO_MODEL;
}

function loadMiniMaxConfig({ envFile, runtimeEnv = process.env } = {}) {
  const fileEnv = readEnvFile(envFile);
  const value = (key, fallback = "") => getValue(fileEnv, runtimeEnv, key, fallback);
  const apiBaseUrl = normalizeBaseUrl(value("MINIMAX_API_BASE_URL", DEFAULT_API_BASE_URL));
  const nativeApiBaseUrl = normalizeBaseUrl(
    value("MINIMAX_NATIVE_API_BASE_URL", value("MINIMAX_API_BASE_URL", DEFAULT_API_BASE_URL)),
  );
  const videoV2ApiBaseUrl = value("MINIMAX_VIDEO_V2_API_BASE_URL")
    || normalizeApiRootUrl(nativeApiBaseUrl);

  return Object.freeze({
    apiKey: value("MINIMAX_API_KEY"),
    visionApiKey: value("MINIMAX_VISION_API_KEY"),
    apiBaseUrl,
    nativeApiBaseUrl,
    // Video Generation V2 is rooted at /v2, while the existing native
    // provider configuration points at /v1. Keep a separate root so H3 does
    // not accidentally request /v1/v2/video_generation.
    videoV2ApiBaseUrl: normalizeApiRootUrl(videoV2ApiBaseUrl),
    anthropicBaseUrl: normalizeBaseUrl(
      value("MINIMAX_ANTHROPIC_BASE_URL", "https://api.minimaxi.com/anthropic"),
    ),
    textModel: value("MINIMAX_TEXT_MODEL", "MiniMax-M2.7"),
    visionModel: value("MINIMAX_VISION_MODEL", value("MINIMAX_TEXT_MODEL", "MiniMax-M2.7")),
    maxTokens: parseOptionalInteger(value("MINIMAX_MAX_TOKENS", "8192")) || 8192,
    thinkingEnabled: parseBoolean(value("MINIMAX_THINKING_ENABLED", "false"), false),
    imageModel: value("MINIMAX_IMAGE_MODEL", "image-01"),
    imageAspectRatio: normalizeAspectRatio(value("MINIMAX_IMAGE_ASPECT_RATIO", "1:1")),
    imageWidth: parseOptionalInteger(value("MINIMAX_IMAGE_WIDTH")),
    imageHeight: parseOptionalInteger(value("MINIMAX_IMAGE_HEIGHT")),
    imagePromptOptimizer: parseBoolean(value("MINIMAX_IMAGE_PROMPT_OPTIMIZER", "false"), false),
    imageWatermark: parseBoolean(value("MINIMAX_IMAGE_WATERMARK", "false"), false),
    videoModel: value("MINIMAX_VIDEO_MODEL", "MiniMax-H3"),
    videoSubjectModel: value("MINIMAX_VIDEO_SUBJECT_MODEL", "S2V-01"),
    videoResolution: value("MINIMAX_VIDEO_RESOLUTION", "1080P"),
    videoDuration: parseOptionalInteger(value("MINIMAX_VIDEO_DURATION", "6")) || 6,
    videoWatermark: parseBoolean(value("MINIMAX_VIDEO_WATERMARK", "false"), false),
    audioModel: value("MINIMAX_AUDIO_MODEL", "speech-2.8-hd"),
    audioVoiceId: value("MINIMAX_AUDIO_VOICE_ID", "female-shaonv"),
    asmrVoiceId: value("MINIMAX_ASMR_VOICE_ID", "female-tianmei-jingpin"),
    audioLanguageBoost: value("MINIMAX_AUDIO_LANGUAGE_BOOST", "auto"),
    audioSampleRate: parseOptionalInteger(value("MINIMAX_AUDIO_SAMPLE_RATE", "44100")) || 44100,
    audioBitrate: parseOptionalInteger(value("MINIMAX_AUDIO_BITRATE", "256000")) || 256000,
    audioFormat: value("MINIMAX_AUDIO_FORMAT", "mp3") || "mp3",
    audioChannel: parseOptionalInteger(value("MINIMAX_AUDIO_CHANNEL", "2")) || 2,
    // Keep character speech comfortably quiet by default. The request-level
    // value is clamped to 1..5 below, so an accidental larger setting cannot
    // exceed the requested ceiling.
    audioVolume: Math.min(
      5,
      Math.max(1, parseOptionalInteger(value("MINIMAX_AUDIO_VOLUME", "3")) || 3),
    ),
    fileUploadPurpose: value("MINIMAX_FILE_UPLOAD_PURPOSE", "t2a_async_input"),
    fileMaxBytes: parseOptionalInteger(value("MINIMAX_FILE_MAX_BYTES", String(512 * 1024 * 1024))) || 512 * 1024 * 1024,
    voiceCloneMaxBytes: parseOptionalInteger(
      value("MINIMAX_VOICE_CLONE_MAX_BYTES", String(20 * 1024 * 1024)),
    ) || 20 * 1024 * 1024,
  });
}

function applyToOpenAICompatibleEnvironment(config, runtimeEnv = process.env) {
  // MiniMax's text and vision endpoints implement OpenAI Chat Completions.
  // Keep the rest of the application provider-agnostic by mapping only the
  // generic model client variables here. Native image/video calls below use
  // the dedicated MiniMax provider methods instead.
  runtimeEnv.OPENAI_API_KEY = config.apiKey;
  runtimeEnv.OPENAI_API_BASE_URL = config.apiBaseUrl;
  runtimeEnv.OPENAI_MODEL = config.textModel;
  runtimeEnv.OPENAI_VISION_API_KEY = config.visionApiKey || config.apiKey;
  runtimeEnv.OPENAI_VISION_API_BASE_URL = config.apiBaseUrl;
  runtimeEnv.OPENAI_VISION_MODEL = config.visionModel;
  runtimeEnv.OPENAI_THINKING_ENABLED = config.thinkingEnabled ? "true" : "false";
  runtimeEnv.IMAGE_PROVIDER = runtimeEnv.IMAGE_PROVIDER || "minimax";
  runtimeEnv.VIDEO_PROVIDER = runtimeEnv.VIDEO_PROVIDER || "minimax";
}

async function resolveImageReference(value, resolveImageReferenceUrl) {
  const normalized = String(value || "").trim();
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  if (!/^data:image\//i.test(normalized)) {
    return null;
  }

  if (typeof resolveImageReferenceUrl === "function") {
    const resolved = await resolveImageReferenceUrl(normalized);
    if (typeof resolved === "string" && /^https?:\/\//i.test(resolved)) {
      return resolved;
    }
  }

  // The public API documents image URLs, but accepting a data URL here keeps
  // the provider compatible with deployments that expose an HTTPS asset URL
  // only at request time. If the endpoint rejects it, the error body remains
  // visible in the provider log.
  return normalized;
}

function getErrorMessage(payload, rawBody) {
  return String(
    payload?.base_resp?.status_msg ||
      payload?.error?.message ||
      payload?.error_message ||
      rawBody ||
      "未知错误",
  ).slice(0, 400);
}

function createMiniMaxProvider({
  config,
  fetchImpl = globalThis.fetch,
  resolveImageReferenceUrl = null,
} = {}) {
  if (!config) {
    throw new Error("创建 MiniMax provider 时缺少配置。");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node.js 环境不支持 fetch，无法使用 MiniMax provider。");
  }

  const requestJson = async (path, { method = "GET", body, searchParams, baseUrl } = {}) => {
    const endpoint = new URL(`${baseUrl || config.nativeApiBaseUrl || config.apiBaseUrl}/${String(path).replace(/^\/+/, "")}`);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        endpoint.searchParams.set(key, String(value));
      }
    }

    const response = await fetchImpl(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(180_000),
    });
    const rawBody = await response.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(`MiniMax 请求失败（HTTP ${response.status}）：${getErrorMessage(payload, rawBody)}`);
    }
    if (
      payload?.base_resp &&
      payload.base_resp.status_code !== undefined &&
      Number(payload.base_resp.status_code) !== 0
    ) {
      throw new Error(`MiniMax 请求失败：${getErrorMessage(payload, rawBody)}`);
    }
    return payload;
  };

  const requestBinary = async (path, { searchParams } = {}) => {
    const endpoint = new URL(`${config.nativeApiBaseUrl || config.apiBaseUrl}/${String(path).replace(/^\/+/, "")}`);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        endpoint.searchParams.set(key, String(value));
      }
    }
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "audio/mpeg, audio/*, application/octet-stream, */*",
      },
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const rawBody = typeof response.text === "function" ? await response.text() : "";
      let payload = null;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        // The endpoint normally returns binary data; keep the raw response out
        // of the error unless it is a small JSON error body.
      }
      throw new Error(`MiniMax 文件下载失败（HTTP ${response.status}）：${getErrorMessage(payload, rawBody)}`);
    }
    if (typeof response.arrayBuffer !== "function") {
      throw new Error("MiniMax 文件下载响应不支持 arrayBuffer。");
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: String(response.headers?.get?.("content-type") || "application/octet-stream")
        .split(";", 1)[0]
        .trim()
        .toLowerCase(),
    };
  };

  const provider = {
    name: "minimax",
    config,
    isConfigured() {
      return Boolean(config.apiBaseUrl && config.apiKey);
    },
    applyToOpenAICompatibleEnvironment(runtimeEnv = process.env) {
      applyToOpenAICompatibleEnvironment(config, runtimeEnv);
    },
    async generateImage({ prompt, referenceImages = [], aspectRatio = "" } = {}) {
      if (!provider.isConfigured()) {
        return { ok: false, error: "未配置 MINIMAX_API_KEY，无法生成角色图片。" };
      }
      const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
      if (!normalizedPrompt || normalizedPrompt.length > 1_500) {
        return { ok: false, error: "MiniMax 图片提示词不能为空且不能超过 1500 个字符。" };
      }
      if (!Array.isArray(referenceImages) || referenceImages.length > 10) {
        return { ok: false, error: "MiniMax 图片生成最多支持 10 张人物参考图。" };
      }

      const resolvedReferences = [];
      for (const reference of referenceImages) {
        const resolved = await resolveImageReference(reference, resolveImageReferenceUrl);
        if (!resolved) {
          return { ok: false, error: "MiniMax 参考图必须是 HTTP(S) URL 或有效的图片 data URL。" };
        }
        resolvedReferences.push(resolved);
      }

      const effectiveAspectRatio = normalizeAspectRatio(
        aspectRatio || config.imageAspectRatio,
        config.imageAspectRatio,
      );
      const body = {
        model: config.imageModel,
        prompt: normalizedPrompt,
        aspect_ratio: effectiveAspectRatio,
        response_format: "base64",
        n: 1,
        prompt_optimizer: config.imagePromptOptimizer,
        aigc_watermark: config.imageWatermark,
      };
      if (resolvedReferences.length > 0) {
        body.subject_reference = resolvedReferences.map((imageFile) => ({
          type: "character",
          image_file: imageFile,
        }));
      }
      if (!aspectRatio && config.imageWidth && config.imageHeight) {
        body.width = config.imageWidth;
        body.height = config.imageHeight;
      }

      const payload = await requestJson("image_generation", { method: "POST", body });
      const imageBase64 = payload?.data?.image_base64?.[0];
      const imageUrl = payload?.data?.image_urls?.[0];
      if (typeof imageBase64 === "string" && imageBase64) {
        return { ok: true, b64Json: imageBase64 };
      }
      if (typeof imageUrl === "string" && imageUrl) {
        return { ok: true, url: imageUrl };
      }
      throw new Error("MiniMax 没有返回图片 URL 或 base64。");
    },
    async submitVideoTask({
      prompt,
      duration,
      ratio = "16:9",
      referenceImages = [],
      referenceVideos = [],
      videoMode = "r2v",
    } = {}) {
      if (!provider.isConfigured()) {
        return { ok: false, error: "未配置 MINIMAX_API_KEY，无法生成角色视频。" };
      }
      const isH3 = isMiniMaxH3VideoModel(config.videoModel);
      const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
      const maxPromptLength = isH3 ? 7_000 : 2_000;
      if (!normalizedPrompt || normalizedPrompt.length > maxPromptLength) {
        return {
          ok: false,
          error: `MiniMax 视频提示词不能为空且不能超过 ${maxPromptLength} 个字符。`,
        };
      }
      if (!isH3 && Array.isArray(referenceVideos) && referenceVideos.length > 0) {
        return {
          ok: false,
          error: "MiniMax 原生视频接口暂不接受视频参考片段；请仅使用图片主体参考。",
        };
      }

      const resolvedReferences = [];
      for (const reference of Array.isArray(referenceImages) ? referenceImages : []) {
        const resolved = await resolveImageReference(reference, resolveImageReferenceUrl);
        if (!resolved) {
          return { ok: false, error: "MiniMax 视频参考图必须是 HTTP(S) URL 或有效的图片 data URL。" };
        }
        resolvedReferences.push(resolved);
      }

      if (isH3) {
        if (!Array.isArray(referenceImages) || referenceImages.length > 9) {
          return { ok: false, error: "MiniMax-H3 最多支持 9 张参考图。" };
        }
        if (!Array.isArray(referenceVideos) || referenceVideos.length > 3) {
          return { ok: false, error: "MiniMax-H3 最多支持 3 段参考视频。" };
        }
        if (videoMode === "i2v" && resolvedReferences.length === 0) {
          return { ok: false, error: "MiniMax-H3 i2v 模式需要至少一张首帧参考图。" };
        }
        if (videoMode === "i2v" && resolvedReferences.length > 1) {
          return { ok: false, error: "MiniMax-H3 i2v 模式只支持一张首帧参考图。" };
        }
        if (videoMode === "i2v" && referenceVideos.length > 0) {
          return { ok: false, error: "MiniMax-H3 的首帧模式不能同时使用视频参考片段。" };
        }
        if (videoMode === "t2v" && (resolvedReferences.length > 0 || referenceVideos.length > 0)) {
          return { ok: false, error: "MiniMax-H3 t2v 模式不能携带参考素材，请改用 i2v 或 r2v。" };
        }

        const content = [{ type: "text", text: normalizedPrompt }];
        if (videoMode === "i2v") {
          content.push({
            type: "image_url",
            image_url: { url: resolvedReferences[0] },
            role: "first_frame",
          });
        } else if (videoMode === "r2v") {
          content.push(
            ...resolvedReferences.map((url) => ({
              type: "image_url",
              image_url: { url },
              role: "reference_image",
            })),
            ...referenceVideos.map((url) => ({
              type: "video_url",
              video_url: { url },
              role: "reference_video",
            })),
          );
        }

        const requestedRatio = normalizeVideoV2Ratio(ratio);
        const requestedDuration = Number(duration);
        const body = {
          model: MINIMAX_H3_VIDEO_MODEL,
          content,
          resolution: "2K",
          duration: normalizeVideoV2Duration(
            requestedDuration,
            normalizeVideoV2Duration(config.videoDuration),
          ),
          // H3 derives the framing from a first frame. Reference-based
          // generation may still use an explicit ratio chosen by the caller.
          ratio: videoMode === "i2v" ? "adaptive" : requestedRatio,
        };
        const payload = await requestJson("v2/video_generation", {
          method: "POST",
          body,
          baseUrl: config.videoV2ApiBaseUrl || normalizeApiRootUrl(config.nativeApiBaseUrl || config.apiBaseUrl),
        });
        const taskId = String(payload?.task_id || payload?.data?.task_id || "").trim();
        if (!taskId) {
          throw new Error("MiniMax-H3 没有返回视频任务 ID。" );
        }
        return {
          ok: true,
          taskId,
          resolution: body.resolution,
          duration: body.duration,
          ratio: body.ratio,
          roleReferenceUsed: resolvedReferences.length > 0,
          referenceImageCount: resolvedReferences.length,
          referenceVideoCount: referenceVideos.length,
          videoMode,
        };
      }

      const body = {
        model: videoMode === "r2v" && resolvedReferences.length > 0
          ? config.videoSubjectModel
          : config.videoModel,
        prompt: normalizedPrompt,
        resolution: config.videoResolution,
        prompt_optimizer: false,
        aigc_watermark: config.videoWatermark,
      };
      const requestedDuration = Number(duration);
      if (Number.isInteger(requestedDuration) && requestedDuration > 0) {
        body.duration = requestedDuration;
      } else {
        body.duration = config.videoDuration;
      }
      if (resolvedReferences.length > 0) {
        if (videoMode === "i2v") {
          body.first_frame_image = resolvedReferences[0];
        } else if (videoMode === "r2v") {
          body.subject_reference = [{
            type: "character",
            image: resolvedReferences,
          }];
        }
      } else if (videoMode === "i2v") {
        return { ok: false, error: "MiniMax i2v 模式需要至少一张首帧参考图。" };
      }

      const payload = await requestJson("video_generation", { method: "POST", body });
      const taskId = String(payload?.task_id || payload?.data?.task_id || "").trim();
      if (!taskId) {
        throw new Error("MiniMax 没有返回视频任务 ID。");
      }
      return {
        ok: true,
        taskId,
        resolution: body.resolution,
        duration: body.duration,
        ratio: "",
        roleReferenceUsed: resolvedReferences.length > 0,
        referenceImageCount: resolvedReferences.length,
        referenceVideoCount: 0,
        videoMode,
      };
    },
    async getVideoTask(taskId) {
      if (!taskId) {
        throw new Error("缺少 MiniMax 视频任务 ID。");
      }

      if (isMiniMaxH3VideoModel(config.videoModel)) {
        const payload = await requestJson(`v2/query/video_generation/${encodeURIComponent(taskId)}`, {
          baseUrl: config.videoV2ApiBaseUrl || normalizeApiRootUrl(config.nativeApiBaseUrl || config.apiBaseUrl),
        });
        const task = payload?.task && typeof payload.task === "object" ? payload.task : payload;
        const rawStatus = String(task?.status || "").toLowerCase();
        const status = rawStatus === "success"
          ? "succeeded"
          : ["failed", "cancelled", "canceled", "expired"].includes(rawStatus)
            ? "failed"
            : rawStatus;
        return {
          status,
          videoUrl: typeof task?.content?.url === "string" ? task.content.url : "",
          error: String(task?.error?.message || task?.error?.code || payload?.error_message || ""),
        };
      }

      const payload = await requestJson("query/video_generation", {
        searchParams: { task_id: taskId },
      });
      const rawStatus = String(payload?.status || "").toLowerCase();
      const status = rawStatus === "success"
        ? "succeeded"
        : ["fail", "failed", "cancelled", "canceled"].includes(rawStatus)
          ? "failed"
          : rawStatus;
      let videoUrl = "";
      if (status === "succeeded" && payload?.file_id) {
        const filePayload = await requestJson("files/retrieve", {
          searchParams: { file_id: payload.file_id },
        });
        videoUrl = typeof filePayload?.file?.download_url === "string"
          ? filePayload.file.download_url
          : "";
      }
      return {
        status,
        videoUrl,
        error: String(payload?.base_resp?.status_msg || payload?.error_message || ""),
      };
    },
    createAnthropicClient() {
      if (!config.apiKey) {
        return null;
      }
      return new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.anthropicBaseUrl,
        maxRetries: 2,
      });
    },
    async listVoices({ voiceType = "all" } = {}) {
      const allowed = new Set(["all", "system", "voice_cloning", "voice_generation"]);
      const type = allowed.has(String(voiceType)) ? String(voiceType) : "all";
      return requestJson("get_voice", { method: "POST", body: { voice_type: type } });
    },
    async cloneVoice({
      fileId,
      voiceId,
      promptAudioFileId,
      promptText,
      previewText = "你好呀，我是你的专属角色，很高兴用这个声音和你聊天。",
      model,
      textValidation = "",
      accuracy,
      needNoiseReduction = false,
      needVolumeNormalization = false,
      aigcWatermark = false,
    } = {}) {
      if (!provider.isConfigured()) {
        return { ok: false, error: "未配置 MINIMAX_API_KEY，无法创建克隆音色。" };
      }
      const normalizedFileId = Number(fileId);
      if (!Number.isInteger(normalizedFileId) || normalizedFileId <= 0) {
        return { ok: false, error: "缺少有效的 voice_clone 文件 ID。" };
      }
      const normalizedVoiceId = String(voiceId || "").trim();
      if (
        normalizedVoiceId.length < 8 ||
        normalizedVoiceId.length > 256 ||
        !/^[A-Za-z][A-Za-z0-9_-]*[A-Za-z0-9]$/.test(normalizedVoiceId)
      ) {
        return { ok: false, error: "自定义 voice_id 必须以英文字母开头、以字母或数字结尾，只能包含字母、数字、-、_，长度 8～256。" };
      }
      const normalizedPreviewText = String(previewText || "").trim();
      if (normalizedPreviewText.length > 1_000) {
        return { ok: false, error: "音色试听文本不能超过 1000 个字符。" };
      }
      const normalizedTextValidation = typeof textValidation === "string"
        ? textValidation.trim()
        : "";
      if (normalizedTextValidation.length > 200) {
        return { ok: false, error: "text_validation 不能超过 200 个字符。" };
      }

      const clonePrompt = {};
      if (promptAudioFileId !== undefined && promptAudioFileId !== null && String(promptAudioFileId).trim()) {
        const normalizedPromptAudioFileId = Number(promptAudioFileId);
        if (!Number.isInteger(normalizedPromptAudioFileId) || normalizedPromptAudioFileId <= 0) {
          return { ok: false, error: "prompt_audio 文件 ID 无效。" };
        }
        clonePrompt.prompt_audio = normalizedPromptAudioFileId;
        clonePrompt.prompt_text = String(promptText || "").trim();
        if (!clonePrompt.prompt_text) {
          return { ok: false, error: "使用 prompt_audio 时必须同时提供 prompt_text。" };
        }
      }

      const body = {
        file_id: normalizedFileId,
        voice_id: normalizedVoiceId,
        ...(Object.keys(clonePrompt).length > 0 ? { clone_prompt: clonePrompt } : {}),
        text: normalizedPreviewText,
        model: model || config.audioModel,
        ...(normalizedTextValidation ? { text_validation: normalizedTextValidation } : {}),
        ...(Number.isFinite(Number(accuracy)) ? { accuracy: Number(accuracy) } : {}),
        need_noise_reduction: needNoiseReduction === true,
        need_volume_normalization: needVolumeNormalization === true,
        aigc_watermark: aigcWatermark === true,
      };
      const payload = await requestJson("voice_clone", { method: "POST", body });
      return {
        ok: true,
        voiceId: normalizedVoiceId,
        demoAudio: String(payload?.demo_audio || payload?.data?.demo_audio || ""),
        inputSensitive: payload?.input_sensitive === true,
        payload,
      };
    },
    async createAudioTask({
      text,
      textFileId,
      voiceId,
      model,
      languageBoost,
      speed = 1,
      vol,
      pitch = 1,
      sampleRate,
      bitrate,
      format,
      channel,
      voiceModify,
    } = {}) {
      if (!provider.isConfigured()) {
        return { ok: false, error: "未配置 MINIMAX_API_KEY，无法生成语音。" };
      }
      const normalizedText = typeof text === "string" ? text.trim() : "";
      if (!normalizedText && !textFileId) {
        return { ok: false, error: "语音内容不能为空。" };
      }
      if (normalizedText.length > 100_000) {
        return { ok: false, error: "单条语音文本不能超过 100000 个字符。" };
      }
      const requestedVolume = Number(vol);
      const audioVolume = Number.isFinite(requestedVolume) && requestedVolume > 0
        ? Math.min(5, Math.max(1, Math.round(requestedVolume)))
        : Number(config.audioVolume) || 3;
      const body = {
        model: model || config.audioModel,
        ...(textFileId ? { text_file_id: textFileId } : { text: normalizedText }),
        language_boost: languageBoost || config.audioLanguageBoost,
        voice_setting: {
          voice_id: voiceId || config.audioVoiceId,
          speed: Number(speed) || 1,
          vol: audioVolume,
          pitch: Number(pitch) || 1,
        },
        audio_setting: {
          audio_sample_rate: Number(sampleRate) || config.audioSampleRate,
          bitrate: Number(bitrate) || config.audioBitrate,
          format: format || config.audioFormat,
          channel: Number(channel) || config.audioChannel,
        },
      };
      if (voiceModify && typeof voiceModify === "object") {
        body.voice_modify = voiceModify;
      }
      const payload = await requestJson("t2a_async_v2", { method: "POST", body });
      const taskId = String(payload?.task_id || payload?.data?.task_id || "").trim();
      if (!taskId) {
        throw new Error("MiniMax 没有返回语音任务 ID。");
      }
      return { ok: true, taskId, voiceId: body.voice_setting.voice_id, model: body.model };
    },
    async getAudioTask(taskId) {
      if (!taskId) {
        throw new Error("缺少 MiniMax 语音任务 ID。");
      }
      const payload = await requestJson("query/t2a_async_query_v2", {
        searchParams: { task_id: taskId },
      });
      const rawStatus = String(payload?.status || payload?.data?.status || "").toLowerCase();
      const status = ["success", "succeeded", "completed", "2"].includes(rawStatus)
        ? "succeeded"
        : ["fail", "failed", "error", "cancelled", "canceled"].includes(rawStatus)
          ? "failed"
          : rawStatus || "processing";
      const fileId = payload?.file_id || payload?.data?.file_id;
      let audioUrl = "";
      let audioBuffer = null;
      let audioMimeType = "audio/mpeg";
      if (status === "succeeded" && fileId) {
        const filePayload = await requestJson("files/retrieve", {
          searchParams: { file_id: fileId },
        });
        audioUrl = String(filePayload?.file?.download_url || filePayload?.download_url || "");
        const downloaded = await requestBinary("files/retrieve_content", {
          searchParams: { file_id: fileId },
        });
        audioBuffer = downloaded.buffer;
        audioMimeType = downloaded.mimeType || audioMimeType;
      }
      return {
        status,
        fileId: fileId ? String(fileId) : "",
        audioUrl,
        audioBuffer,
        audioMimeType,
        error: String(payload?.base_resp?.status_msg || payload?.error_message || ""),
      };
    },
    async uploadFile({
      buffer,
      filename = "telegram-file",
      mimeType = "application/octet-stream",
      purpose,
      maxBytes = config.fileMaxBytes,
    } = {}) {
      if (!provider.isConfigured()) {
        return { ok: false, error: "未配置 MINIMAX_API_KEY，无法上传文件。" };
      }
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { ok: false, error: "文件内容为空。" };
      }
      const effectiveMaxBytes = Number.isInteger(Number(maxBytes)) && Number(maxBytes) > 0
        ? Number(maxBytes)
        : config.fileMaxBytes;
      if (buffer.length > effectiveMaxBytes) {
        return { ok: false, error: `文件超过 ${Math.floor(effectiveMaxBytes / 1024 / 1024)} MB 限制。` };
      }
      if (typeof FormData !== "function" || typeof Blob !== "function") {
        return { ok: false, error: "当前 Node.js 不支持 multipart 文件上传。" };
      }
      const form = new FormData();
      form.append("purpose", purpose || config.fileUploadPurpose);
      form.append("file", new Blob([buffer], { type: mimeType }), filename);
      const endpoint = new URL(`${config.nativeApiBaseUrl || config.apiBaseUrl}/files/upload`);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const rawBody = await response.text();
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = null;
      }
      if (!response.ok || (payload?.base_resp && Number(payload.base_resp.status_code) !== 0)) {
        throw new Error(`MiniMax 文件上传失败（HTTP ${response.status}）：${getErrorMessage(payload, rawBody)}`);
      }
      const file = payload?.file || payload?.data?.file || payload?.data;
      const fileId = file?.file_id || payload?.file_id;
      if (!fileId) {
        throw new Error("MiniMax 没有返回文件 ID。");
      }
      return { ok: true, file: { ...(file || {}), file_id: String(fileId) } };
    },
    async listFiles({ purpose = "" } = {}) {
      const allowed = new Set(["voice_clone", "prompt_audio", "t2a_async_input"]);
      const searchParams = allowed.has(String(purpose)) ? { purpose } : undefined;
      const payload = await requestJson("files/list", { searchParams });
      return Array.isArray(payload?.files) ? payload.files : [];
    },
    async retrieveFile(fileId) {
      if (!fileId) throw new Error("缺少文件 ID。");
      return requestJson("files/retrieve", { searchParams: { file_id: fileId } });
    },
    async downloadFileContent(fileId) {
      if (!fileId) throw new Error("缺少文件 ID。");
      return requestBinary("files/retrieve_content", { searchParams: { file_id: fileId } });
    },
    async deleteFile({ fileId, purpose } = {}) {
      if (!fileId) return { ok: false, error: "缺少文件 ID。" };
      const payload = await requestJson("files/delete", {
        method: "POST",
        body: { file_id: fileId, ...(purpose ? { purpose } : {}) },
      });
      return { ok: true, payload };
    },
  };

  return provider;
}

module.exports = {
  DEFAULT_API_BASE_URL,
  MINIMAX_H3_VIDEO_MODEL,
  createMiniMaxProvider,
  isMiniMaxH3VideoModel,
  loadMiniMaxConfig,
  normalizeAspectRatio,
  normalizeVideoV2Duration,
  normalizeVideoV2Ratio,
};
