"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSqliteDatabase } = require("../lib/sqlite-database");

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
  };
  process.env.SQLITE_DATABASE_FILE = filename;
  process.env.TG_BOT_TOKEN ||= "123456:LOCAL_TEST";
  process.env.OPENAI_API_KEY ||= "local-test-key";
  process.env.MODEL_PROVIDER = "default";
  process.env.ROLE_SCHEDULE_ENABLED = "false";
  process.env.MCD_AUTO_LOAD_ENABLED = "false";

  let app = null;
  try {
    app = require("../index");
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
    const anchorIndex = modelMessages.findIndex(
      (message) => message.role === "system" && /本轮临时实时状态/.test(message.content),
    );
    assert.ok(anchorIndex > 0 && anchorIndex < latestUserIndex);
    assert.match(modelMessages[anchorIndex].content, /唯一现实/);
    assert.match(modelMessages[anchorIndex].content, /主卧工作角/);

    await app.db.ready;
    const role = (await app.roleStore.getRoles()).find((item) => item.name === "测试角色");
    assert.ok(role);

    const scope = { chatId: 970001, userId: 970001 };
    await app.replaceActiveSession(scope, role);
    const now = new Date().toISOString();
    await app.db.insertAsync({
      type: "conversation-message-task",
      ...scope,
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
  } finally {
    app?.db.close();
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
