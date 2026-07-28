const crypto = require("node:crypto");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const MCD_MCP_URL = "https://mcp.mcd.cn";
const MCD_AUTH_TYPE = "mcd-mcp-auth";
const MCD_PENDING_ACTION_TYPE = "mcd-mcp-pending-action";
const MCD_PENDING_ACTION_TTL_MS = 10 * 60 * 1000;
const MCD_MAX_TOOLS = 64;
const MCD_MUTATING_TOOLS = new Set([
  "delivery-create-address",
  "create-order",
  "auto-bind-coupons",
  "mall-create-order",
]);

function toUserKey(userId) {
  return String(userId || "").trim();
}

function getEncryptionKey() {
  // A dedicated key lets the bot token be rotated without losing saved MCP
  // credentials. Falling back keeps upgrades working until the owner adds it.
  const secret = process.env.MCD_TOKEN_ENCRYPTION_KEY || process.env.TG_BOT_TOKEN || "";
  if (!secret) {
    throw new Error("缺少 MCD_TOKEN_ENCRYPTION_KEY 或 TG_BOT_TOKEN，无法安全保存麦当劳 MCP Token。");
  }
  return crypto.createHash("sha256").update(`mcd-mcp:${secret}`).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptSecret(payload) {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext) {
    throw new Error("保存的麦当劳 MCP 凭据格式不完整，请重新配置。"
    );
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeToken(value) {
  const token = typeof value === "string"
    ? value.trim().replace(/^Bearer\s+/i, "")
    : "";
  if (!token || token.length > 2048 || /\s/.test(token)) {
    return null;
  }
  return token;
}

function toFunctionName(remoteName, usedNames) {
  const normalized = String(remoteName || "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool";
  const base = `mcd_${normalized}`.slice(0, 56);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base.slice(0, 60 - String(suffix).length)}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function toOpenAiParameters(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return { type: "object", properties: {}, additionalProperties: false };
  }

  const parameters = JSON.parse(JSON.stringify(inputSchema));
  delete parameters.$schema;
  if (!parameters.type) {
    parameters.type = "object";
  }
  if (!parameters.properties || typeof parameters.properties !== "object") {
    parameters.properties = {};
  }
  return parameters;
}

function truncateText(value, maxLength) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…（已截断）` : text;
}

function normalizeMcpResult(result) {
  const content = Array.isArray(result?.content)
    ? result.content.map((item) => {
        if (item?.type === "text") {
          return { type: "text", text: truncateText(item.text || "", 6_000) };
        }
        if (item?.type === "image") {
          return { type: "image", note: "MCP 返回了一张图片，已省略二进制内容。" };
        }
        if (item?.type === "resource") {
          return { type: "resource", note: "MCP 返回了资源内容。" };
        }
        return { type: String(item?.type || "unknown"), note: "MCP 返回了非文本内容。" };
      })
    : [];
  const normalized = {
    ok: !result?.isError,
    content,
    ...(result?.structuredContent ? { structuredContent: result.structuredContent } : {}),
  };
  const encoded = JSON.stringify(normalized);
  return encoded.length > 12_000
    ? {
        ok: normalized.ok,
        content: [{ type: "text", text: `${encoded.slice(0, 11_500)}…（结果过长，已截断）` }],
        truncated: true,
      }
    : normalized;
}

const TELEGRAM_LABELS = {
  name: "名称",
  storeName: "门店",
  store_name: "门店",
  address: "地址",
  distance: "距离",
  distanceText: "距离",
  distance_text: "距离",
  phone: "电话",
  businessHours: "营业时间",
  business_hours: "营业时间",
  price: "价格",
  totalPrice: "应付金额",
  total_price: "应付金额",
  deliveryFee: "配送费",
  delivery_fee: "配送费",
  discount: "优惠",
  discountAmount: "优惠金额",
  discount_amount: "优惠金额",
  points: "积分",
  orderNo: "订单号",
  order_no: "订单号",
  orderStatus: "订单状态",
  order_status: "订单状态",
  status: "状态",
  couponName: "优惠券",
  coupon_name: "优惠券",
  validUntil: "有效期至",
  valid_until: "有效期至",
  quantity: "数量",
  code: "编码",
  productCode: "餐品编码",
  product_code: "餐品编码",
  calories: "能量",
  protein: "蛋白质",
  fat: "脂肪",
  carbohydrate: "碳水化合物",
  sodium: "钠",
};
const SENSITIVE_RESULT_KEY = /(?:token|secret|authorization|password|cookie)/i;
const URL_RESULT_KEY = /(?:url|link|payment|pay|deeplink)/i;

function toTelegramLabel(key) {
  if (TELEGRAM_LABELS[key]) {
    return TELEGRAM_LABELS[key];
  }
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function parseJsonText(text) {
  if (typeof text !== "string") {
    return null;
  }
  const candidate = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!candidate || !/^[{[]/.test(candidate)) {
    return null;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function formatTelegramScalar(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return truncateText(String(value), 240);
}

function summarizeTelegramObject(value) {
  const preferredKeys = [
    "name",
    "storeName",
    "store_name",
    "title",
    "productName",
    "product_name",
    "couponName",
    "coupon_name",
  ];
  const titleKey = preferredKeys.find(
    (key) => typeof value?.[key] === "string" && value[key].trim(),
  );
  const entries = Object.entries(value || {})
    .filter(([key, item]) => !SENSITIVE_RESULT_KEY.test(key) && !URL_RESULT_KEY.test(key))
    .filter(([, item]) => item !== null && item !== undefined && typeof item !== "object")
    .slice(0, 4);
  const details = entries
    .filter(([key]) => key !== titleKey)
    .map(([key, item]) => `${toTelegramLabel(key)}：${formatTelegramScalar(item)}`)
    .join(" · ");
  return [titleKey ? formatTelegramScalar(value[titleKey]) : "", details]
    .filter(Boolean)
    .join(details && titleKey ? "\n" : "") || "（无可显示字段）";
}

function formatTelegramValue(value, depth = 0) {
  if (value === null || value === undefined || typeof value !== "object") {
    return formatTelegramScalar(value);
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((item) => {
      if (item && typeof item === "object") {
        return `• ${summarizeTelegramObject(item)}`;
      }
      return `• ${formatTelegramScalar(item)}`;
    });
    if (value.length > items.length) {
      items.push(`…另有 ${value.length - items.length} 项`);
    }
    return items.join("\n") || "-";
  }
  if (depth >= 2) {
    return summarizeTelegramObject(value);
  }
  return Object.entries(value)
    .filter(([key]) => !SENSITIVE_RESULT_KEY.test(key) && !URL_RESULT_KEY.test(key))
    .filter(([, item]) => item !== null && item !== undefined)
    .slice(0, 12)
    .map(([key, item]) => {
      const rendered = formatTelegramValue(item, depth + 1);
      return typeof item === "object"
        ? `${toTelegramLabel(key)}：\n${rendered}`
        : `${toTelegramLabel(key)}：${rendered}`;
    })
    .join("\n") || "-";
}

function collectTelegramLinks(value, links = [], seen = new Set(), keyHint = "") {
  if (typeof value === "string") {
    const matches = value.match(/https:\/\/[^\s<>"']+/g) || [];
    for (const url of matches) {
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ url, keyHint });
      }
    }
    return links;
  }
  if (!value || typeof value !== "object") {
    return links;
  }
  for (const [key, item] of Object.entries(value)) {
    collectTelegramLinks(item, links, seen, key);
  }
  return links;
}

function getTelegramLinkLabel(keyHint, index) {
  if (/(?:payment|pay)/i.test(keyHint)) {
    return "去支付";
  }
  if (/(?:order)/i.test(keyHint)) {
    return "查看订单";
  }
  if (/(?:coupon)/i.test(keyHint)) {
    return "查看优惠券";
  }
  return index === 0 ? "打开麦当劳" : "打开相关链接";
}

function formatMcpResultForTelegram(result, { title = "麦当劳" } = {}) {
  const textBlocks = (result?.content || [])
    .filter((item) => item.type === "text" && item.text)
    .map((item) => String(item.text));
  const jsonBlocks = textBlocks.map(parseJsonText).filter(Boolean);
  const data = result?.structuredContent || (jsonBlocks.length === 1 ? jsonBlocks[0] : null);
  const body = data
    ? formatTelegramValue(data)
    : textBlocks.join("\n\n") || (result?.ok ? "操作已完成。" : "麦当劳 MCP 没有返回可显示的结果。");
  const rawForLinks = data || textBlocks;
  const links = collectTelegramLinks(rawForLinks).slice(0, 3);
  const inlineKeyboard = links.map((link, index) => [
    { text: getTelegramLinkLabel(link.keyHint, index), url: link.url },
  ]);

  return {
    text: truncateText(`🍟 ${title}\n\n${body}`, 11_500),
    ...(inlineKeyboard.length > 0
      ? { replyMarkup: { inline_keyboard: inlineKeyboard } }
      : {}),
  };
}

function getFriendlyError(error) {
  const message = String(error?.message || error || "未知错误");
  if (/HTTP 401|Unauthorized/i.test(message)) {
    return "麦当劳 MCP Token 无效或已过期。请使用 /mcd set <新 Token> 重新配置。";
  }
  if (/HTTP 429|rate.?limit/i.test(message)) {
    return "麦当劳 MCP 当前请求过于频繁，请稍后再试。";
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return "连接麦当劳 MCP 超时，请稍后再试。";
  }
  return "连接或调用麦当劳 MCP 失败，请稍后重试；若持续失败，请重新配置 Token。";
}

function isConfirmationRequired(remoteToolName) {
  return MCD_MUTATING_TOOLS.has(remoteToolName);
}

function getConfirmationLabel(remoteToolName) {
  const labels = {
    "delivery-create-address": "新增麦当劳配送地址",
    "create-order": "创建麦当劳订单",
    "auto-bind-coupons": "一键领取麦当劳优惠券",
    "mall-create-order": "使用积分兑换麦当劳商品券",
  };
  return labels[remoteToolName] || "执行麦当劳账户操作";
}

function createMcDonaldsMcp({ db }) {
  async function findAuth(userId) {
    return db.findOneAsync({ type: MCD_AUTH_TYPE, userId: toUserKey(userId) });
  }

  async function getStoredToken(userId) {
    const auth = await findAuth(userId);
    if (!auth) {
      return null;
    }
    return decryptSecret(auth.token);
  }

  async function connectWithToken(token) {
    const client = new Client({ name: "localtest-mcd-bridge", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(MCD_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });

    try {
      await client.connect(transport);
      const tools = [];
      let cursor;
      do {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...(Array.isArray(result.tools) ? result.tools : []));
        cursor = result.nextCursor;
      } while (cursor && tools.length < MCD_MAX_TOOLS);

      return {
        client,
        transport,
        tools: tools.slice(0, MCD_MAX_TOOLS),
        async close() {
          try {
            await transport.terminateSession();
          } catch {
            // Session deletion is optional for Streamable HTTP servers.
          }
          await client.close().catch(() => undefined);
        },
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async function configureToken(userId, rawToken) {
    const userKey = toUserKey(userId);
    const token = normalizeToken(rawToken);
    if (!userKey || !token) {
      return { ok: false, error: "Token 格式不正确。请只粘贴 MCP Token，不要包含空格或引号。" };
    }

    let session;
    try {
      session = await connectWithToken(token);
      if (session.tools.length === 0) {
        return { ok: false, error: "MCP 已连接，但没有发现可用工具；未保存 Token。" };
      }
    } catch (error) {
      return { ok: false, error: getFriendlyError(error) };
    } finally {
      await session?.close();
    }

    const existing = await findAuth(userKey);
    const now = new Date().toISOString();
    const update = {
      token: encryptSecret(token),
      updatedAt: now,
      lastVerifiedAt: now,
    };
    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: update });
    } else {
      await db.insertAsync({
        type: MCD_AUTH_TYPE,
        userId: userKey,
        createdAt: now,
        ...update,
      });
    }
    return { ok: true, toolCount: session?.tools?.length || 0 };
  }

  async function getStatus(userId) {
    const auth = await findAuth(userId);
    if (!auth) {
      return { configured: false };
    }
    return {
      configured: true,
      updatedAt: auth.updatedAt || auth.createdAt || "",
      lastVerifiedAt: auth.lastVerifiedAt || "",
    };
  }

  async function clearToken(userId) {
    const userKey = toUserKey(userId);
    await db.removeAsync({ type: MCD_AUTH_TYPE, userId: userKey }, { multi: true });
    await db.removeAsync({ type: MCD_PENDING_ACTION_TYPE, userId: userKey }, { multi: true });
  }

  async function openSessionForUser(userId) {
    const userKey = toUserKey(userId);
    const token = await getStoredToken(userKey);
    if (!token) {
      return null;
    }

    const session = await connectWithToken(token);
    const usedNames = new Set();
    const toolByFunctionName = new Map();
    const toolDefinitions = session.tools.map((tool) => {
      const functionName = toFunctionName(tool.name, usedNames);
      toolByFunctionName.set(functionName, tool);
      return {
        type: "function",
        function: {
          name: functionName,
          description: `麦当劳中国 MCP：${String(tool.description || tool.name).slice(0, 800)}`,
          parameters: toOpenAiParameters(tool.inputSchema),
        },
      };
    });

    return {
      userId: userKey,
      toolDefinitions,
      getRemoteTool(functionName) {
        return toolByFunctionName.get(functionName) || null;
      },
      async callTool(remoteToolName, args) {
        const result = await session.client.callTool({
          name: remoteToolName,
          arguments: args,
        });
        return normalizeMcpResult(result);
      },
      async close() {
        await session.close();
      },
    };
  }

  async function createPendingAction(userId, remoteToolName, args) {
    const userKey = toUserKey(userId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MCD_PENDING_ACTION_TTL_MS).toISOString();
    const payload = encryptSecret(JSON.stringify({ remoteToolName, args }));
    const existing = await db.findOneAsync({
      type: MCD_PENDING_ACTION_TYPE,
      userId: userKey,
      status: "pending",
    });
    const update = {
      payload,
      label: getConfirmationLabel(remoteToolName),
      expiresAt,
      status: "pending",
      updatedAt: now.toISOString(),
    };
    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: update });
    } else {
      await db.insertAsync({
        type: MCD_PENDING_ACTION_TYPE,
        userId: userKey,
        createdAt: now.toISOString(),
        ...update,
      });
    }
    return { label: update.label, expiresAt };
  }

  async function confirmPendingAction(userId) {
    const userKey = toUserKey(userId);
    const action = await db.findOneAsync({
      type: MCD_PENDING_ACTION_TYPE,
      userId: userKey,
      status: "pending",
    });
    if (!action) {
      return { ok: false, error: "没有等待确认的麦当劳操作。" };
    }
    if (new Date(action.expiresAt).getTime() <= Date.now()) {
      await db.removeAsync({ _id: action._id });
      return { ok: false, error: "这项麦当劳操作已过期，请重新发起。" };
    }

    const locked = await db.updateAsync(
      { _id: action._id, status: "pending" },
      { $set: { status: "executing", confirmedAt: new Date().toISOString() } },
    );
    if (!locked) {
      return { ok: false, error: "这项麦当劳操作正在执行或已失效，请稍后查看结果。" };
    }

    let pending;
    let session;
    try {
      pending = JSON.parse(decryptSecret(action.payload));
      if (!isConfirmationRequired(pending.remoteToolName)) {
        throw new Error("待确认操作类型无效。");
      }
      session = await openSessionForUser(userKey);
      if (!session) {
        return { ok: false, error: "未找到麦当劳 MCP Token，请先使用 /mcd set 配置。" };
      }
      const result = await session.callTool(pending.remoteToolName, pending.args);
      await db.removeAsync({ _id: action._id });
      return { ok: result.ok, result };
    } catch (error) {
      await db.updateAsync(
        { _id: action._id },
        { $set: { status: "pending", lastErrorAt: new Date().toISOString() } },
      );
      return { ok: false, error: getFriendlyError(error) };
    } finally {
      await session?.close();
    }
  }

  return {
    MCD_MCP_URL,
    configureToken,
    getStatus,
    clearToken,
    openSessionForUser,
    createPendingAction,
    confirmPendingAction,
    isConfirmationRequired,
    getConfirmationLabel,
    formatMcpResultForTelegram,
    getFriendlyError,
  };
}

module.exports = { createMcDonaldsMcp };
