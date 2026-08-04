const crypto = require("node:crypto");
const path = require("node:path");

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3_600;
const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function trim(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value, fallback = true) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return fallback;
  return !["false", "0", "no", "off"].includes(normalized);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function uriEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeObjectKey(key) {
  return String(key).split("/").map(uriEncode).join("/");
}

function normalizeObjectKey(value) {
  const raw = trim(value).replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || raw.split("/").includes("..")) {
    throw new Error("对象存储路径无效。 ");
  }
  return raw.split("/").filter(Boolean).join("/");
}

function normalizePrefix(value) {
  const raw = trim(value).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!raw) return "role-bot";
  return normalizeObjectKey(raw);
}

function normalizeEndpoint(value, region, provider = "wasabi", accountId = "") {
  let endpoint = trim(value);
  if (!endpoint) {
    endpoint = provider === "r2"
      ? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")
      : region === "us-east-1"
        ? "https://s3.wasabisys.com"
        : `https://s3.${region}.wasabisys.com`;
  }
  if (!endpoint) return "";
  if (!/^https?:\/\//iu.test(endpoint)) endpoint = `https://${endpoint}`;
  return endpoint.replace(/\/+$/, "");
}

function normalizeMimeType(value) {
  const normalized = trim(value).split(";", 1)[0].toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/u.test(normalized) ? normalized : "application/octet-stream";
}

function safeFilename(value) {
  const filename = path.posix.basename(trim(value).replaceAll("\\", "/"));
  return filename.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 160) || "asset.bin";
}

function canonicalizeQuery(entries) {
  return [...entries]
    .map(([key, value]) => [uriEncode(key), uriEncode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    ))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function canonicalizeHeaders(headers) {
  const normalized = Object.entries(headers)
    .map(([key, value]) => [String(key).toLowerCase().trim(), String(value).trim().replace(/\s+/g, " ")])
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: normalized.map(([key, value]) => `${key}:${value}\n`).join(""),
    signed: normalized.map(([key]) => key).join(";"),
    headers: Object.fromEntries(normalized),
  };
}

function signingKey(secret, dateStamp, region) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function firstEnvValue(env, names) {
  for (const name of names) {
    const value = trim(env[name]);
    if (value) return value;
  }
  return "";
}

function createS3AssetStore({ runtimeEnv = process.env, fetchImpl = globalThis.fetch } = {}) {
  const env = runtimeEnv || {};
  const requestedProvider = trim(env.ASSET_STORAGE_PROVIDER || env.OBJECT_STORAGE_PROVIDER).toLowerCase();
  const hasR2Fields = [
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ].some((name) => Boolean(trim(env[name])));
  const provider = ["r2", "cloudflare-r2", "cloudflare_r2"].includes(requestedProvider)
    || (!requestedProvider && hasR2Fields)
    ? "r2"
    : requestedProvider || "wasabi";
  const providerPrefix = provider === "r2" ? "R2" : "WASABI";
  const storageLabel = provider === "r2" ? "Cloudflare R2" : provider === "wasabi" ? "Wasabi" : "对象存储";
  const envValue = (suffix, aliases = []) => firstEnvValue(env, [
    `${providerPrefix}_${suffix}`,
    `ASSET_STORAGE_${suffix}`,
    ...aliases,
  ]);
  const enabled = parseBoolean(envValue("ENABLED"), true);
  const accessKeyId = envValue("ACCESS_KEY_ID");
  const accessKeySecret = envValue("SECRET_ACCESS_KEY") || envValue("ACCESS_KEY_SECRET");
  const sessionToken = envValue("SESSION_TOKEN") || envValue("SECURITY_TOKEN");
  const bucket = envValue("BUCKET");
  const region = envValue("REGION") || (provider === "r2" ? "auto" : "us-east-1");
  const accountId = envValue("ACCOUNT_ID");
  const endpoint = normalizeEndpoint(envValue("ENDPOINT"), region, provider, accountId);
  const prefix = normalizePrefix(envValue("PREFIX") || "role-bot");
  const rawUrlMode = envValue("URL_MODE").toLowerCase();
  const urlMode = ["public", "signed"].includes(rawUrlMode)
    ? rawUrlMode
    : "signed";
  const signedUrlTtlSeconds = clamp(
    Number(envValue("SIGNED_URL_TTL_SECONDS")) || DEFAULT_SIGNED_URL_TTL_SECONDS,
    60,
    MAX_SIGNED_URL_TTL_SECONDS,
  );
  const configuredMaxBytes = clamp(
    Number(envValue("MAX_BYTES")) || DEFAULT_MAX_BYTES,
    16 * 1024,
    2 * 1024 * 1024 * 1024,
  );
  const configured = enabled && Boolean(accessKeyId && accessKeySecret && bucket && endpoint);
  const publicBaseUrl = envValue("PUBLIC_BASE_URL").replace(/\/+$/, "")
    || (endpoint && bucket ? `${endpoint}/${uriEncode(bucket)}` : "");

  function describe() {
    return {
      provider,
      enabled,
      configured,
      bucket: bucket || null,
      region,
      endpoint,
      prefix,
      urlMode,
      publicBaseUrl: publicBaseUrl || null,
      signedUrlTtlSeconds,
      maxBytes: configuredMaxBytes,
    };
  }

  function assertReady() {
    if (!enabled) throw new Error(`${storageLabel} 存储已关闭。 `);
    if (!configured) {
      const required = provider === "r2"
        ? "R2_BUCKET、R2_ENDPOINT、R2_REGION=auto、R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY"
        : "WASABI_BUCKET、WASABI_REGION、WASABI_ACCESS_KEY_ID 和 WASABI_SECRET_ACCESS_KEY";
      throw new Error(`${storageLabel} 未配置完整，请设置 ${required}。 `);
    }
    if (typeof fetchImpl !== "function") throw new Error("当前 Node.js 环境没有可用的 fetch。 ");
  }

  function createObjectKey({ category = "asset", scope = null, filename = "asset.bin" } = {}) {
    const normalizedCategory = normalizeObjectKey(category).replace(/[^A-Za-z0-9._/-]/g, "_");
    const scopeSeed = scope && scope.userId !== undefined && scope.chatId !== undefined
      ? `${scope.userId}:${scope.chatId}`
      : "global";
    const scopeHash = sha256Hex(scopeSeed).slice(0, 20);
    const unique = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
    return `${prefix}/${normalizedCategory}/${scopeHash}/${unique}-${safeFilename(filename)}`;
  }

  function objectUrl(key) {
    const normalizedKey = normalizeObjectKey(key);
    return new URL(`${endpoint}/${uriEncode(bucket)}/${encodeObjectKey(normalizedKey)}`);
  }

  function getCanonicalRequest({ method, url, headers, payloadHash, query = "" }) {
    const canonical = canonicalizeHeaders(headers);
    return {
      canonicalRequest: [
        method.toUpperCase(),
        url.pathname || "/",
        query,
        canonical.canonical,
        canonical.signed,
        payloadHash,
      ].join("\n"),
      canonicalHeaders: canonical,
    };
  }

  function authorizationHeaders({ method, url, payloadHash, contentType = "", query = "", requestDate = new Date() }) {
    const amzDate = requestDate.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const headers = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = normalizeMimeType(contentType);
    if (sessionToken) headers["x-amz-security-token"] = sessionToken;
    const canonical = getCanonicalRequest({ method, url, headers, payloadHash, query });
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonical.canonicalRequest),
    ].join("\n");
    const signature = hmac(signingKey(accessKeySecret, dateStamp, region), stringToSign, "hex");
    return {
      ...canonical.canonicalHeaders.headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${canonical.canonicalHeaders.signed}, Signature=${signature}`,
    };
  }

  async function request({ method, key, body = undefined, contentType = "", maxBytes: limit = configuredMaxBytes } = {}) {
    assertReady();
    const url = objectUrl(key);
    const bodyBuffer = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (bodyBuffer && bodyBuffer.length > limit) throw new Error(`文件超过 ${storageLabel} ${limit} 字节限制。`);
    const payloadHash = bodyBuffer ? sha256Hex(bodyBuffer) : EMPTY_SHA256;
    const headers = authorizationHeaders({ method, url, payloadHash, contentType });
    const response = await fetchImpl(url, {
      method: method.toUpperCase(),
      headers,
      body: bodyBuffer || undefined,
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const detail = String(await response.text().catch(() => "")).slice(0, 400);
      throw new Error(`${storageLabel} ${method.toUpperCase()} 失败（HTTP ${response.status}）：${detail || "未知错误"}`);
    }
    return response;
  }

  async function getPublicUrl({ key, expiresIn = signedUrlTtlSeconds } = {}) {
    assertReady();
    const normalizedKey = normalizeObjectKey(key);
    if (urlMode === "public") {
      return `${publicBaseUrl}/${encodeObjectKey(normalizedKey)}`;
    }

    const url = objectUrl(normalizedKey);
    const requestDate = new Date();
    const amzDate = requestDate.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const queryEntries = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(clamp(Number(expiresIn) || signedUrlTtlSeconds, 60, MAX_SIGNED_URL_TTL_SECONDS))],
      ["X-Amz-SignedHeaders", "host"],
    ];
    if (sessionToken) queryEntries.push(["X-Amz-Security-Token", sessionToken]);
    const canonicalQuery = canonicalizeQuery(queryEntries);
    const canonicalRequest = [
      "GET",
      url.pathname || "/",
      canonicalQuery,
      `host:${url.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmac(signingKey(accessKeySecret, dateStamp, region), stringToSign, "hex");
    return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  async function putBuffer({ key, buffer, contentType, filename, category = "asset", scope } = {}) {
    const content = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    if (content.length === 0) throw new Error(`不能把空文件上传到 ${storageLabel}。 `);
    const objectKey = normalizeObjectKey(key || createObjectKey({ category, scope, filename }));
    await request({ method: "PUT", key: objectKey, body: content, contentType });
    return {
      ok: true,
      key: objectKey,
      bytes: content.length,
      url: await getPublicUrl({ key: objectKey }),
    };
  }

  async function getBuffer({ key, maxBytes: limit = configuredMaxBytes } = {}) {
    const response = await request({ method: "GET", key, maxBytes: limit });
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > limit) throw new Error(`${storageLabel} 文件超过 ${limit} 字节读取限制。`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > limit) throw new Error(`${storageLabel} 文件超过 ${limit} 字节读取限制。`);
    return content;
  }

  async function deleteObject({ key } = {}) {
    const objectKey = normalizeObjectKey(key);
    await request({ method: "DELETE", key: objectKey });
    return { ok: true, key: objectKey };
  }

  return {
    isConfigured: () => configured,
    describe,
    createObjectKey,
    getPublicUrl,
    putBuffer,
    getBuffer,
    deleteObject,
  };
}

const createWasabiAssetStore = createS3AssetStore;

module.exports = { createS3AssetStore, createWasabiAssetStore, normalizeObjectKey };
