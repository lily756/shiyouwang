"use strict";

const VIDEO_PRODUCTION_PIPELINE_TYPE = "video-production-pipeline";
const VIDEO_PRODUCTION_VERSION = 1;
const MAX_VIDEO_PRODUCTION_SHOTS = 8;
const MAX_VIDEO_PRODUCTION_ASSETS = 8;
const MAX_VIDEO_PRODUCTION_TEXT = 1_600;

const ASSET_KINDS = new Set([
  "scene",
  "prop",
  "character",
  "wardrobe",
  "vehicle",
  "other",
]);

function text(value, maxLength = MAX_VIDEO_PRODUCTION_TEXT) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function numberInRange(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeIdentifier(value, fallback) {
  const normalized = text(value, 80)
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next common model-output shape.
    }
  }
  return null;
}

function normalizeAsset(rawAsset, index, usedIds) {
  if (!rawAsset || typeof rawAsset !== "object") return null;
  const rawKind = text(rawAsset.kind || rawAsset.type, 30).toLowerCase();
  const kind = ASSET_KINDS.has(rawKind)
    ? rawKind
    : ({
        "场景": "scene",
        "环境": "scene",
        "道具": "prop",
        "物品": "prop",
        "人物": "character",
        "角色": "character",
        "服装": "wardrobe",
        "载具": "vehicle",
      }[rawKind] || "other");
  const baseId = normalizeIdentifier(
    rawAsset.id || rawAsset.assetId || rawAsset.name,
    `${kind}_${index + 1}`,
  );
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  const name = text(rawAsset.name || rawAsset.label || `${kind}${index + 1}`, 100);
  const prompt = text(
    rawAsset.prompt || rawAsset.description || rawAsset.visualDescription,
    1_200,
  );
  if (!prompt) return null;
  return {
    id,
    kind,
    name: name || id,
    prompt,
    required: rawAsset.required !== false,
    isCurrentRole: rawAsset.isCurrentRole === true
      || rawAsset.is_current_role === true
      || rawAsset.currentRole === true,
    status: "pending",
  };
}

function normalizeShot(rawShot, index, assetIds, fallbackDuration) {
  if (!rawShot || typeof rawShot !== "object") return null;
  const id = normalizeIdentifier(rawShot.id || rawShot.shotId, `shot_${index + 1}`);
  const duration = numberInRange(
    rawShot.duration || rawShot.durationSeconds,
    0.5,
    15,
    Math.max(1, fallbackDuration / Math.max(1, index + 1)),
  );
  const assetId = (value) => {
    const normalized = normalizeIdentifier(value, "");
    return normalized && assetIds.has(normalized) ? normalized : "";
  };
  const assetIdsFor = (value) => {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return [...new Set(values.map(assetId).filter(Boolean))].slice(0, 8);
  };
  return {
    id,
    duration: Number(duration.toFixed(2)),
    action: text(rawShot.action || rawShot.description || rawShot.event, 800),
    camera: text(rawShot.camera || rawShot.cameraMovement || rawShot.shot, 500),
    locationAssetId: assetId(
      rawShot.locationAssetId || rawShot.sceneAssetId || rawShot.scene,
    ),
    propAssetIds: assetIdsFor(rawShot.propAssetIds || rawShot.props),
    castAssetIds: assetIdsFor(rawShot.castAssetIds || rawShot.characters || rawShot.cast),
    transition: text(rawShot.transition, 240),
    audio: text(rawShot.audio || rawShot.sound || rawShot.dialogue, 500),
  };
}

function normalizeVideoProductionPlan(rawPlan, { fallbackDuration = 8 } = {}) {
  const parsed = parseJson(rawPlan);
  if (!parsed) return null;
  const rawAssets = Array.isArray(parsed.assets)
    ? parsed.assets
    : (Array.isArray(parsed.materials) ? parsed.materials : []);
  const usedIds = new Set();
  const assets = rawAssets
    .map((asset, index) => normalizeAsset(asset, index, usedIds))
    .filter(Boolean)
    .slice(0, MAX_VIDEO_PRODUCTION_ASSETS);
  const assetIds = new Set(assets.map((asset) => asset.id));
  const rawShots = Array.isArray(parsed.shots)
    ? parsed.shots
    : (Array.isArray(parsed.storyboard) ? parsed.storyboard : []);
  const shots = rawShots
    .map((shot, index) => normalizeShot(shot, index, assetIds, fallbackDuration))
    .filter((shot) => shot && shot.action)
    .slice(0, MAX_VIDEO_PRODUCTION_SHOTS);
  if (shots.length === 0) return null;
  const requestedDuration = numberInRange(
    parsed.duration || parsed.durationSeconds,
    4,
    15,
    fallbackDuration,
  );
  return {
    version: VIDEO_PRODUCTION_VERSION,
    title: text(parsed.title || parsed.name, 120) || "未命名短片",
    logline: text(parsed.logline || parsed.summary || parsed.story, 500),
    visualStyle: text(parsed.visualStyle || parsed.style, 500),
    duration: Number(requestedDuration.toFixed(2)),
    shots,
    assets,
    notes: text(parsed.notes || parsed.planningNotes, 500),
  };
}

function buildFallbackVideoProductionPlan({
  prompt,
  role = null,
  roleState = null,
  duration = 8,
} = {}) {
  const requestedPrompt = text(prompt, 1_200) || "一段自然、连贯的生活短片";
  const location = text(roleState?.location, 100) || "自然环境";
  const environment = text(roleState?.environment, 220) || "光线自然、细节真实的环境";
  const activity = text(roleState?.activity, 180) || requestedPrompt;
  const assets = [
    {
      id: "scene_1",
      kind: "scene",
      name: location,
      prompt: `生成视频所需的场景素材：${location}，${environment}。纯场景构图，不出现人物，不出现文字、水印或 Logo。`,
      required: true,
      isCurrentRole: false,
    },
  ];
  if (role?.name) {
    assets.push({
      id: "character_current_role",
      kind: "character",
      name: role.name,
      prompt: `视频中出场的当前角色「${text(role.name, 64)}」：根据角色设定保持身份和外观稳定，围绕“${requestedPrompt}”完成动作。不要新增其他主要人物。`,
      required: true,
      isCurrentRole: true,
    });
  }
  const plan = normalizeVideoProductionPlan({
    title: "生活短片",
    logline: requestedPrompt,
    duration,
    assets,
    shots: [{
      id: "shot_1",
      duration,
      action: `${activity}。${requestedPrompt}`,
      camera: "先以稳定的中近景交代环境，再平滑跟随主体动作，结尾自然停住。",
      scene: "scene_1",
      cast: role?.name ? ["character_current_role"] : [],
      props: [],
      audio: "保留自然环境声；如有对白，只说与动作直接相关的简短一句。",
    }],
  }, { fallbackDuration: duration });
  return plan || {
    version: VIDEO_PRODUCTION_VERSION,
    title: "生活短片",
    logline: requestedPrompt,
    visualStyle: "自然、连贯、稳定",
    duration: numberInRange(duration, 4, 15, 8),
    assets: [],
    shots: [{
      id: "shot_1",
      duration: numberInRange(duration, 4, 15, 8),
      action: requestedPrompt,
      camera: "稳定的中景，动作连贯。",
      locationAssetId: "",
      propAssetIds: [],
      castAssetIds: [],
      transition: "",
      audio: "自然环境声。",
    }],
    notes: "使用了视频制作兜底分镜。",
  };
}

function buildVideoPromptFromPlan({
  plan,
  assetManifest = [],
  originalPrompt = "",
} = {}) {
  if (!plan || !Array.isArray(plan.shots) || plan.shots.length === 0) {
    return text(originalPrompt, 6_800);
  }
  const assetById = new Map(assetManifest.map((asset) => [asset.assetId || asset.id, asset]));
  const materialLines = assetManifest
    .filter((asset) => asset.referenceIndex)
    .map((asset) => `参考图${asset.referenceIndex}：${asset.name}（${asset.kind}）`)
    .join("；");
  const shotLines = plan.shots.map((shot, index) => {
    const refs = [shot.locationAssetId, ...(shot.propAssetIds || []), ...(shot.castAssetIds || [])]
      .map((assetId) => assetById.get(assetId)?.referenceIndex)
      .filter(Boolean)
      .map((referenceIndex) => `参考图${referenceIndex}`)
      .join("、");
    return [
      `镜头${index + 1}（${shot.duration}秒）`,
      shot.action,
      shot.camera,
      refs ? `使用${refs}保持场景、道具和人物连续` : "保持主体和环境连续",
      shot.transition ? `转场：${shot.transition}` : "",
      shot.audio ? `声音：${shot.audio}` : "",
    ].filter(Boolean).join("；");
  });
  return [
    originalPrompt ? `用户核心意图：${text(originalPrompt, 900)}` : "",
    plan.logline ? `短片主题：${plan.logline}` : "",
    plan.visualStyle ? `整体视觉：${plan.visualStyle}` : "",
    materialLines ? `素材参考：${materialLines}。` : "",
    shotLines.join("\n"),
    "镜头之间保持人物身份、服装、道具、光线和空间关系稳定，动作按时间顺序连续完成；不要瞬移、穿模、突然改变场景或凭空增加人物。",
  ].filter(Boolean).join("\n\n").slice(0, 6_800).trim();
}

function normalizeFinalVideoPrompt(value, { referenceCount = 0 } = {}) {
  let prompt = text(value, 6_800);
  if (!prompt) return "";
  prompt = prompt.replace(/@图片(\d+)/g, (match, numberText) => {
    const number = Number(numberText);
    return number >= 1 && number <= referenceCount ? match : `参考素材${numberText}`;
  });
  prompt = prompt.replace(/@视频(\d+)/g, "参考视频$1");
  return prompt.trim();
}

function createVideoProductionManager({
  db,
  generatePlan,
  generateFinalPrompt,
  prepareAsset,
  queueAsset,
  createVideoTask,
  afterVideoTaskCreated,
  notifyFailure,
  logger = console,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db) throw new Error("video production manager requires db");
  const locks = new Map();

  function withLock(pipelineId, callback) {
    const previous = locks.get(pipelineId) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(callback);
    locks.set(pipelineId, current);
    void current.finally(() => {
      if (locks.get(pipelineId) === current) locks.delete(pipelineId);
    }).catch(() => undefined);
    return current;
  }

  async function getPipeline(pipelineId) {
    return db.findOneAsync({ _id: pipelineId, type: VIDEO_PRODUCTION_PIPELINE_TYPE });
  }

  async function updatePipeline(pipelineId, fields) {
    await db.updateAsync(
      { _id: pipelineId, type: VIDEO_PRODUCTION_PIPELINE_TYPE },
      { $set: { ...fields, updatedAt: now() } },
    );
  }

  async function updateAssets(pipelineId, assets, fields = {}) {
    await updatePipeline(pipelineId, { assets, ...fields });
  }

  function buildManifest(pipeline) {
    const references = Array.isArray(pipeline.baseReferenceImages)
      ? pipeline.baseReferenceImages.slice(0, 9)
      : [];
    const referenceKeys = new Map();
    references.forEach((reference, index) => {
      const key = reference?.source === "history"
        ? `history:${reference.referenceId}`
        : (reference?.source === "role" ? "role" : "base:" + index);
      referenceKeys.set(key, index + 1);
    });
    const manifest = [];
    for (const asset of Array.isArray(pipeline.assets) ? pipeline.assets : []) {
      const entry = {
        assetId: asset.id,
        kind: asset.kind,
        name: asset.name,
        prompt: asset.prompt,
        status: asset.status,
        referenceIndex: null,
        reference: asset.reference || null,
      };
      if (asset.reference) {
        const key = asset.reference.source === "history"
          ? `history:${asset.reference.referenceId}`
          : (asset.reference.source === "role" ? "role" : `asset:${asset.id}`);
        if (referenceKeys.has(key)) {
          entry.referenceIndex = referenceKeys.get(key);
        } else if (references.length < 9) {
          references.push(asset.reference);
          entry.referenceIndex = references.length;
          referenceKeys.set(key, entry.referenceIndex);
        }
      }
      manifest.push(entry);
    }
    return {
      references,
      manifest,
      videoReferences: Array.isArray(pipeline.baseReferenceVideos)
        ? pipeline.baseReferenceVideos.slice(0, 3)
        : [],
    };
  }

  async function failPipeline(pipeline, error) {
    const message = text(error || "视频制作流程失败", 400) || "视频制作流程失败";
    await updatePipeline(pipeline._id, {
      status: "failed",
      error: message,
      failedAt: now(),
    });
    try {
      await notifyFailure?.({ pipeline, error: message });
    } catch (notifyError) {
      logger.warn?.("通知视频制作流程失败:", notifyError.message || notifyError);
    }
    return { ok: false, error: message };
  }

  async function advanceUnlocked(pipelineId) {
    let pipeline = await getPipeline(pipelineId);
    if (!pipeline || ["completed", "failed", "video"].includes(pipeline.status)) {
      return pipeline;
    }

    let assets = Array.isArray(pipeline.assets) ? pipeline.assets : [];
    if (pipeline.status === "planning") {
      await updatePipeline(pipelineId, { status: assets.length ? "generating_assets" : "prompting" });
      pipeline = await getPipeline(pipelineId);
      assets = Array.isArray(pipeline?.assets) ? pipeline.assets : [];
    }

    for (const asset of assets) {
      if (asset.status !== "pending") continue;
      let prepared = {};
      try {
        prepared = await prepareAsset?.({ pipeline, asset }) || {};
      } catch (error) {
        return failPipeline(pipeline, `准备视频素材「${asset.name}」失败：${error.message || error}`);
      }
      const nextAsset = {
        ...asset,
        ...(prepared.asset && typeof prepared.asset === "object" ? prepared.asset : {}),
      };
      if (prepared.ready && prepared.reference) {
        nextAsset.status = "ready";
        nextAsset.reference = prepared.reference;
        assets = assets.map((item) => item.id === asset.id ? nextAsset : item);
        await updateAssets(pipelineId, assets);
        continue;
      }
      if (prepared.skip === true) {
        nextAsset.status = "ready";
        assets = assets.map((item) => item.id === asset.id ? nextAsset : item);
        await updateAssets(pipelineId, assets);
        continue;
      }
      if (typeof queueAsset !== "function") {
        return failPipeline(pipeline, `没有可用的素材生成器：${asset.name}`);
      }
      try {
        const queued = await queueAsset({ pipeline, asset: nextAsset });
        if (!queued?.taskId) {
          return failPipeline(pipeline, `素材「${asset.name}」没有成功进入图片任务队列。`);
        }
        nextAsset.status = "queued";
        nextAsset.taskId = queued.taskId;
        assets = assets.map((item) => item.id === asset.id ? nextAsset : item);
        await updateAssets(pipelineId, assets, { status: "generating_assets" });
      } catch (error) {
        return failPipeline(pipeline, `排队素材「${asset.name}」失败：${error.message || error}`);
      }
    }

    pipeline = await getPipeline(pipelineId);
    if (!pipeline) return null;
    assets = Array.isArray(pipeline.assets) ? pipeline.assets : [];
    const failedAsset = assets.find((asset) => asset.status === "failed");
    if (failedAsset) {
      return failPipeline(pipeline, `素材「${failedAsset.name}」生成失败：${failedAsset.error || "未知原因"}`);
    }
    if (assets.some((asset) => ["pending", "queued", "processing"].includes(asset.status))) {
      await updatePipeline(pipelineId, { status: "generating_assets" });
      return getPipeline(pipelineId);
    }

    const assembled = buildManifest(pipeline);
    let finalPrompt = normalizeFinalVideoPrompt(pipeline.finalPrompt, {
      referenceCount: assembled.references.length,
    });
    if (!finalPrompt) {
      await updatePipeline(pipelineId, { status: "prompting" });
      pipeline = await getPipeline(pipelineId);
      try {
        finalPrompt = normalizeFinalVideoPrompt(
          await generateFinalPrompt?.({
            pipeline,
            plan: pipeline.plan,
            assets: pipeline.assets,
            assetManifest: assembled.manifest,
            referenceImages: assembled.references,
          }),
          { referenceCount: assembled.references.length },
        );
      } catch (error) {
        logger.warn?.("生成视频最终提示词失败，将使用分镜兜底:", error.message || error);
      }
      finalPrompt ||= buildVideoPromptFromPlan({
        plan: pipeline.plan,
        assetManifest: assembled.manifest,
        originalPrompt: pipeline.originalPrompt,
      });
      finalPrompt = normalizeFinalVideoPrompt(finalPrompt, {
        referenceCount: assembled.references.length,
      });
      if (!finalPrompt) {
        return failPipeline(pipeline, "没有生成有效的视频最终提示词。");
      }
      await updatePipeline(pipelineId, {
        status: "submitting",
        finalPrompt,
        assetManifest: assembled.manifest,
        referenceImages: assembled.references,
        referenceVideos: assembled.videoReferences,
      });
      pipeline = await getPipeline(pipelineId);
    }

    if (pipeline.videoTaskId) {
      await updatePipeline(pipelineId, { status: "video" });
      return getPipeline(pipelineId);
    }
    try {
      const task = await createVideoTask?.({
        pipeline,
        finalPrompt,
        referenceImages: assembled.references,
        referenceVideos: assembled.videoReferences,
        assetManifest: assembled.manifest,
      });
      if (!task?.taskId) {
        return failPipeline(pipeline, "最终视频任务没有成功创建。");
      }
      await updatePipeline(pipelineId, {
        status: task.completed ? "completed" : "video",
        videoTaskId: task.taskId,
        finalPrompt,
        assetManifest: assembled.manifest,
        referenceImages: assembled.references,
        referenceVideos: assembled.videoReferences,
        videoMode: task.videoMode || pipeline.videoMode,
      });
      await afterVideoTaskCreated?.({
        pipeline: await getPipeline(pipelineId),
        taskId: task.taskId,
      });
      return getPipeline(pipelineId);
    } catch (error) {
      return failPipeline(pipeline, `创建最终视频任务失败：${error.message || error}`);
    }
  }

  function advance(pipelineId) {
    return withLock(pipelineId, () => advanceUnlocked(pipelineId));
  }

  async function start(input = {}) {
    let rawPlan = null;
    try {
      rawPlan = typeof generatePlan === "function" ? await generatePlan(input) : null;
    } catch {
      rawPlan = null;
    }
    const requestedDuration = Number(input.duration);
    const fallbackDuration = Number.isFinite(requestedDuration) && requestedDuration >= 4
      ? numberInRange(requestedDuration, 4, 15, 8)
      : 8;
    const normalizedPlan = normalizeVideoProductionPlan(rawPlan, { fallbackDuration });
    const plan = normalizedPlan?.assets?.length > 0
      ? normalizedPlan
      : buildFallbackVideoProductionPlan({
        prompt: input.originalPrompt,
        role: input.role,
        roleState: input.roleStateSnapshot,
        duration: fallbackDuration,
      });
    const pipeline = await db.insertAsync({
      type: VIDEO_PRODUCTION_PIPELINE_TYPE,
      pipelineVersion: VIDEO_PRODUCTION_VERSION,
      userId: input.userId,
      chatId: input.chatId,
      roleName: input.roleName,
      originalPrompt: text(input.originalPrompt, 1_500),
      reply: text(input.reply, 500),
      caption: text(input.caption, 500),
      plan,
      assets: plan.assets.map((asset) => ({ ...asset, status: "pending" })),
      baseReferenceImages: Array.isArray(input.baseReferenceImages)
        ? input.baseReferenceImages.slice(0, 9)
        : [],
      baseReferenceVideos: Array.isArray(input.baseReferenceVideos)
        ? input.baseReferenceVideos.slice(0, 3)
        : [],
      roleReferenceUsed: input.roleReferenceUsed === true,
      roleStateSnapshot: input.roleStateSnapshot || null,
      videoMode: input.videoMode || "r2v",
      requestedVideoMode: input.videoMode || "r2v",
      ratio: input.ratio,
      duration: input.duration,
      generateAudio: input.generateAudio,
      allowOnScreenText: input.allowOnScreenText === true,
      status: "planning",
      createdAt: now(),
      updatedAt: now(),
    });
    await advance(pipeline._id);
    const latest = await getPipeline(pipeline._id);
    return {
      ok: true,
      pipelineId: pipeline._id,
      status: latest?.status || "planning",
      plan,
      assetCount: plan.assets.length,
      videoTaskId: latest?.videoTaskId || null,
    };
  }

  async function markAssetReady({ pipelineId, assetId, reference, error = "" } = {}) {
    if (!pipelineId || !assetId) return { ok: false, error: "素材制作单编号不完整。" };
    return withLock(pipelineId, async () => {
      const pipeline = await getPipeline(pipelineId);
      if (!pipeline) return { ok: false, error: "没有找到视频制作单。" };
      const assets = Array.isArray(pipeline.assets) ? pipeline.assets : [];
      const target = assets.find((asset) => asset.id === assetId);
      if (!target) return { ok: false, error: "没有找到对应的视频素材。" };
      const nextAssets = assets.map((asset) => asset.id === assetId
        ? {
            ...asset,
            status: reference ? "ready" : "failed",
            ...(reference ? { reference } : {}),
            ...(error ? { error: text(error, 300) } : {}),
            completedAt: now(),
          }
        : asset);
      await updateAssets(pipelineId, nextAssets);
      const latest = await advanceUnlocked(pipelineId);
      return { ok: Boolean(latest), pipeline: latest };
    });
  }

  async function markAssetFailed({ pipelineId, assetId, error } = {}) {
    return markAssetReady({ pipelineId, assetId, error: error || "素材生成失败。" });
  }

  async function resumePending() {
    const pipelines = await db.findAsync({ type: VIDEO_PRODUCTION_PIPELINE_TYPE });
    for (const pipeline of pipelines) {
      if (["planning", "generating_assets", "prompting", "submitting"].includes(pipeline.status)) {
        void advance(pipeline._id).catch((error) => logger.error?.("恢复视频制作单失败:", error));
      }
    }
  }

  return {
    start,
    advance,
    getPipeline,
    markAssetReady,
    markAssetFailed,
    resumePending,
  };
}

module.exports = {
  VIDEO_PRODUCTION_PIPELINE_TYPE,
  VIDEO_PRODUCTION_VERSION,
  MAX_VIDEO_PRODUCTION_SHOTS,
  MAX_VIDEO_PRODUCTION_ASSETS,
  normalizeVideoProductionPlan,
  buildFallbackVideoProductionPlan,
  buildVideoPromptFromPlan,
  normalizeFinalVideoPrompt,
  createVideoProductionManager,
};
