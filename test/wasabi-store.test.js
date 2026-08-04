"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createWasabiAssetStore, normalizeObjectKey } = require("../lib/wasabi-store");

function responseFor(buffer = Buffer.alloc(0)) {
  const payload = Buffer.from(buffer);
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length" ? String(payload.length) : null;
      },
    },
    text: async () => "",
    arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  };
}

function credentials(overrides = {}) {
  return {
    WASABI_BUCKET: "demo-bucket",
    WASABI_REGION: "us-east-1",
    WASABI_ENDPOINT: "https://s3.wasabisys.com",
    WASABI_ACCESS_KEY_ID: "TESTACCESSKEY",
    WASABI_SECRET_ACCESS_KEY: "test-secret-key",
    WASABI_PREFIX: "role-bot",
    ...overrides,
  };
}

test("uploads with S3-compatible SigV4 and returns a signed public URL", async () => {
  const calls = [];
  const store = createWasabiAssetStore({
    runtimeEnv: credentials(),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return responseFor();
    },
  });

  const uploaded = await store.putBuffer({
    buffer: Buffer.from("image-bytes"),
    contentType: "image/png; charset=binary",
    category: "image-history",
    scope: { chatId: 11, userId: 22 },
    filename: "角色设定图.png",
  });

  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.bytes, 11);
  assert.match(uploaded.key, /^role-bot\/image-history\/[a-f0-9]{20}\//);
  assert.match(uploaded.url, /^https:\/\/s3\.wasabisys\.com\/demo-bucket\//);
  assert.match(uploaded.url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(uploaded.url, /X-Amz-Signature=[a-f0-9]{64}/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.body.toString(), "image-bytes");
  assert.match(calls[0].options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY\//);
  assert.equal(calls[0].options.headers["content-type"], "image/png");
});

test("supports stable URLs when the Wasabi bucket has a public-read policy", async () => {
  const store = createWasabiAssetStore({
    runtimeEnv: credentials({
      WASABI_URL_MODE: "public",
      WASABI_PUBLIC_BASE_URL: "https://cdn.example.test/assets/",
    }),
  });

  const url = await store.getPublicUrl({ key: "role-bot/workspace/report final.pdf" });
  assert.equal(url, "https://cdn.example.test/assets/role-bot/workspace/report%20final.pdf");
  assert.equal(store.describe().urlMode, "public");
});

test("uses Cloudflare R2's auto region and endpoint configuration", async () => {
  const calls = [];
  const store = createWasabiAssetStore({
    runtimeEnv: {
      ASSET_STORAGE_PROVIDER: "r2",
      R2_BUCKET: "sekiyu",
      R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
      R2_ACCESS_KEY_ID: "R2ACCESS",
      R2_SECRET_ACCESS_KEY: "r2-secret",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return responseFor();
    },
  });

  const uploaded = await store.putBuffer({
    buffer: Buffer.from("r2-bytes"),
    contentType: "application/octet-stream",
    category: "workspace",
    filename: "file.bin",
  });
  assert.equal(store.describe().provider, "r2");
  assert.equal(store.describe().region, "auto");
  assert.match(calls[0].url, /^https:\/\/account-id\.r2\.cloudflarestorage\.com\/sekiyu\//);
  assert.match(calls[0].options.headers.Authorization, /\/auto\/s3\/aws4_request/);
  assert.match(uploaded.url, /^https:\/\/account-id\.r2\.cloudflarestorage\.com\/sekiyu\//);
});

test("downloads remote assets with a bounded response size", async () => {
  const calls = [];
  const store = createWasabiAssetStore({
    runtimeEnv: credentials({ WASABI_MAX_BYTES: "1024" }),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return responseFor(Buffer.from("remote-file"));
    },
  });

  const content = await store.getBuffer({ key: "role-bot/workspace/file.txt" });
  assert.equal(content.toString(), "remote-file");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.match(calls[0].options.headers.Authorization, /^AWS4-HMAC-SHA256 /);
});

test("rejects object keys that could escape the configured prefix", () => {
  assert.throws(() => normalizeObjectKey("../secret.txt"), /对象存储路径无效/);
  assert.throws(() => normalizeObjectKey("/secret.txt"), /对象存储路径无效/);
});
