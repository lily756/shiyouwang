const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMiniMaxProvider,
  loadMiniMaxConfig,
} = require("../lib/minimax-provider");

function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("loads MiniMax config and maps it to generic OpenAI variables", () => {
  const config = loadMiniMaxConfig({
    runtimeEnv: {
      MINIMAX_API_KEY: "key",
      MINIMAX_API_BASE_URL: "https://api.minimaxi.com/v1/",
      MINIMAX_TEXT_MODEL: "MiniMax-M2.7",
      MINIMAX_VISION_MODEL: "MiniMax-M2.7",
    },
  });
  assert.equal(config.audioSampleRate, 44100);
  assert.equal(config.audioBitrate, 256000);
  assert.equal(config.audioChannel, 2);
  assert.equal(config.audioVolume, 3);
  assert.equal(config.asmrVoiceId, "female-tianmei-jingpin");
  assert.equal(config.voiceCloneMaxBytes, 20 * 1024 * 1024);
  const env = {};
  const provider = createMiniMaxProvider({
    config,
    fetchImpl: async () => jsonResponse({}),
  });

  provider.applyToOpenAICompatibleEnvironment(env);
  assert.equal(provider.isConfigured(), true);
  assert.equal(env.OPENAI_API_KEY, "key");
  assert.equal(env.OPENAI_API_BASE_URL, "https://api.minimaxi.com/v1");
  assert.equal(env.OPENAI_MODEL, "MiniMax-M2.7");
  assert.equal(env.OPENAI_VISION_MODEL, "MiniMax-M2.7");
  assert.equal(env.IMAGE_PROVIDER, "minimax");
  assert.equal(config.videoV2ApiBaseUrl, "https://api.minimaxi.com");
});

test("uses native MiniMax image generation and resolves local reference URLs", async () => {
  const requests = [];
  const provider = createMiniMaxProvider({
    config: {
      apiKey: "key",
      apiBaseUrl: "https://api.minimaxi.com/v1",
      imageModel: "image-01",
      imageAspectRatio: "1:1",
      imagePromptOptimizer: false,
      imageWatermark: false,
    },
    resolveImageReferenceUrl: async () => "https://assets.example/reference.png",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse({ data: { image_base64: ["aGVsbG8="] }, base_resp: { status_code: 0 } });
    },
  });

  const result = await provider.generateImage({
    prompt: "一个人在窗边喝茶",
    referenceImages: ["data:image/png;base64,AAAA"],
    aspectRatio: "9:16",
  });
  assert.deepEqual(result, { ok: true, b64Json: "aGVsbG8=" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.minimaxi.com/v1/image_generation");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.model, "image-01");
  assert.equal(body.aspect_ratio, "9:16");
  assert.deepEqual(body.subject_reference, [
    { type: "character", image_file: "https://assets.example/reference.png" },
  ]);
});

test("submits native subject-reference video and retrieves the downloaded file URL", async () => {
  const requests = [];
  const provider = createMiniMaxProvider({
    config: {
      apiKey: "key",
      apiBaseUrl: "https://api.minimaxi.com/v1",
      videoModel: "MiniMax-Hailuo-2.3",
      videoSubjectModel: "S2V-01",
      videoResolution: "1080P",
      videoDuration: 6,
      videoWatermark: false,
    },
    resolveImageReferenceUrl: async () => "https://assets.example/role.png",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("query/video_generation")) {
        return jsonResponse({ status: "Success", file_id: "file-1" });
      }
      if (String(url).includes("video_generation")) {
        return jsonResponse({ task_id: "task-1", base_resp: { status_code: 0 } });
      }
      return jsonResponse({ file: { download_url: "https://assets.example/video.mp4" } });
    },
  });

  const submitted = await provider.submitVideoTask({
    prompt: "角色在雨夜街头抬头微笑",
    duration: -1,
    referenceImages: ["data:image/png;base64,AAAA"],
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.taskId, "task-1");
  const submittedBody = JSON.parse(requests[0].options.body);
  assert.equal(submittedBody.model, "S2V-01");
  assert.deepEqual(submittedBody.subject_reference, [
    { type: "character", image: ["https://assets.example/role.png"] },
  ]);

  const task = await provider.getVideoTask("task-1");
  assert.deepEqual(task, {
    status: "succeeded",
    videoUrl: "https://assets.example/video.mp4",
    error: "",
  });
  assert.equal(requests[1].url, "https://api.minimaxi.com/v1/query/video_generation?task_id=task-1");
  assert.equal(requests[2].url, "https://api.minimaxi.com/v1/files/retrieve?file_id=file-1");
});

test("submits and polls MiniMax-H3 through Video Generation V2", async () => {
  const requests = [];
  const provider = createMiniMaxProvider({
    config: {
      apiKey: "key",
      apiBaseUrl: "https://api.minimaxi.com/v1",
      nativeApiBaseUrl: "https://api.minimaxi.com/v1",
      videoV2ApiBaseUrl: "https://api.minimaxi.com",
      videoModel: "MiniMax-H3",
      videoDuration: 6,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("/v2/query/video_generation/")) {
        return jsonResponse({
          task: {
            id: "h3-task-1",
            status: "succeeded",
            content: { url: "https://assets.example/h3.mp4" },
          },
        });
      }
      return jsonResponse({ task_id: "h3-task-1" });
    },
  });

  const submitted = await provider.submitVideoTask({
    prompt: "角色沿着海边向前走，镜头平稳跟拍",
    duration: 8,
    ratio: "9:16",
    referenceImages: ["data:image/png;base64,AAAA"],
    referenceVideos: ["data:video/mp4;base64,AAAA"],
    videoMode: "r2v",
  });
  assert.deepEqual(submitted, {
    ok: true,
    taskId: "h3-task-1",
    resolution: "2K",
    duration: 8,
    ratio: "9:16",
    roleReferenceUsed: true,
    referenceImageCount: 1,
    referenceVideoCount: 1,
    videoMode: "r2v",
  });

  assert.equal(requests[0].url, "https://api.minimaxi.com/v2/video_generation");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.model, "MiniMax-H3");
  assert.equal(body.resolution, "2K");
  assert.equal(body.duration, 8);
  assert.equal(body.ratio, "9:16");
  assert.deepEqual(body.content, [
    { type: "text", text: "角色沿着海边向前走，镜头平稳跟拍" },
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
      role: "reference_image",
    },
    {
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,AAAA" },
      role: "reference_video",
    },
  ]);

  const task = await provider.getVideoTask("h3-task-1");
  assert.deepEqual(task, {
    status: "succeeded",
    videoUrl: "https://assets.example/h3.mp4",
    error: "",
  });
  assert.equal(requests[1].url, "https://api.minimaxi.com/v2/query/video_generation/h3-task-1");
});

test("creates async T2A task and queries the returned audio file", async () => {
  const requests = [];
  const provider = createMiniMaxProvider({
    config: {
      apiKey: "key",
      apiBaseUrl: "https://api.minimaxi.com/v1",
      nativeApiBaseUrl: "https://api.minimaxi.com/v1",
      audioModel: "speech-2.8-hd",
      audioVoiceId: "female-shaonv",
      audioLanguageBoost: "auto",
      audioSampleRate: 44100,
      audioBitrate: 256000,
      audioFormat: "mp3",
      audioChannel: 2,
      audioVolume: 3,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("query/t2a_async_query_v2")) {
        return jsonResponse({ status: "Success", file_id: "audio-file-1" });
      }
      if (String(url).includes("files/retrieve")) {
        if (String(url).includes("retrieve_content")) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => "audio/mpeg" },
            async arrayBuffer() {
              return Buffer.from("audio");
            },
          };
        }
        return jsonResponse({ file: { download_url: "https://assets.example/audio.mp3" } });
      }
      return jsonResponse({ task_id: "audio-task-1", base_resp: { status_code: 0 } });
    },
  });
  const created = await provider.createAudioTask({ text: "你好呀", voiceId: "female-shaonv" });
  assert.deepEqual(created, { ok: true, taskId: "audio-task-1", voiceId: "female-shaonv", model: "speech-2.8-hd" });
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.voice_setting.voice_id, "female-shaonv");
  assert.equal(body.voice_setting.vol, 3);
  assert.equal(body.audio_setting.audio_sample_rate, 44100);
  assert.equal(body.audio_setting.bitrate, 256000);
  assert.equal(body.audio_setting.channel, 2);
  const result = await provider.getAudioTask("audio-task-1");
  assert.deepEqual(result, {
    status: "succeeded",
    fileId: "audio-file-1",
    audioUrl: "https://assets.example/audio.mp3",
    audioBuffer: Buffer.from("audio"),
    audioMimeType: "audio/mpeg",
    error: "",
  });
});

test("creates a MiniMax cloned voice from a voice_clone file", async () => {
  const requests = [];
  const provider = createMiniMaxProvider({
    config: {
      apiKey: "key",
      apiBaseUrl: "https://api.minimaxi.com/v1",
      nativeApiBaseUrl: "https://api.minimaxi.com/v1",
      audioModel: "speech-2.8-hd",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse({
        input_sensitive: false,
        demo_audio: "https://assets.example/demo.mp3",
        base_resp: { status_code: 0 },
      });
    },
  });

  const result = await provider.cloneVoice({
    fileId: "123",
    voiceId: "clone-role-abc123",
    previewText: "你好，我是小白。",
  });
  assert.equal(result.ok, true);
  assert.equal(result.voiceId, "clone-role-abc123");
  assert.equal(result.demoAudio, "https://assets.example/demo.mp3");
  assert.equal(requests[0].url, "https://api.minimaxi.com/v1/voice_clone");
  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body, {
    file_id: 123,
    voice_id: "clone-role-abc123",
    text: "你好，我是小白。",
    model: "speech-2.8-hd",
    need_noise_reduction: false,
    need_volume_normalization: false,
    aigc_watermark: false,
  });
});
