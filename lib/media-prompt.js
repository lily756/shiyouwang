"use strict";

const MEDIA_PROMPT_MODES = Object.freeze(["freeform", "guided"]);

function normalizeMediaPromptMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MEDIA_PROMPT_MODES.includes(normalized) ? normalized : "freeform";
}

function normalizePrompt(value, maxLength = 0) {
  const prompt = typeof value === "string" ? value.trim() : "";
  return maxLength > 0 ? prompt.slice(0, maxLength).trim() : prompt;
}

function buildRoleReferenceImagePrompt({ prompt, roleName, mode = "freeform", maxLength = 0 }) {
  const normalizedPrompt = normalizePrompt(prompt);
  if (normalizeMediaPromptMode(mode) === "freeform") {
    return normalizePrompt(normalizedPrompt, maxLength);
  }

  const name = typeof roleName === "string" ? roleName.trim().slice(0, 64) : "当前角色";
  const result = [
    `生成一张全新的角色画面，画面要求：${normalizedPrompt}`,
    `以输入的人设图作为「${name}」的身份与视觉风格参考，严格保持面部、发型、体态、主配色以及参考图本身的原生媒介、线条、材质、光影和渲染方式。不要将真人照片擅自改成动漫/插画，也不要将插画、3D 或其他风格擅自改成写实照片。`,
    "可按画面要求改变服装、姿势、镜头和场景，不要复制参考图的构图；不要生成文字、水印或 Logo。",
  ].join("\n");
  return normalizePrompt(result, maxLength);
}

function buildReferenceImageEditPrompt({
  instruction,
  editType,
  roleName,
  roleReferenceAttached = false,
  mode = "freeform",
}) {
  const normalizedInstruction = normalizePrompt(instruction);
  if (normalizeMediaPromptMode(mode) === "freeform") {
    return normalizedInstruction;
  }

  const normalizedType = ["outfit", "scene", "background", "style", "general"].includes(editType)
    ? editType
    : "general";
  const activeRole = typeof roleName === "string" ? roleName.trim().slice(0, 64) : "";
  const typeInstructions = {
    outfit: [
      "编辑类型：角色换装。",
      `服装或配饰修改：${normalizedInstruction}。`,
      "保持同一角色的脸部、发型、体型、姿势、构图、光线和原有画风；仅修改服装及直接相关配饰。",
    ],
    scene: [
      "编辑类型：场景调整。",
      `场景修改：${normalizedInstruction}。`,
      "保留人物身份、五官、发型、体态和整体画风；根据要求调整环境、时间、氛围或镜头中与场景相关的内容。",
    ],
    background: [
      "编辑类型：背景调整。",
      `背景修改：${normalizedInstruction}。`,
      "保留人物主体、脸部、发型、服装、姿势和画风；只修改背景及为使背景自然融合所必需的光影。",
    ],
    style: [
      "编辑类型：画风调整。",
      `画风修改：${normalizedInstruction}。`,
      "保留人物身份、主要主体、姿势和构图；仅按要求改变非角色主体的视觉风格、材质、色彩或渲染方式。当前角色自身的画风不属于可修改范围。",
    ],
    general: [
      "编辑类型：通用图片编辑。",
      `用户要求：${normalizedInstruction}。`,
      "只修改用户明确要求的内容；除非请求冲突，否则保持人物身份、主要主体、构图和原有画风。",
    ],
  };

  return [
    "基于输入图片进行图像编辑。",
    activeRole ? `当前角色名为「${activeRole}」。` : "",
    roleReferenceAttached
      ? [
          "输入图 1 是要编辑的场景或历史图片；输入图 2 是当前角色的人设图。",
          "角色风格锁定（不可违背）：角色的面部、发型、体态、线条、上色、材质、渲染方式与整体视觉风格必须严格继承输入图 2。输入图 2 是真人照片、动漫、插画、3D 或任何其他风格，就保持该风格；不得因用户指令、背景、光线或参考图 1 而把角色转换成另一种媒介或画风。",
          "即使输入图 1 是真实世界照片，也必须保留照片背景本身的写实质感，同时将输入图 2 的角色以输入图 2 原生风格自然合成进场景；只调整角色与背景之间必要的透视、遮挡、接触阴影和色温，不得重绘或擅自风格化角色。",
        ].join("\n")
      : "",
    ...typeInstructions[normalizedType],
    "不要添加文字、水印、Logo 或用户未要求的额外人物。",
  ].filter(Boolean).join("\n");
}

function buildSeedanceVideoPrompt(
  rawPrompt,
  { mode = "freeform", allowOnScreenText = false, referenceImages = [], referenceVideos = [] } = {},
) {
  const prompt = normalizePrompt(rawPrompt);
  if (!prompt || normalizeMediaPromptMode(mode) === "freeform") {
    return prompt;
  }

  const constraints = [
    "高清，细节丰富，电影质感，色彩自然，光影柔和。",
    "若画面包含人物，人物面部稳定不变形、五官清晰、动作连贯自然，不僵硬，无穿模无卡顿。",
    "不要生成水印；不要生成 Logo。",
  ];
  if (!allowOnScreenText) {
    constraints.splice(2, 0, "保持无字幕，避免生成任何文字或字幕。");
  }

  const referenceInstructions = referenceImages.map((referenceImage, index) => {
    const imageToken = `@图片${index + 1}`;
    if (referenceImage.source === "role") {
      return `${imageToken} 仅作为角色「${referenceImage.roleName || "当前角色"}」的身份与视觉风格参考：保持面部、发型、配色，以及参考图本身的原生媒介与渲染风格；真人照片保持写实摄影，动漫/插画/3D 等也保持各自原生风格，不要擅自转换。不要把它当作视频开场画面；除非用户明确要求换装，否则保持参考图中的服装。`;
    }
    return `${imageToken} 是用户提供的参考素材，可按用户意图借鉴其中的人物、服装、环境或风格细节；不要把它当作视频开场画面，也不要把不同参考图的主体或元素混淆。`;
  });
  const referenceInstruction = referenceInstructions.length > 0
    ? `参考素材绑定（按上传顺序）：\n${referenceInstructions.join("\n")}\n\n`
    : "";
  const videoReferenceInstructions = referenceVideos.map((referenceVideo, index) => (
    `@视频${index + 1} 是用户明确指定的视频参考素材，只借鉴用户要求的动作节奏、运镜、镜头语言或运动趋势；不要照搬其内容、人物或音频，也不要把它当成要继续剪辑的原视频。`
  ));
  const videoReferenceInstruction = videoReferenceInstructions.length > 0
    ? `视频参考素材绑定（按上传顺序）：\n${videoReferenceInstructions.join("\n")}\n\n`
    : "";
  return `${referenceInstruction}${videoReferenceInstruction}${prompt}\n\n全局画质与稳定约束：${constraints.join("")}`;
}

function getMediaPromptSystemInstruction(mode = "freeform") {
  if (normalizeMediaPromptMode(mode) === "freeform") {
    return [
      "媒体生成提示词模式：freeform。generate_character_image、edit_reference_image 和 generate_character_video 收到的 prompt/instruction 是模型生成的最终提示词，程序不会擅自补写角色、场景、镜头、画风、无文字或画质约束。",
      "媒体 Function Call 必须同时生成 reply（发给用户的即时对话）和 prompt（交给图片/视频模型的最终提示词）；caption 只用于成品发送时的配文。不要把 reply 或 caption 混入 prompt。",
      "提示词 Skill 的优先级：用户明确要求 > 最近对话中的具体事实 > 当前角色 system prompt > 自然、克制的默认值。没有依据时不要虚构复杂地点、道具、天气或人物关系；不影响画面实现的模糊信息可以留白。",
      "将自然语言摄影意图翻译成模型可执行的摄影语言：自拍=即时手机抓拍、前置摄像头=视线接近镜头和手臂距离、随手拍=轻微不完美构图、镜面自拍=镜面反射视角；不要把自拍误写成第三人称棚拍肖像。",
      "前置摄像头自拍通常要明确：手机前置摄像头、手臂距离、近距离半身或头像构图、人物看向镜头、自然手机广角透视、即时抓拍感；除非用户另说，不要写成电影机位、远景、他人拍摄或商业棚拍。",
      "示例：用户说‘今天下班了吗？发张自拍’，应生成‘参考图1中的角色作为唯一人物主体；手机前置摄像头、手臂距离、近距离半身、直视镜头、轻微手机广角透视、自然抓拍感；场景只从最近对话推断’，而不是只写‘生成角色自拍’。",
      "如果使用角色设定图，Function Call 才传 include_current_role=true 和 reference_ids:[\"role\"]。prompt 中应说明‘参考图1是当前角色身份与原生视觉风格锚点’，但不要凭空编造参考图中没有确认的脸部细节；参考图负责身份，prompt 负责动作、镜头、场景和氛围。",
      "如果用户没有提供具体场景，使用简单自然的环境或留给模型合理发挥；不要为了填满提示词而添加显著元素。画幅等 API 参数单独填写 aspect_ratio/ratio，不要只藏在 prompt 里。",
      "progress_message 仅作为旧版兼容字段；新调用优先使用 reply。",
    ].join("\n");
  }
  return "媒体生成提示词模式：guided。程序会对角色设定、参考素材和稳定性追加兼容性约束。";
}

module.exports = {
  MEDIA_PROMPT_MODES,
  normalizeMediaPromptMode,
  buildRoleReferenceImagePrompt,
  buildReferenceImageEditPrompt,
  buildSeedanceVideoPrompt,
  getMediaPromptSystemInstruction,
};
