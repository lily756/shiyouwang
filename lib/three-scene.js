const THREE_SCENE_VERSION = 1;

const MAX_OBJECTS = 64;
const MAX_MESH_PARTS = 64;
const MAX_BONES = 48;
const MAX_ANIMATIONS = 12;
const MAX_TRACKS_PER_ANIMATION = 48;
const MAX_KEYFRAMES_PER_TRACK = 32;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value, fallback = "", maxLength = 240) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function normalizeColor(value, fallback = "#7dd3fc") {
  const color = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function normalizeVector(value, fallback = [0, 0, 0], limits = [-100, 100]) {
  const array = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map((index) => clamp(finiteNumber(array[index], fallback[index] || 0), limits[0], limits[1]));
}

function normalizeScale(value, fallback = [1, 1, 1]) {
  return normalizeVector(value, fallback, [0.001, 100]);
}

function normalizePrimitive(value) {
  const primitive = String(value || "box").trim().toLowerCase();
  return ["box", "sphere", "cylinder", "capsule", "torus", "cone"].includes(primitive)
    ? primitive
    : "box";
}

function normalizeKeyframes(value, { kind, fallback }) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const frames = value
    .slice(0, MAX_KEYFRAMES_PER_TRACK)
    .map((frame) => {
      const time = clamp(finiteNumber(frame?.time, 0), 0, 3_600);
      const vector = kind === "rotation"
        ? normalizeVector(frame?.value, fallback, [-Math.PI * 8, Math.PI * 8])
        : normalizeVector(frame?.value, fallback, [-100, 100]);
      return { time, value: vector };
    })
    .sort((left, right) => left.time - right.time);
  return frames.length > 0 ? frames : fallback;
}

function defaultRig() {
  return {
    rootPosition: [0, 0, 0],
    skeletonVisible: true,
    bones: [
      { name: "root", parent: null, position: [0, 0, 0] },
      { name: "spine", parent: "root", position: [0, 1.05, 0] },
      { name: "head", parent: "spine", position: [0, 0.95, 0] },
      { name: "leftArm", parent: "spine", position: [-0.62, 0.42, 0] },
      { name: "rightArm", parent: "spine", position: [0.62, 0.42, 0] },
      { name: "leftLeg", parent: "root", position: [-0.28, -0.82, 0] },
      { name: "rightLeg", parent: "root", position: [0.28, -0.82, 0] },
    ],
    meshParts: [
      { bone: "root", primitive: "box", position: [0, 0.12, 0], scale: [0.72, 0.28, 0.42], color: "#334155" },
      { bone: "spine", primitive: "capsule", position: [0, 0.42, 0], scale: [0.54, 0.78, 0.38], color: "#38bdf8" },
      { bone: "head", primitive: "sphere", position: [0, 0.28, 0], scale: [0.42, 0.42, 0.42], color: "#f8c9a5" },
      { bone: "leftArm", primitive: "capsule", position: [0, -0.42, 0], scale: [0.16, 0.62, 0.16], color: "#0ea5e9" },
      { bone: "rightArm", primitive: "capsule", position: [0, -0.42, 0], scale: [0.16, 0.62, 0.16], color: "#0ea5e9" },
      { bone: "leftLeg", primitive: "capsule", position: [0, -0.48, 0], scale: [0.19, 0.72, 0.19], color: "#1e293b" },
      { bone: "rightLeg", primitive: "capsule", position: [0, -0.48, 0], scale: [0.19, 0.72, 0.19], color: "#1e293b" },
    ],
    animations: [
      {
        name: "wave",
        duration: 2.4,
        loop: true,
        tracks: [
          {
            bone: "rightArm",
            rotation: [
              { time: 0, value: [0, 0, -0.25] },
              { time: 0.6, value: [0, 0, -1.05] },
              { time: 1.2, value: [0, 0, -0.45] },
              { time: 1.8, value: [0, 0, -1.05] },
              { time: 2.4, value: [0, 0, -0.25] },
            ],
          },
          {
            bone: "head",
            rotation: [
              { time: 0, value: [0, -0.08, 0] },
              { time: 1.2, value: [0, 0.08, 0] },
              { time: 2.4, value: [0, -0.08, 0] },
            ],
          },
        ],
      },
    ],
  };
}

function normalizeObject(value, index) {
  return {
    id: normalizeText(value?.id, `object_${index + 1}`, 80),
    name: normalizeText(value?.name, `物体 ${index + 1}`, 100),
    primitive: normalizePrimitive(value?.primitive),
    position: normalizeVector(value?.position),
    rotation: normalizeVector(value?.rotation, [0, 0, 0], [-Math.PI * 8, Math.PI * 8]),
    scale: normalizeScale(value?.scale),
    color: normalizeColor(value?.color),
    metalness: clamp(finiteNumber(value?.metalness, 0.05), 0, 1),
    roughness: clamp(finiteNumber(value?.roughness, 0.72), 0.02, 1),
  };
}

function normalizeBone(value, index) {
  return {
    name: normalizeText(value?.name, `bone_${index + 1}`, 80),
    parent: value?.parent ? normalizeText(value.parent, "", 80) : null,
    position: normalizeVector(value?.position, [0, 0, 0]),
  };
}

function normalizeMeshPart(value, index) {
  return {
    id: normalizeText(value?.id, `part_${index + 1}`, 80),
    bone: normalizeText(value?.bone, "root", 80),
    primitive: normalizePrimitive(value?.primitive),
    position: normalizeVector(value?.position),
    rotation: normalizeVector(value?.rotation, [0, 0, 0], [-Math.PI * 8, Math.PI * 8]),
    scale: normalizeScale(value?.scale),
    color: normalizeColor(value?.color),
    metalness: clamp(finiteNumber(value?.metalness, 0.05), 0, 1),
    roughness: clamp(finiteNumber(value?.roughness, 0.72), 0.02, 1),
  };
}

function normalizeTrack(value, index, boneNames) {
  const bone = normalizeText(value?.bone, boneNames[0] || "root", 80);
  const fallbackPosition = [{ time: 0, value: [0, 0, 0] }];
  const fallbackRotation = [{ time: 0, value: [0, 0, 0] }];
  const track = { bone };
  if (Array.isArray(value?.position)) {
    track.position = normalizeKeyframes(value.position, {
      kind: "position",
      fallback: fallbackPosition,
    });
  }
  if (Array.isArray(value?.rotation)) {
    track.rotation = normalizeKeyframes(value.rotation, {
      kind: "rotation",
      fallback: fallbackRotation,
    });
  }
  if (!track.position && !track.rotation) {
    track.rotation = fallbackRotation;
  }
  track.id = normalizeText(value?.id, `track_${index + 1}`, 80);
  return track;
}

function normalizeAnimation(value, index, boneNames) {
  const duration = clamp(finiteNumber(value?.duration, 2.4), 0.1, 3_600);
  return {
    name: normalizeText(value?.name, `animation_${index + 1}`, 100),
    duration,
    loop: value?.loop !== false,
    tracks: Array.isArray(value?.tracks)
      ? value.tracks.slice(0, MAX_TRACKS_PER_ANIMATION).map((track, trackIndex) => normalizeTrack(track, trackIndex, boneNames))
      : [],
  };
}

function normalizeRig(value) {
  const fallback = defaultRig();
  const bones = Array.isArray(value?.bones) && value.bones.length > 0
    ? value.bones.slice(0, MAX_BONES).map(normalizeBone)
    : fallback.bones;
  const boneNames = bones.map((bone) => bone.name);
  if (!boneNames.includes("root")) {
    bones.unshift({ name: "root", parent: null, position: [0, 0, 0] });
  }
  const normalizedBones = bones.map((bone) => ({
    ...bone,
    parent: bone.parent && boneNames.includes(bone.parent) && bone.parent !== bone.name ? bone.parent : null,
  }));
  const meshParts = Array.isArray(value?.meshParts)
    ? value.meshParts.slice(0, MAX_MESH_PARTS).map(normalizeMeshPart)
    : fallback.meshParts;
  const allowedBones = new Set(normalizedBones.map((bone) => bone.name));
  return {
    rootPosition: normalizeVector(value?.rootPosition, fallback.rootPosition),
    skeletonVisible: value?.skeletonVisible !== false,
    bones: normalizedBones,
    meshParts: meshParts.map((part) => ({
      ...part,
      bone: allowedBones.has(part.bone) ? part.bone : "root",
    })),
    animations: Array.isArray(value?.animations)
      ? value.animations.slice(0, MAX_ANIMATIONS).map((animation, index) => normalizeAnimation(animation, index, normalizedBones.map((bone) => bone.name)))
      : fallback.animations,
  };
}

function defaultThreeScene({ title = "角色 3D 场景", prompt = "" } = {}) {
  return {
    version: THREE_SCENE_VERSION,
    title: normalizeText(title, "角色 3D 场景", 120),
    description: normalizeText(prompt, "一个带骨骼动画的 Three.js 角色场景", 600),
    background: "#0f172a",
    camera: { position: [4.2, 3.1, 6.4], target: [0, 0.8, 0] },
    objects: [
      { id: "ground", name: "地面", primitive: "cylinder", position: [0, -1.58, 0], rotation: [0, 0, 0], scale: [3.8, 0.08, 3.8], color: "#1e293b", metalness: 0.05, roughness: 0.92 },
      { id: "light_marker", name: "暖色灯光标记", primitive: "sphere", position: [-2.2, 2.8, -1.5], rotation: [0, 0, 0], scale: [0.12, 0.12, 0.12], color: "#fbbf24", metalness: 0.1, roughness: 0.3 },
    ],
    rig: defaultRig(),
  };
}

function normalizeThreeScene(value, { title = "角色 3D 场景", prompt = "" } = {}) {
  const fallback = defaultThreeScene({ title, prompt });
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const cameraSource = source.camera && typeof source.camera === "object" ? source.camera : {};
  return {
    version: THREE_SCENE_VERSION,
    title: normalizeText(source.title, fallback.title, 120),
    description: normalizeText(source.description, fallback.description, 600),
    background: normalizeColor(source.background, fallback.background),
    camera: {
      position: normalizeVector(cameraSource.position, fallback.camera.position, [-100, 100]),
      target: normalizeVector(cameraSource.target, fallback.camera.target, [-100, 100]),
    },
    objects: Array.isArray(source.objects)
      ? source.objects.slice(0, MAX_OBJECTS).map(normalizeObject)
      : fallback.objects,
    rig: normalizeRig(source.rig),
  };
}

function extractJsonObject(rawText) {
  const text = String(rawText || "")
    .replace(/^\s*```(?:json)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildThreeViewerHtml({ token, sceneUrl = "", title = "角色 3D 场景" } = {}) {
  const safeToken = String(token || "").replace(/[^A-Za-z0-9_-]/g, "");
  const safeTitle = escapeHtml(title || "角色 3D 场景");
  const safeSceneUrl = /^https?:\/\//iu.test(String(sceneUrl || "")) ? String(sceneUrl) : "";
  const tokenJson = JSON.stringify(safeToken).replace(/</g, "\\u003c");
  const sceneUrlJson = JSON.stringify(safeSceneUrl).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #020617; color: #e2e8f0; }
    header { display: flex; gap: 1rem; align-items: baseline; padding: 1rem 1.25rem .75rem; border-bottom: 1px solid #1e293b; }
    h1 { font-size: 1.1rem; margin: 0; }
    #status { color: #94a3b8; font-size: .85rem; }
    #stage { width: 100vw; height: min(74vh, 720px); min-height: 420px; display: block; }
    .controls { display: flex; flex-wrap: wrap; gap: .65rem 1rem; align-items: center; padding: .9rem 1.25rem; border-top: 1px solid #1e293b; background: #0f172a; }
    label { display: inline-flex; gap: .4rem; align-items: center; color: #cbd5e1; font-size: .88rem; }
    select, button, input[type="range"] { accent-color: #38bdf8; }
    select, button { border: 1px solid #334155; border-radius: .45rem; background: #1e293b; color: #e2e8f0; padding: .4rem .65rem; }
    button { cursor: pointer; }
    #description { padding: 0 1.25rem 1.1rem; margin: 0; color: #94a3b8; white-space: pre-wrap; }
    .error { color: #fda4af !important; }
  </style>
  <script type="importmap">{
    "imports": {
      "three": "https://unpkg.com/three@0.176.0/build/three.module.js"
    }
  }</script>
</head>
<body>
  <header><h1>${safeTitle}</h1><span id="status">正在载入场景…</span></header>
  <canvas id="stage"></canvas>
  <div class="controls">
    <label>动画 <select id="animation"></select></label>
    <button id="play" type="button">暂停</button>
    <label>时间 <input id="timeline" type="range" min="0" max="1" value="0" step="0.01" /></label>
    <label><input id="skeleton" type="checkbox" checked /> 显示骨骼</label>
  </div>
  <p id="description"></p>
  <script type="module">
    import * as THREE from "three";
    import { OrbitControls } from "https://unpkg.com/three@0.176.0/examples/jsm/controls/OrbitControls.js";

    const token = ${tokenJson};
    const sceneUrl = ${sceneUrlJson};
    const canvas = document.querySelector("#stage");
    const status = document.querySelector("#status");
    const description = document.querySelector("#description");
    const animationSelect = document.querySelector("#animation");
    const playButton = document.querySelector("#play");
    const timeline = document.querySelector("#timeline");
    const skeletonToggle = document.querySelector("#skeleton");
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.target.set(0, 0.8, 0);
    const stage = new THREE.Group();
    scene.add(stage);
    const animatedBones = new Map();
    const rigState = { root: null, skeletonHelper: null, base: new Map() };
    let model = null;
    let running = true;
    let elapsed = 0;
    let lastFrame = performance.now();
    let selectedAnimation = null;
    let draggingTimeline = false;

    function vec3(value, fallback = [0, 0, 0]) {
      const v = Array.isArray(value) ? value : fallback;
      return new THREE.Vector3(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
    }
    function makeGeometry(part) {
      const scale = Array.isArray(part.scale) ? part.scale : [1, 1, 1];
      const sx = Math.max(.001, Number(scale[0]) || 1);
      const sy = Math.max(.001, Number(scale[1]) || 1);
      const sz = Math.max(.001, Number(scale[2]) || 1);
      if (part.primitive === "sphere") return new THREE.SphereGeometry(.5, 24, 16);
      if (part.primitive === "cylinder") return new THREE.CylinderGeometry(.5, .5, 1, 20);
      if (part.primitive === "cone") return new THREE.ConeGeometry(.5, 1, 20);
      if (part.primitive === "torus") return new THREE.TorusGeometry(.42, .13, 12, 28);
      if (part.primitive === "capsule") return new THREE.CapsuleGeometry(.42, .65, 8, 16);
      return new THREE.BoxGeometry(1, 1, 1);
    }
    function makeMesh(part) {
      const mesh = new THREE.Mesh(
        makeGeometry(part),
        new THREE.MeshStandardMaterial({
          color: part.color || "#7dd3fc",
          metalness: Number(part.metalness) || 0,
          roughness: Number(part.roughness) || .72,
        }),
      );
      mesh.position.copy(vec3(part.position));
      mesh.rotation.set(...(Array.isArray(part.rotation) ? part.rotation : [0, 0, 0]).map((v) => Number(v) || 0));
      mesh.scale.set(...(Array.isArray(part.scale) ? part.scale : [1, 1, 1]).map((v) => Math.max(.001, Number(v) || 1)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }
    function addObject(object) {
      const mesh = makeMesh(object);
      stage.add(mesh);
    }
    function rememberBoneBase(bone) {
      rigState.base.set(bone.name, {
        position: bone.position.clone(),
        rotation: bone.rotation.clone(),
      });
    }
    function buildRig(rig) {
      const bones = new Map();
      const boneDefinitions = Array.isArray(rig?.bones) ? rig.bones : [];
      for (const definition of boneDefinitions) {
        const bone = new THREE.Bone();
        bone.name = definition.name;
        bone.position.copy(vec3(definition.position));
        bones.set(bone.name, bone);
      }
      let root = bones.get("root") || bones.values().next().value;
      for (const definition of boneDefinitions) {
        const bone = bones.get(definition.name);
        const parent = definition.parent ? bones.get(definition.parent) : null;
        if (parent && parent !== bone) parent.add(bone);
        else if (bone !== root) root?.add(bone);
      }
      if (!root) return;
      const rigGroup = new THREE.Group();
      rigGroup.position.copy(vec3(rig.rootPosition));
      rigGroup.add(root);
      stage.add(rigGroup);
      rigState.root = root;
      for (const bone of bones.values()) {
        animatedBones.set(bone.name, bone);
        rememberBoneBase(bone);
      }
      for (const part of Array.isArray(rig.meshParts) ? rig.meshParts : []) {
        (bones.get(part.bone) || root).add(makeMesh(part));
      }
      rigState.skeletonHelper = new THREE.SkeletonHelper(root);
      rigState.skeletonHelper.visible = rig.skeletonVisible !== false;
      rigState.skeletonHelper.material.linewidth = 2;
      stage.add(rigState.skeletonHelper);
    }
    function interpolate(frames, time, fallback) {
      if (!Array.isArray(frames) || frames.length === 0) return fallback;
      if (time <= frames[0].time) return frames[0].value;
      for (let index = 1; index < frames.length; index += 1) {
        const right = frames[index];
        const left = frames[index - 1];
        if (time <= right.time) {
          const span = Math.max(.0001, right.time - left.time);
          const ratio = (time - left.time) / span;
          return left.value.map((value, component) => value + (right.value[component] - value) * ratio);
        }
      }
      return frames[frames.length - 1].value;
    }
    function resetBones() {
      for (const [name, base] of rigState.base) {
        const bone = animatedBones.get(name);
        if (!bone) continue;
        bone.position.copy(base.position);
        bone.rotation.copy(base.rotation);
      }
    }
    function applyAnimation(time) {
      resetBones();
      const animation = selectedAnimation;
      if (!animation) return;
      const duration = Math.max(.1, Number(animation.duration) || .1);
      const animationTime = animation.loop === false ? Math.min(duration, time) : time % duration;
      for (const track of Array.isArray(animation.tracks) ? animation.tracks : []) {
        const bone = animatedBones.get(track.bone);
        if (!bone) continue;
        if (Array.isArray(track.position)) bone.position.copy(vec3(interpolate(track.position, animationTime, [0, 0, 0])));
        if (Array.isArray(track.rotation)) bone.rotation.set(...interpolate(track.rotation, animationTime, [0, 0, 0]));
      }
      timeline.max = String(duration);
      if (!draggingTimeline) timeline.value = String(Math.min(duration, animationTime));
    }
    function populateAnimations(animations) {
      animationSelect.replaceChildren();
      for (const animation of Array.isArray(animations) ? animations : []) {
        const option = document.createElement("option");
        option.value = animation.name;
        option.textContent = animation.name;
        animationSelect.append(option);
      }
      selectedAnimation = animations?.[0] || null;
      if (selectedAnimation) animationSelect.value = selectedAnimation.name;
    }
    function resize() {
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || 500;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }
    function setup(data) {
      model = data;
      scene.background = new THREE.Color(data.background || "#0f172a");
      const cameraData = data.camera || {};
      camera.position.copy(vec3(cameraData.position, [4.2, 3.1, 6.4]));
      controls.target.copy(vec3(cameraData.target, [0, .8, 0]));
      for (const object of Array.isArray(data.objects) ? data.objects : []) addObject(object);
      buildRig(data.rig || {});
      populateAnimations(data.rig?.animations || []);
      description.textContent = data.description || "";
      status.textContent = (data.rig?.bones?.length || 0) + " 根骨骼 · " + (data.rig?.animations?.length || 0) + " 个动画";
      resize();
    }
    async function load() {
      try {
        const response = await fetch(sceneUrl || "./scene.json", { cache: "no-store" });
        if (!response.ok) throw new Error("场景加载失败（HTTP " + response.status + "）");
        setup(await response.json());
      } catch (error) {
        status.textContent = error.message || "场景加载失败";
        status.classList.add("error");
      }
    }
    animationSelect.addEventListener("change", () => {
      selectedAnimation = (model?.rig?.animations || []).find((item) => item.name === animationSelect.value) || null;
      elapsed = 0;
    });
    playButton.addEventListener("click", () => {
      running = !running;
      playButton.textContent = running ? "暂停" : "播放";
    });
    timeline.addEventListener("pointerdown", () => { draggingTimeline = true; });
    timeline.addEventListener("pointerup", () => { draggingTimeline = false; elapsed = Number(timeline.value) || 0; });
    timeline.addEventListener("input", () => { elapsed = Number(timeline.value) || 0; applyAnimation(elapsed); });
    skeletonToggle.addEventListener("change", () => { if (rigState.skeletonHelper) rigState.skeletonHelper.visible = skeletonToggle.checked; });
    window.addEventListener("resize", resize);
    const ambient = new THREE.HemisphereLight(0xbfe7ff, 0x172033, 2.2);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff1d6, 3.3);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    scene.add(key);
    const fill = new THREE.PointLight(0x60a5fa, 18, 14, 2);
    fill.position.set(-3, 2.5, 2);
    scene.add(fill);
    function frame(now) {
      const delta = Math.min(.1, (now - lastFrame) / 1000);
      lastFrame = now;
      if (running) elapsed += delta;
      applyAnimation(elapsed);
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    load();
    requestAnimationFrame(frame);
  </script>
</body>
</html>`;
}

module.exports = {
  THREE_SCENE_VERSION,
  buildThreeViewerHtml,
  defaultThreeScene,
  extractJsonObject,
  normalizeThreeScene,
};
