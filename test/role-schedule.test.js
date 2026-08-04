const test = require("node:test");
const assert = require("node:assert/strict");
const Datastore = require("@seald-io/nedb");
const {
  buildFallbackSchedule,
  createRoleScheduleManager,
  isBehaviorEntry,
  isIdleEntry,
  normalizeScheduleEntries,
  ROLE_STATE_RECORD_TYPE,
  SCHEDULE_VERSION,
} = require("../lib/role-schedule");

test("normalizes minute schedule entries and fills uncovered time", () => {
  const entries = normalizeScheduleEntries({
    entries: [
      { start: "07:30", end: "08:00", kind: "routine", activity: "洗漱" },
      { start: "12:00", end: "12:40", activity: "吃午饭", environment: "窗边" },
      { start: "23:00", end: "24:00", kind: "sleep", activity: "睡觉" },
    ],
  });

  assert.equal(entries[0].startMinute, 0);
  assert.equal(entries.at(-1).endMinute, 1440);
  assert.equal(entries.find((entry) => entry.activity === "吃午饭").kind, "meal");
  assert.equal(entries.find((entry) => entry.activity === "睡觉").kind, "sleep");
  assert.equal(entries.every((entry, index) => index === 0 || entry.startMinute === entries[index - 1].endMinute), true);
  assert.equal(buildFallbackSchedule().some((entry) => entry.kind === "sleep"), true);
});

test("reserves preparation and travel time between explicitly different locations", () => {
  const entries = normalizeScheduleEntries({
    entries: [
      { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
      {
        start: "08:00",
        end: "12:00",
        kind: "work",
        activity: "工作",
        location: "办公室",
        preparationMinutes: 10,
        travelMinutes: 20,
      },
      { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "办公室" },
    ],
  });

  const commute = entries.find((entry) => entry.kind === "commute");
  const preparation = entries.find((entry) => entry.kind === "prepare");
  const work = entries.find((entry) => entry.activity === "工作");
  assert.equal(preparation.startMinute, 450);
  assert.equal(preparation.endMinute, 460);
  assert.equal(commute.startMinute, 460);
  assert.equal(commute.endMinute, 480);
  assert.equal(commute.destination, "办公室");
  assert.equal(work.startMinute, commute.endMinute);
  assert.equal(isBehaviorEntry(preparation), false);
  assert.equal(isBehaviorEntry(commute), false);
  assert.equal(isIdleEntry(commute), false);
  assert.equal(entries.every((entry, index) => index === 0 || entry.startMinute === entries[index - 1].endMinute), true);
});

test("repairs model movement entries that use a path label or wrong destination", () => {
  const entries = normalizeScheduleEntries({
    entries: [
      { start: "00:00", end: "08:00", kind: "rest", activity: "在家休息", location: "家" },
      { start: "08:00", end: "08:05", kind: "prepare", activity: "准备出门", location: "车库" },
      {
        start: "08:05",
        end: "08:25",
        kind: "commute",
        activity: "从家前往办公室的路上",
        location: "家到办公室的路上",
        destination: "中途停车场",
      },
      { start: "08:25", end: "12:00", kind: "work", activity: "在办公室工作", location: "办公室" },
    ],
  });

  const preparation = entries.find((entry) => entry.kind === "prepare");
  const commute = entries.find((entry) => entry.kind === "commute");
  assert.equal(preparation.location, "家");
  assert.equal(commute.location, "家");
  assert.equal(commute.destination, "办公室");
  assert.equal(entries.every((entry, index) => index === 0 || entry.startMinute === entries[index - 1].endMinute), true);
});

test("fallback schedule includes real departure preparation and commute stages", () => {
  const entries = buildFallbackSchedule();
  const transitionKinds = entries.filter((entry) => ["prepare", "commute"].includes(entry.kind));
  assert.equal(transitionKinds.length >= 4, true);
  assert.equal(transitionKinds.every((entry) => entry.proactive === false), true);
  assert.equal(entries.some((entry) => entry.activity.includes("换衣服") && entry.activity.includes("钥匙")), true);
  assert.equal(entries.every((entry, index) => index === 0 || entry.startMinute === entries[index - 1].endMinute), true);
  assert.equal(entries.at(-1).endMinute, 1440);
});

test("generates one daily schedule, reports current state, and honors caffeine", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = {
    name: "小雨",
    description: "喜欢安静生活的角色",
    systemPrompt: "你是小雨。",
  };
  let generated = 0;
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => {
      generated += 1;
      return {
        entries: [
          { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家", environment: "卧室" },
          { start: "08:00", end: "12:00", kind: "work", activity: "工作", location: "工作室", environment: "书桌" },
          { start: "12:00", end: "13:00", kind: "meal", activity: "吃饭", location: "工作室", environment: "餐桌" },
          { start: "13:00", end: "24:00", kind: "rest", activity: "休息", location: "工作室", environment: "窗边" },
        ],
      };
    },
    sleepIgnoreProbability: 0.5,
    sleepDelayProbability: 0.5,
    sleepDelayMinMs: 2_000,
    sleepDelayMaxMs: 2_000,
    random: () => 0.75,
    logger: { warn() {} },
  });
  const scope = { chatId: 10, userId: 20 };
  const at = new Date("2026-08-04T01:00:00.000Z");

  const first = await manager.ensureDailySchedule(role, at);
  const second = await manager.ensureDailySchedule(role, at);
  assert.equal(first.source, "model");
  assert.equal(second._id, first._id);
  assert.equal(generated, 1);

  const sleeping = await manager.getState(role.name, { scope, at });
  assert.equal(sleeping.isSleeping, true);
  const delayed = await manager.shouldHandleIncomingMessage(role.name, scope, at);
  assert.equal(delayed.action, "delay");
  assert.equal(delayed.delayMs, 2_000);

  const caffeine = await manager.wakeWithCaffeine(role.name, scope, at);
  assert.equal(caffeine.ok, true);
  const awake = await manager.shouldHandleIncomingMessage(role.name, scope, at);
  assert.equal(awake.action, "reply");
  assert.equal(awake.state.caffeineOverride, true);
});

test("regenerates an older schedule schema so legacy entries do not keep teleporting", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  await db.insertAsync({
    type: "role-daily-schedule",
    roleName: role.name,
    roleNameKey: role.name.toLocaleLowerCase(),
    dateKey: "2026-08-04",
    scheduleVersion: 1,
    entries: [
      { start: "00:00", end: "24:00", kind: "rest", activity: "旧日程" },
    ],
  });
  let generated = 0;
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => {
      generated += 1;
      return {
        entries: [
          { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
          { start: "08:00", end: "12:00", kind: "work", activity: "工作", location: "办公室" },
          { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "办公室" },
        ],
      };
    },
    logger: { warn() {} },
  });

  const schedule = await manager.ensureDailySchedule(role, new Date("2026-08-04T01:00:00.000Z"));
  assert.equal(generated, 1);
  assert.equal(schedule.scheduleVersion, SCHEDULE_VERSION);
  assert.equal(schedule.entries.some((entry) => entry.kind === "commute"), true);
});

test("runtime context says the role is still travelling until the commute ends", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
        { start: "08:00", end: "12:00", kind: "work", activity: "到办公室工作", location: "办公室" },
        { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "办公室" },
      ],
    }),
    logger: { warn() {} },
  });

  const state = await manager.getState(role.name, {
    at: new Date("2026-08-04T07:50:00.000Z"),
  });
  assert.equal(state.current.kind, "commute");
  assert.match(manager.buildRuntimeContextFromState(state), /尚未到达/);
});

test("persists a role state token during a scene and changes it only after arrival", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
        { start: "08:00", end: "12:00", kind: "work", activity: "在办公室工作", location: "办公室" },
        { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "办公室" },
      ],
    }),
    logger: { warn() {} },
  });
  const scope = { chatId: 1, userId: 2 };
  const travellingAt = new Date("2026-08-04T07:50:00.000Z");
  const first = await manager.getState(role.name, { scope, at: travellingAt });
  const sameScene = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T07:55:00.000Z"),
  });
  const arrived = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T08:10:00.000Z"),
  });

  assert.equal(first.runtimeState.status, "in_transit");
  assert.equal(first.runtimeState.location, "家");
  assert.equal(first.runtimeState.destination, "办公室");
  assert.equal(sameScene.runtimeState.stateToken, first.runtimeState.stateToken);
  assert.equal(sameScene.runtimeState.transitionAt, first.runtimeState.transitionAt);
  assert.equal(arrived.runtimeState.status, "stable");
  assert.equal(arrived.runtimeState.location, "办公室");
  assert.equal(arrived.runtimeState.previousState.status, "in_transit");
  assert.equal((await db.findAsync({ type: ROLE_STATE_RECORD_TYPE })).length, 1);
});

test("allows a state poll to skip a valid commute without entering blocked_transition", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "rest", activity: "在家休息", location: "家" },
        { start: "10:00", end: "24:00", kind: "work", activity: "到办公室工作", location: "办公室" },
      ],
    }),
    logger: { warn() {} },
  });
  const scope = { chatId: 11, userId: 22 };
  const beforeTravel = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T06:00:00.000Z"),
  });
  const afterTravel = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T11:00:00.000Z"),
  });

  assert.equal(beforeTravel.runtimeState.location, "家");
  assert.equal(afterTravel.runtimeState.status, "stable");
  assert.equal(afterTravel.runtimeState.location, "办公室");
  assert.notEqual(afterTravel.runtimeState.status, "blocked_transition");
  assert.equal(afterTravel.runtimeState.transitionReason, "arrived_after_scheduled_transition");
});

test("timer automatically repairs a stale blocked runtime state", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const logs = [];
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "rest", activity: "在家休息", location: "家" },
        { start: "10:00", end: "24:00", kind: "work", activity: "到办公室工作", location: "办公室" },
      ],
    }),
    behaviorExecutionProbability: 0,
    logger: { warn: (...args) => logs.push(args.join(" ")) },
  });
  await db.insertAsync({
    type: ROLE_STATE_RECORD_TYPE,
    stateVersion: 1,
    chatId: 31,
    userId: 32,
    roleName: role.name,
    roleNameKey: role.name.toLocaleLowerCase(),
    dateKey: "2026-08-04",
    entryKey: "2026-08-04:old-schedule-entry",
    entryStartMinute: 600,
    entryEndMinute: 1440,
    entryKind: "work",
    phase: "transition_blocked",
    status: "blocked_transition",
    activity: "尚未完成前往办公室",
    location: "旧地点",
    destination: "办公室",
    environment: "旧环境",
    mood: "焦虑",
    stateToken: "stale-blocked-state",
    transitionReason: "missing_or_invalid_transition",
    createdAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:00:00.000Z",
  });

  await manager.tick(new Date("2026-08-04T11:00:00.000Z"));

  const [repaired] = await db.findAsync({ type: ROLE_STATE_RECORD_TYPE });
  assert.equal(repaired.status, "stable");
  assert.equal(repaired.location, "办公室");
  assert.equal(repaired.transitionReason, "auto_repaired_stale_schedule_state");
  assert.equal(typeof repaired.autoRepairedAt, "string");
  assert.equal(logs.some((line) => line.includes("自动修复") && line.includes("小雨")), true);
});

test("only sends proactive messages during idle entries and applies cooldown", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const sent = [];
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "12:00", kind: "work", activity: "工作", location: "工作室" },
        { start: "12:00", end: "13:00", kind: "meal", activity: "吃饭", location: "工作室" },
        { start: "13:00", end: "24:00", kind: "work", activity: "工作", location: "工作室" },
      ],
    }),
    proactiveProbability: 1,
    proactiveCooldownMs: 60 * 60 * 1_000,
    random: () => 0,
    sendProactive: async (payload) => {
      sent.push(payload.state.current.activity);
    },
    logger: { warn() {} },
  });
  const session = { type: "chat-session", chatId: 10, userId: 20, roleName: role.name };
  const at = new Date("2026-08-04T12:20:00.000Z");

  const first = await manager.maybeSendProactive(session, at);
  const second = await manager.maybeSendProactive(session, at);
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.deepEqual(sent, ["吃饭"]);
});

test("rolls behavior execution, completion, failure, and one retry destination", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const rolls = [0.1, 0.95, 0.1, 0.8, 0.1];
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
        { start: "08:00", end: "12:00", kind: "work", activity: "完成一份报告", location: "家", environment: "书桌" },
        { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "家" },
      ],
    }),
    behaviorExecutionProbability: 0.8,
    behaviorCompletionProbability: 0.8,
    behaviorRetryProbability: 0.55,
    behaviorTomorrowProbability: 0.35,
    random: () => rolls.shift() ?? 0,
    generateFailureReason: async () => "临时被一条突发消息打断",
    logger: { warn() {} },
  });
  const firstAt = new Date("2026-08-04T09:00:00.000Z");
  const first = await manager.processBehavior(role, firstAt);
  assert.equal(first.status, "rescheduled");
  assert.equal(first.failureReason, "临时被一条突发消息打断。");
  assert.equal(first.attempts[0].executionDecision, "execute");
  assert.equal(first.attempts[0].completed, false);
  assert.equal(first.attempts[0].retryDecision, "retry");
  assert.equal(first.retryPlan.mode, "later_today");
  assert.equal(first.retryPlan.targetMinute, 720);

  const stateAfterFailure = await manager.getState(role.name, { at: firstAt });
  assert.match(manager.buildRuntimeContextFromState(stateAfterFailure), /临时被一条突发消息打断/);

  const retried = await manager.processDueBehaviorRetries(
    role,
    new Date("2026-08-04T12:00:00.000Z"),
  );
  assert.equal(retried.length, 1);
  assert.equal(retried[0].status, "completed");
  assert.equal(retried[0].attempts.length, 2);
  assert.equal(retried[0].attempts[1].retryAttempt, true);
});

test("can roll a behavior as skipped without attempting completion", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
        { start: "08:00", end: "10:00", kind: "exercise", activity: "散步", location: "家" },
        { start: "10:00", end: "24:00", kind: "rest", activity: "休息", location: "家" },
      ],
    }),
    behaviorExecutionProbability: 0,
    behaviorCompletionProbability: 1,
    random: () => 0.9,
    logger: { warn() {} },
  });

  const outcome = await manager.processBehavior(role, new Date("2026-08-04T08:30:00.000Z"));
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.attempts[0].executionDecision, "skip");
  assert.equal(outcome.attempts[0].completionRoll, undefined);
});

test("can choose tomorrow when a failed behavior is retried", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const rolls = [0.1, 0.95, 0.1, 0.1];
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
        { start: "08:00", end: "12:00", kind: "work", activity: "整理资料", location: "家" },
        { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "家" },
      ],
    }),
    behaviorExecutionProbability: 0.8,
    behaviorCompletionProbability: 0.8,
    behaviorRetryProbability: 0.55,
    behaviorTomorrowProbability: 1,
    random: () => rolls.shift() ?? 0,
    generateFailureReason: async () => "临时找不到需要的资料",
    logger: { warn() {} },
  });

  const outcome = await manager.processBehavior(role, new Date("2026-08-04T09:00:00.000Z"));
  assert.equal(outcome.status, "rescheduled");
  assert.equal(outcome.retryPlan.mode, "tomorrow");
  assert.equal(outcome.retryPlan.targetDateKey, "2026-08-05");
  assert.equal(outcome.retryPlan.targetMinute, 480);
});
