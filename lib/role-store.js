const fs = require("node:fs");

const ROLE_CONVERSATION_HISTORY_TYPE = "role-conversation-history";
const DEFAULT_ROLE_HISTORY_MESSAGE_LIMIT = 400;

function createRoleStore({
  db,
  rolesSeedFile,
  telegramMessageLimit,
  roleHistoryMessageLimit = DEFAULT_ROLE_HISTORY_MESSAGE_LIMIT,
  formatMcdResultForTelegram,
  buildConversationExport,
  createConversationExportFilename,
}) {
  const sessionQueues = new Map();
  const historyMessageLimit = Math.max(
    32,
    Math.min(2_000, Math.floor(Number(roleHistoryMessageLimit) || DEFAULT_ROLE_HISTORY_MESSAGE_LIMIT)),
  );

  function getScope(ctx) {
    const chatId =
      ctx.chat?.id ?? ctx.message?.chat?.id ?? ctx.editedMessage?.chat?.id;
    const userId =
      ctx.from?.id ?? ctx.message?.from?.id ?? ctx.editedMessage?.from?.id;

    if (chatId === undefined || userId === undefined) {
      return null;
    }
    return { chatId, userId };
  }

  function getScopeKey({ chatId, userId }) {
    return `${chatId}:${userId}`;
  }

  function getRoleNameKey(roleName) {
    return String(roleName || "").trim().toLocaleLowerCase();
  }

  function runInSessionQueue(scope, work) {
    const key = getScopeKey(scope);
    const previous = sessionQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    sessionQueues.set(key, current);
    return current.finally(() => {
      if (sessionQueues.get(key) === current) {
        sessionQueues.delete(key);
      }
    });
  }

  function normalizeRole(role) {
    if (!role || typeof role !== "object" || typeof role.name !== "string") {
      return null;
    }

    const name = role.name.trim();
    const systemPrompt =
      role.systemPrompt ?? role.system_prompt ?? role.prompt ?? role.system ?? "";
    if (!name || typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      return null;
    }

    return {
      id: typeof role._id === "string" ? role._id : null,
      name,
      nameKey: name.toLocaleLowerCase(),
      description:
        typeof role.description === "string" && role.description.trim()
          ? role.description.trim()
          : "未提供角色简介。",
      systemPrompt: systemPrompt.trim(),
    };
  }

  function readSeedRoles() {
    try {
      const raw = fs.readFileSync(rolesSeedFile, "utf8");
      const roles = JSON.parse(raw);
      if (!Array.isArray(roles)) {
        throw new Error("角色种子配置必须是 JSON 数组");
      }
      return roles.map(normalizeRole).filter(Boolean);
    } catch (error) {
      console.error(`无法读取角色种子配置 ${rolesSeedFile}:`, error.message);
      return [];
    }
  }

  async function getRoles() {
    const databaseRoles = await db.findAsync({ type: "role" });
    const rolesByName = new Map();
    for (const role of databaseRoles) {
      const normalized = normalizeRole(role);
      if (normalized && !rolesByName.has(normalized.nameKey)) {
        rolesByName.set(normalized.nameKey, normalized);
      }
    }
    return [...rolesByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "zh-Hans-CN"),
    );
  }

  async function initializeRoleCatalog() {
    const initialized = await db.findOneAsync({
      type: "app-meta",
      key: "role-catalog-initialized",
    });
    if (initialized) {
      return;
    }

    const existingNames = new Set((await getRoles()).map((role) => role.nameKey));
    const now = new Date().toISOString();
    let insertedCount = 0;
    for (const role of readSeedRoles()) {
      if (existingNames.has(role.nameKey)) {
        continue;
      }
      await db.insertAsync({
        type: "role",
        name: role.name,
        nameKey: role.nameKey,
        description: role.description,
        systemPrompt: role.systemPrompt,
        createdAt: now,
        updatedAt: now,
        createdBy: "bootstrap",
      });
      existingNames.add(role.nameKey);
      insertedCount += 1;
    }
    await db.insertAsync({
      type: "app-meta",
      key: "role-catalog-initialized",
      initializedAt: now,
    });
    if (insertedCount > 0) {
      console.log(`已将 ${insertedCount} 个初始角色导入数据库`);
    }
  }

  function findRole(roles, requestedName) {
    const normalizedName = requestedName.trim().toLocaleLowerCase();
    return roles.find((role) => role.nameKey === normalizedName);
  }

  function formatRoleList(roles) {
    return roles
      .map((role, index) => `${index + 1}. ${role.name}\n${role.description}`)
      .join("\n\n");
  }

  function formatAdminRoleList(roles) {
    if (roles.length === 0) {
      return "当前数据库中还没有角色。";
    }
    return roles
      .map(
        (role, index) =>
          `${index + 1}. ${role.name}\n` +
          `简介：${role.description}\n` +
          `System prompt：\n${role.systemPrompt}`,
      )
      .join("\n\n");
  }

  function splitTelegramMessage(text) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > telegramMessageLimit) {
      const newline = remaining.lastIndexOf("\n", telegramMessageLimit);
      const space = remaining.lastIndexOf(" ", telegramMessageLimit);
      const splitAt = Math.max(newline, space, 1);
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) {
      chunks.push(remaining);
    }
    return chunks;
  }

  async function replyWithText(ctx, text) {
    for (const chunk of splitTelegramMessage(text)) {
      await ctx.reply(chunk);
    }
  }

  async function replyWithMcdTelegramResult(ctx, result, title = "麦当劳查询结果") {
    const message = formatMcdResultForTelegram(result, { title });
    const chunks = splitTelegramMessage(message.text);
    let delivered = false;
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const isLastChunk = index === chunks.length - 1;
        await ctx.reply(
          chunks[index],
          isLastChunk && message.replyMarkup
            ? { reply_markup: message.replyMarkup }
            : undefined,
        );
      }
      delivered = chunks.length > 0;
    } catch (error) {
      console.warn("发送麦当劳 MCP Telegram 消息失败:", error.message);
    }
    return delivered;
  }

  function getAssistantText(content) {
    if (typeof content === "string") {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === "string" ? part : part?.text || ""))
        .join("")
        .trim();
    }
    return "";
  }

  async function findActiveSession(scope) {
    return db.findOneAsync({ type: "chat-session", ...scope });
  }

  function getSessionConversationMessages(session) {
    if (!Array.isArray(session?.messages)) {
      return [];
    }
    return session.messages.filter((message) => (
      message
      && typeof message === "object"
      && message.role
      && message.role !== "system"
      && message.metadata?.source !== "role-schedule-proactive"
    ));
  }

  function trimRoleHistoryMessages(messages) {
    return messages.slice(-historyMessageLimit);
  }

  async function findRoleConversationHistory(scope, roleName) {
    const roleNameKey = getRoleNameKey(roleName);
    if (!roleNameKey) {
      return null;
    }
    return db.findOneAsync({
      type: ROLE_CONVERSATION_HISTORY_TYPE,
      ...scope,
      roleNameKey,
    });
  }

  async function archiveSessionHistory(scope, session) {
    if (!session?.roleName || !Array.isArray(session.messages)) {
      return { archived: false, appendedMessageCount: 0, historyMessageCount: 0 };
    }
    if (session.historyArchivedAt) {
      return {
        archived: false,
        appendedMessageCount: 0,
        historyMessageCount: Number(session.historyArchivedMessageCount) || 0,
      };
    }

    const conversationMessages = getSessionConversationMessages(session);
    const requestedBaseline = Number(session.historyBaselineMessageCount);
    const baseline = Number.isInteger(requestedBaseline)
      ? Math.min(conversationMessages.length, Math.max(0, requestedBaseline))
      : 0;
    const appendedMessages = conversationMessages.slice(baseline);
    const existingHistory = await findRoleConversationHistory(scope, session.roleName);
    const existingMessages = getSessionConversationMessages(existingHistory);
    const messages = trimRoleHistoryMessages([...existingMessages, ...appendedMessages]);
    const now = new Date().toISOString();
    const roleNameKey = getRoleNameKey(session.roleName);

    let history = existingHistory;
    if (existingHistory?._id) {
      await db.updateAsync(
        { _id: existingHistory._id, type: ROLE_CONVERSATION_HISTORY_TYPE },
        {
          $set: {
            roleName: session.roleName,
            roleNameKey,
            messages,
            updatedAt: now,
          },
        },
      );
      history = { ...existingHistory, messages, updatedAt: now };
    } else if (messages.length > 0) {
      history = await db.insertAsync({
        type: ROLE_CONVERSATION_HISTORY_TYPE,
        ...scope,
        roleName: session.roleName,
        roleNameKey,
        messages,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Mark the source session after the archive write. If a process restarts
    // before deleting that session, retrying /end or /newchat cannot append
    // the same messages a second time.
    await db.updateAsync(
      { _id: session._id, type: "chat-session" },
      {
        $set: {
          historyArchivedAt: now,
          historyArchivedMessageCount: messages.length,
        },
      },
    );

    return {
      archived: appendedMessages.length > 0,
      appendedMessageCount: appendedMessages.length,
      historyMessageCount: history?.messages?.length || 0,
      roleName: session.roleName,
    };
  }

  async function exportActiveSession(ctx, scope) {
    const session = await findActiveSession(scope);
    if (!session?.roleName || !Array.isArray(session.messages)) {
      await ctx.reply("当前没有进行中的对话。先用 /newchat 开始对话后再导出吧。");
      return;
    }
    const exportedAt = new Date();
    const exportedConversation = buildConversationExport({
      roleName: session.roleName,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages,
      exportedAt,
    });
    if (exportedConversation.messageCount === 0) {
      await ctx.reply("当前对话还没有可导出的消息。先和角色说点什么吧。");
      return;
    }
    const filename = createConversationExportFilename({
      roleName: session.roleName,
      exportedAt,
    });
    try {
      await ctx.sendChatAction("upload_document");
      await ctx.replyWithDocument(
        { source: Buffer.from(exportedConversation.content, "utf8"), filename },
        {
          caption:
            `已导出与「${session.roleName}」的当前对话（${exportedConversation.messageCount} 条消息）。` +
            "文件不包含 system prompt 或内部工具内容。",
        },
      );
    } catch (error) {
      console.error("导出当前对话失败:", error);
      await ctx.reply("导出对话失败，请稍后重试。当前对话不会受影响。");
    }
  }

  async function replaceActiveSession(scope, role) {
    const previousSessions = await db.findAsync({ type: "chat-session", ...scope });
    for (const session of previousSessions) {
      await archiveSessionHistory(scope, session);
    }
    await db.removeAsync({ type: "chat-session", ...scope }, { multi: true });
    const history = await findRoleConversationHistory(scope, role.name);
    const restoredMessages = trimRoleHistoryMessages(getSessionConversationMessages(history));
    const now = new Date().toISOString();
    return db.insertAsync({
      type: "chat-session",
      ...scope,
      roleName: role.name,
      messages: [{ role: "system", content: role.systemPrompt }, ...restoredMessages],
      historyBaselineMessageCount: restoredMessages.length,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function endActiveSession(scope) {
    const sessions = await db.findAsync({ type: "chat-session", ...scope });
    const archiveResults = [];
    for (const session of sessions) {
      archiveResults.push(await archiveSessionHistory(scope, session));
    }
    const removedCount = await db.removeAsync(
      { type: "chat-session", ...scope },
      { multi: true },
    );
    return {
      removedCount,
      archiveResults,
      archivedMessageCount: archiveResults.reduce(
        (total, result) => total + Number(result.appendedMessageCount || 0),
        0,
      ),
    };
  }

  async function clearRoleConversationHistory(scope, role, { sessionId = null } = {}) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) {
      return { ok: false, error: "当前角色数据不完整，无法清空对话记录。" };
    }

    const session = sessionId
      ? await db.findOneAsync({ _id: sessionId, type: "chat-session", ...scope })
      : await findActiveSession(scope);
    if (!session?.roleName || getRoleNameKey(session.roleName) !== normalizedRole.nameKey) {
      return { ok: false, error: "当前角色会话已变更，请重新执行清空操作。" };
    }

    const history = await findRoleConversationHistory(scope, normalizedRole.name);
    const historyMessageCount = getSessionConversationMessages(history).length;
    const sessionMessageCount = getSessionConversationMessages(session).length;
    const now = new Date().toISOString();

    // Deliberately skip archiveSessionHistory here: /clear must remove both
    // the active context and the persisted same-role history, rather than
    // saving the active context back into the history record first.
    await db.removeAsync(
      {
        type: ROLE_CONVERSATION_HISTORY_TYPE,
        ...scope,
        roleNameKey: normalizedRole.nameKey,
      },
      { multi: true },
    );
    await db.removeAsync({ _id: session._id, type: "chat-session", ...scope }, {});
    const nextSession = await db.insertAsync({
      type: "chat-session",
      ...scope,
      roleName: normalizedRole.name,
      messages: [{ role: "system", content: normalizedRole.systemPrompt }],
      historyBaselineMessageCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      roleName: normalizedRole.name,
      session: nextSession,
      clearedHistoryMessageCount: historyMessageCount,
      clearedSessionMessageCount: sessionMessageCount,
    };
  }

  async function refreshActiveSessionSystemPrompt(scope, role) {
    const session = await findActiveSession(scope);
    if (!session?.roleName || !Array.isArray(session.messages)) {
      return { ok: false, error: "当前没有进行中的对话。先用 /newchat 开始对话后再刷新设定。" };
    }

    const messages = [...session.messages];
    const systemMessageIndex = messages.findIndex((message) => message?.role === "system");
    const systemMessage = { role: "system", content: role.systemPrompt };
    if (systemMessageIndex >= 0) {
      messages[systemMessageIndex] = systemMessage;
    } else {
      messages.unshift(systemMessage);
    }

    await db.updateAsync(
      { _id: session._id, type: "chat-session" },
      {
        $set: {
          roleName: role.name,
          messages,
          updatedAt: new Date().toISOString(),
        },
      },
    );
    return { ok: true, roleName: role.name };
  }

  return {
    archiveSessionHistory,
    clearRoleConversationHistory,
    endActiveSession,
    exportActiveSession,
    findActiveSession,
    findRole,
    findRoleConversationHistory,
    formatAdminRoleList,
    formatRoleList,
    getAssistantText,
    getRoles,
    getScope,
    initializeRoleCatalog,
    normalizeRole,
    replyWithMcdTelegramResult,
    replyWithText,
    refreshActiveSessionSystemPrompt,
    replaceActiveSession,
    runInSessionQueue,
    splitTelegramMessage,
  };
}

module.exports = { createRoleStore };
