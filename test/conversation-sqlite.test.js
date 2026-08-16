"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSqliteDatabase } = require("../lib/sqlite-database");
const { convertMessages } = require("../lib/minimax-anthropic");

test("processes a role conversation through SQLite and persists the assistant reply", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "localtest-conversation-sqlite-"));
  const filename = path.join(directory, "data.sqlite");
  const seedDb = createSqliteDatabase({ filename });
  await seedDb.insertAsync({
    _id: "smoke-role",
    type: "role",
    name: "测试角色",
    nameKey: "测试角色",
    description: "用于本地对话链路测试。",
    systemPrompt: "你是一个温柔、简洁的测试角色。",
    createdAt: new Date().toISOString(),
  });
  seedDb.close();

  const previousEnvironment = {
    SQLITE_DATABASE_FILE: process.env.SQLITE_DATABASE_FILE,
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    ROLE_SCHEDULE_ENABLED: process.env.ROLE_SCHEDULE_ENABLED,
    MCD_AUTO_LOAD_ENABLED: process.env.MCD_AUTO_LOAD_ENABLED,
    NEWAPI_BASE_URL: process.env.NEWAPI_BASE_URL,
    NEWAPI_API_KEY: process.env.NEWAPI_API_KEY,
    NEWAPI_IMAGE_MODEL: process.env.NEWAPI_IMAGE_MODEL,
    NEWAPI_IMAGE_SIZE: process.env.NEWAPI_IMAGE_SIZE,
  };
  process.env.SQLITE_DATABASE_FILE = filename;
  process.env.TG_BOT_TOKEN ||= "123456:LOCAL_TEST";
  process.env.OPENAI_API_KEY ||= "local-test-key";
  process.env.MODEL_PROVIDER = "default";
  process.env.ROLE_SCHEDULE_ENABLED = "false";
  process.env.MCD_AUTO_LOAD_ENABLED = "false";
  process.env.NEWAPI_BASE_URL = "https://example.test";
  process.env.NEWAPI_API_KEY = "local-newapi-test-key";
  process.env.NEWAPI_IMAGE_MODEL = "GPT-Image-2";
  process.env.NEWAPI_IMAGE_SIZE = "1024x1024";

  let app = null;
  try {
    app = require("../index");
    assert.equal(
      app.getNewApiEndpoint("/images/generations", "https://hub.yongmuai.com"),
      "https://hub.yongmuai.com/v1/images/generations",
    );
    assert.equal(
      app.getNewApiEndpoint("images/edits", "https://hub.yongmuai.com/v1/"),
      "https://hub.yongmuai.com/v1/images/edits",
    );
    assert.equal(app.getNewApiImageResponseFormat("GPT-Image-2"), "");
    assert.equal(app.getNewApiImageResponseFormat("gemini-3.1-flash-image"), "url");
    assert.deepEqual(
      Object.fromEntries(
        ["1:1", "3:4", "4:3", "9:16", "16:9"].map((ratio) => [
          ratio,
          app.getNewApiImageSizeForAspectRatio(ratio),
        ]),
      ),
      {
        "1:1": "1024x1024",
        "3:4": "1152x1536",
        "4:3": "1536x1152",
        "9:16": "1024x1792",
        "16:9": "1792x1024",
      },
    );
    assert.equal(app.normalizeNewApiImageSize("1080x1920"), "1024x1792");
    assert.equal(app.normalizeNewApiImageSize("1920x1080"), "1792x1024");
    assert.equal(app.hasNewApiSensitiveVisualTerms("透明蕾丝女仆装"), true);
    assert.equal(app.hasNewApiSensitiveVisualTerms("阳光下的普通咖啡馆"), false);
    const safeFallbackPrompt = app.buildNewApiSafeImageFallbackPrompt([
      "当前实体状态：穿着=透明蕾丝女仆装。",
      "原始媒体意图（不得覆盖上述当前状态）：",
      "一位成年人坐在阳光明亮的咖啡馆里读书。",
    ].join("\n"));
    assert.match(safeFallbackPrompt, /适合公开展示/);
    assert.match(safeFallbackPrompt, /咖啡馆里读书/);
    assert.doesNotMatch(safeFallbackPrompt, /透明|蕾丝|女仆/);
    const legacyStateBoundImagePrompt = [
      "角色连续性状态锁（必须遵守）：",
      "当前地点：主卧工作角。",
      "当前实体状态：穿着=透明蕾丝女仆装。",
      "原始媒体意图（不得覆盖上述当前状态）：",
      "一位成年人坐在阳光明亮的咖啡馆里读书。",
    ].join("\n");
    assert.equal(
      app.stripInjectedRoleStateFromImagePrompt(legacyStateBoundImagePrompt),
      "一位成年人坐在阳光明亮的咖啡馆里读书。",
    );
    assert.equal(
      app.stripInjectedRoleStateFromImagePrompt([
        "【系统附带：本轮实时角色状态（只对本轮回复生效，不写入会话历史）】",
        "角色日程运行时状态：当前地点：主卧工作角。",
        "【以下才是用户本轮消息】",
        "请生成一张在咖啡馆里读书的照片。",
      ].join("\n")),
      "请生成一张在咖啡馆里读书的照片。",
    );
    assert.equal(
      app.stripInjectedRoleStateFromImageContext([
        "system: 你是一个长期陪伴用户的角色。",
        "【系统附带：本轮实时角色状态（只对本轮回复生效，不写入会话历史）】",
        "角色日程运行时状态：当前地点：主卧工作角。",
        "【以下才是用户本轮消息】",
        "user: 请生成一张在咖啡馆里读书的照片。",
      ].join("\n")),
      [
        "system: 你是一个长期陪伴用户的角色。",
        "user: 请生成一张在咖啡馆里读书的照片。",
      ].join("\n"),
    );
    assert.equal(
      app.isNewApiLikelyContentRejection(400, {
        error: { message: "系统处理信息故障，请重试或者联系客服" },
      }, ""),
      true,
    );
    const originalFetch = global.fetch;
    const originalConsoleWarn = console.warn;
    const newApiRequests = [];
    global.fetch = async (_endpoint, options) => {
      const body = JSON.parse(options.body);
      newApiRequests.push(body);
      if (newApiRequests.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: { message: "系统处理信息故障，请重试或者联系客服" },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ b64_json: "AQ==" }] }),
      };
    };
    console.warn = () => undefined;
    try {
      const fallbackResult = await app.requestNewApiCharacterImage(
        "角色穿着透明蕾丝女仆装，坐在咖啡馆里。",
        {
          aspectRatio: "3:4",
          fallbackPrompt: "一位成年人坐在阳光明亮的咖啡馆里读书。",
        },
      );
      assert.deepEqual(fallbackResult, { ok: true, b64Json: "AQ==" });
      assert.equal(newApiRequests.length, 2);
      assert.equal(newApiRequests[0].size, "1152x1536");
      assert.equal(newApiRequests[0].response_format, undefined);
      assert.match(newApiRequests[1].prompt, /适合公开展示/);
      assert.doesNotMatch(newApiRequests[1].prompt, /透明|蕾丝|女仆/);
      const legacyCleanupResult = await app.requestNewApiCharacterImage(
        legacyStateBoundImagePrompt,
        { aspectRatio: "3:4" },
      );
      assert.deepEqual(legacyCleanupResult, { ok: true, b64Json: "AQ==" });
      assert.match(newApiRequests[2].prompt, /咖啡馆里读书/);
      assert.doesNotMatch(newApiRequests[2].prompt, /角色连续性|主卧工作角|透明|蕾丝|女仆/);
    } finally {
      global.fetch = originalFetch;
      console.warn = originalConsoleWarn;
    }
    const modelMessages = app.buildModelMessages(
      [
        { role: "system", content: "你是一个长期陪伴用户的角色。" },
        { role: "assistant", content: "我们还在电影院里看电影。" },
        { role: "user", content: "喵" },
      ],
      {
        role: "system",
        content: "角色日程运行时状态：当前地点：主卧工作角；当前活动：前往主卫；状态：in_transit。",
      },
    );
    assert.equal(modelMessages[0].role, "system");
    assert.doesNotMatch(modelMessages[0].content, /主卧工作角/);
    const latestUserIndex = modelMessages.findLastIndex((message) => message.role === "user");
    assert.match(modelMessages[latestUserIndex].content, /系统附带：本轮实时角色状态/);
    assert.match(modelMessages[latestUserIndex].content, /唯一现实/);
    assert.match(modelMessages[latestUserIndex].content, /主卧工作角/);
    assert.match(modelMessages[latestUserIndex].content, /喵/);
    assert.equal(
      modelMessages.some((message) => message.role === "system" && /主卧工作角/.test(message.content)),
      false,
    );

    const converted = convertMessages(modelMessages);
    assert.doesNotMatch(converted.system, /主卧工作角/);
    const convertedLatestUser = converted.messages.at(-1).content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    assert.match(convertedLatestUser, /主卧工作角/);
    assert.match(convertedLatestUser, /喵/);

    const toolResultBlocks = [{
      type: "tool_result",
      tool_use_id: "call_runtime_state_test",
      content: '{"ok":true}',
    }];
    const modelMessagesWithToolResult = app.buildModelMessages(
      [
        { role: "system", content: "你是一个长期陪伴用户的角色。" },
        { role: "user", content: "现在几点？" },
        {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "call_runtime_state_test",
            name: "get_current_time",
            input: {},
          }],
        },
        { role: "user", content: toolResultBlocks },
      ],
      {
        role: "system",
        content: "角色日程运行时状态：当前地点：主卧；当前活动：休息。",
      },
    );
    const originalUserMessage = modelMessagesWithToolResult.find(
      (message) => message.role === "user" && typeof message.content === "string",
    );
    assert.match(originalUserMessage.content, /系统附带：本轮实时角色状态/);
    assert.match(originalUserMessage.content, /现在几点/);
    assert.deepEqual(modelMessagesWithToolResult.at(-1), {
      role: "user",
      content: toolResultBlocks,
    });
    const convertedToolResultSequence = convertMessages(modelMessagesWithToolResult);
    assert.deepEqual(convertedToolResultSequence.messages.at(-1), {
      role: "user",
      content: toolResultBlocks,
    });

    assert.equal(app.parseExplicitRuntimeLocationUpdate("（瞬移到家里）"), "家里");
    assert.equal(app.parseExplicitRuntimeLocationUpdate("请让她瞬移到家里"), "");
    const contextHistory = app.getSessionMessagesForModel({
      modelContextStartIndex: 1,
      messages: [
        { role: "system", content: "稳定人设" },
        { role: "assistant", content: "旧的电影院场景" },
        {
          role: "assistant",
          content: "日程主动消息",
          metadata: { source: "role-schedule-proactive" },
        },
        { role: "user", content: "新的普通聊天" },
      ],
    });
    assert.deepEqual(
      contextHistory.map((message) => message.content),
      ["稳定人设", "旧的电影院场景", "新的普通聊天"],
    );
    const truncatedToolResultHistory = app.getSessionMessagesForModel({
      modelContextStartIndex: 3,
      messages: [
        { role: "system", content: "稳定人设" },
        { role: "user", content: "之前的提问" },
        {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "call_truncated_test",
            name: "get_current_time",
            input: {},
          }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "call_truncated_test",
            content: '{"ok":true}',
          }],
        },
        { role: "assistant", content: "现在是测试时间。" },
      ],
    });
    assert.deepEqual(
      truncatedToolResultHistory.map((message) => message.role),
      ["system", "assistant"],
    );

    await app.db.ready;
    const role = (await app.roleStore.getRoles()).find((item) => item.name === "测试角色");
    assert.ok(role);

    const continuityScope = { chatId: 970000, userId: 970000 };
    const firstContinuitySession = await app.replaceActiveSession(continuityScope, role);
    await app.db.updateAsync(
      { _id: firstContinuitySession._id },
      {
        $set: {
          messages: [
            { role: "system", content: role.systemPrompt },
            { role: "user", content: "这是上一段对话。" },
            { role: "assistant", content: "我记得这件事。" },
            {
              role: "assistant",
              content: "这是一条不应带入模型的主动日程消息。",
              metadata: { source: "role-schedule-proactive" },
            },
          ],
        },
      },
    );
    const restartedContinuitySession = await app.replaceActiveSession(continuityScope, role);
    assert.equal(restartedContinuitySession.historyBaselineMessageCount, 2);
    assert.deepEqual(
      restartedContinuitySession.messages.map((message) => message.content),
      [role.systemPrompt, "这是上一段对话。", "我记得这件事。"],
    );
    await app.db.updateAsync(
      { _id: restartedContinuitySession._id },
      {
        $set: {
          messages: [
            ...restartedContinuitySession.messages,
            { role: "user", content: "这是新的一段对话。" },
            { role: "assistant", content: "我会继续保持连续性。" },
          ],
        },
      },
    );
    const endedContinuitySession = await app.roleStore.endActiveSession(continuityScope);
    assert.equal(endedContinuitySession.removedCount, 1);
    assert.equal(endedContinuitySession.archivedMessageCount, 2);
    assert.equal(await app.findActiveSession(continuityScope), null);
    const resumedContinuitySession = await app.replaceActiveSession(continuityScope, role);
    assert.equal(resumedContinuitySession.historyBaselineMessageCount, 4);
    assert.deepEqual(
      resumedContinuitySession.messages.map((message) => message.content),
      [
        role.systemPrompt,
        "这是上一段对话。",
        "我记得这件事。",
        "这是新的一段对话。",
        "我会继续保持连续性。",
      ],
    );
    const storedRoleHistory = await app.roleStore.findRoleConversationHistory(
      continuityScope,
      role.name,
    );
    assert.deepEqual(
      storedRoleHistory.messages.map((message) => message.content),
      [
        "这是上一段对话。",
        "我记得这件事。",
        "这是新的一段对话。",
        "我会继续保持连续性。",
      ],
    );

    const scope = { chatId: 970001, userId: 970001 };
    const activeSession = await app.replaceActiveSession(scope, role);
    const now = new Date().toISOString();
    await app.db.insertAsync({
      type: "conversation-message-task",
      ...scope,
      sessionId: activeSession._id,
      telegramMessageId: 1,
      text: "你好，请确认 SQLite 对话链路正常。",
      status: "pending",
      receivedAt: now,
      createdAt: now,
    });

    const replies = [];
    const actions = [];
    const chat = { id: scope.chatId, type: "private" };
    const from = { id: scope.userId };
    const context = {
      chat,
      from,
      message: { chat, from, message_id: 1 },
      sendChatAction: async (action) => actions.push(action),
      reply: async (text) => replies.push(String(text)),
      telegram: { sendMessage: async () => undefined },
    };

    const repeatedStateCalls = [
      {
        id: "state-update-1",
        type: "function",
        function: {
          name: "update_role_physical_state",
          arguments: JSON.stringify({
            outfit: "睡衣",
            limb_states: { leftArm: "放在身侧" },
            reason: "用户明确说换上睡衣",
          }),
        },
      },
      {
        id: "state-update-2",
        type: "function",
        function: {
          name: "update_role_physical_state",
          arguments: JSON.stringify({
            body_state: "清醒",
            limb_states: { rightArm: "拿着手机" },
            reason: "用户补充当前状态",
          }),
        },
      },
    ];
    const executedStateCalls = [];
    const coalescedStateResults = await app.executeToolCallsForRound(
      context,
      repeatedStateCalls,
      {
        executeToolCallFn: async (_ctx, toolCall) => {
          executedStateCalls.push(toolCall);
          return { ok: true, physicalStateUpdated: true };
        },
      },
    );
    assert.equal(executedStateCalls.length, 1);
    assert.equal(executedStateCalls[0].id, "state-update-2");
    assert.deepEqual(JSON.parse(executedStateCalls[0].function.arguments), {
      outfit: "睡衣",
      body_state: "清醒",
      limb_states: { leftArm: "放在身侧", rightArm: "拿着手机" },
      reason: "用户补充当前状态",
    });
    assert.equal(coalescedStateResults[0].stateUpdateCoalesced, true);
    assert.equal(coalescedStateResults[0].mergedIntoToolCallId, "state-update-2");

    const stateUpdateRequests = [];
    const stateUpdateResult = await app.runModelWithTools(
      context,
      [
        { role: "system", content: "你是测试角色。" },
        { role: "user", content: "角色已经换上睡衣。" },
      ],
      {
        client: {
          chat: {
            completions: {
              create: async (request) => {
                stateUpdateRequests.push(request);
                if (stateUpdateRequests.length === 1) {
                  return {
                    choices: [{
                      message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                          id: "state-update-round-1",
                          type: "function",
                          function: {
                            name: "update_role_physical_state",
                            arguments: JSON.stringify({
                              outfit: "睡衣",
                              reason: "用户明确说角色已经换上睡衣",
                            }),
                          },
                        }],
                      },
                    }],
                  };
                }
                return {
                  choices: [{
                    message: {
                      role: "assistant",
                      content: "已经记下来了。",
                    },
                  }],
                };
              },
            },
          },
        },
        toolExecutor: async () => [{ ok: true, physicalStateUpdated: true }],
      },
    );
    assert.equal(stateUpdateRequests.length, 2);
    assert.equal(
      stateUpdateRequests[0].tools.some(
        (tool) => tool.function.name === "update_role_physical_state",
      ),
      true,
    );
    assert.equal(
      stateUpdateRequests[1].tools.some(
        (tool) => tool.function.name === "update_role_physical_state",
      ),
      false,
    );
    assert.equal(
      stateUpdateRequests[1].tools.some(
        (tool) => tool.function.name === "update_role_runtime_state",
      ),
      true,
    );
    assert.equal(stateUpdateResult.answer, "已经记下来了。");

    const requests = [];
    const modelClient = {
      chat: {
        completions: {
          create: async (request) => {
            requests.push(request);
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: "你好，测试角色已经收到你的消息，SQLite 对话链路正常。",
                },
              }],
            };
          },
        },
      },
    };

    await app.processConversationTask(scope, { context, modelClient });
    const session = await app.findActiveSession(scope);
    const task = await app.db.findOneAsync({ type: "conversation-message-task", ...scope });

    assert.equal(requests.length, 1);
    assert.deepEqual(actions, ["typing"]);
    assert.deepEqual(replies, ["你好，测试角色已经收到你的消息，SQLite 对话链路正常。"]);
    assert.equal(task.status, "completed");
    assert.deepEqual(session.messages.map((message) => message.role), ["system", "user", "assistant"]);
    assert.equal(session.messages.at(-1).content, "你好，测试角色已经收到你的消息，SQLite 对话链路正常。");

    const staleScope = { chatId: 970002, userId: 970002 };
    const staleSession = await app.replaceActiveSession(staleScope, role);
    await app.replaceActiveSession(staleScope, role);
    await app.db.insertAsync({
      type: "conversation-message-task",
      ...staleScope,
      sessionId: staleSession._id,
      telegramMessageId: 2,
      text: "这条旧消息不能送到新的会话。",
      status: "pending",
      receivedAt: now,
      createdAt: now,
    });
    let staleModelRequests = 0;
    await app.processConversationTask(staleScope, {
      modelClient: {
        chat: {
          completions: {
            create: async () => {
              staleModelRequests += 1;
              throw new Error("旧会话消息不应请求模型");
            },
          },
        },
      },
    });
    const staleTask = await app.db.findOneAsync({
      type: "conversation-message-task",
      ...staleScope,
      telegramMessageId: 2,
    });
    assert.equal(staleModelRequests, 0);
    assert.equal(staleTask.status, "discarded");
  } finally {
    app?.db.close();
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
