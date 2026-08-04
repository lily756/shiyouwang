const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildThreeViewerHtml,
  defaultThreeScene,
  extractJsonObject,
  normalizeThreeScene,
} = require("../lib/three-scene");

test("three scene normalizer keeps a safe rig and animation manifest", () => {
  const scene = normalizeThreeScene({
    title: "  测试角色  ",
    background: "#112233",
    objects: [{ id: "prop", primitive: "not-allowed", position: [1, 2, 3] }],
    rig: {
      bones: [
        { name: "root", parent: null, position: [0, 0, 0] },
        { name: "hand", parent: "root", position: [1, 0, 0] },
      ],
      meshParts: [{ bone: "hand", primitive: "sphere", color: "#abcdef" }],
      animations: [{
        name: "point",
        duration: 2,
        tracks: [{
          bone: "hand",
          rotation: [{ time: 0, value: [0, 0, 0] }, { time: 2, value: [0, 1, 0] }],
        }],
      }],
    },
  });

  assert.equal(scene.title, "测试角色");
  assert.equal(scene.objects[0].primitive, "box");
  assert.equal(scene.rig.bones.length, 2);
  assert.equal(scene.rig.animations[0].tracks[0].bone, "hand");
  assert.deepEqual(scene.rig.animations[0].tracks[0].rotation[1].value, [0, 1, 0]);
});

test("three scene helpers parse model JSON and render a viewer", () => {
  assert.deepEqual(extractJsonObject("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.match(buildThreeViewerHtml({ token: "abc_123", title: "预览" }), /OrbitControls/);
  assert.match(buildThreeViewerHtml({ token: "abc_123", title: "预览" }), /scene\.json/);
  assert.equal(defaultThreeScene().rig.animations[0].name, "wave");
});
