const test = require("node:test");
const assert = require("node:assert/strict");
const Datastore = require("@seald-io/nedb");
const {
  buildFallbackSchedule,
  buildSeededSchedule,
  buildPhysicalStateChanges,
  createRoleScheduleManager,
  DAILY_SEED_VERSION,
  getDailyScheduleSeed,
  isBehaviorEntry,
  isIdleEntry,
  isSleepEntry,
  mergePhysicalState,
  normalizeScheduleEntries,
  normalizePhysicalState,
  ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE,
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

test("builds a deterministic minute-level schedule from the role and date seed", () => {
  const role = {
    name: "小雨",
    description: "喜欢安静生活、偶尔写作的角色",
    systemPrompt: "你会在工作和创作之间安排平衡的生活。",
  };
  const dateKey = "2026-08-15";
  const seed = getDailyScheduleSeed(role.name, dateKey);
  const first = buildSeededSchedule({ role, dateKey, seed });
  const second = buildSeededSchedule({ role, dateKey, seed });
  const nextDay = buildSeededSchedule({
    role,
    dateKey: "2026-08-16",
    seed: getDailyScheduleSeed(role.name, "2026-08-16"),
  });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, nextDay);
  assert.equal(first[0].startMinute, 0);
  assert.equal(first.at(-1).endMinute, 1440);
  assert.equal(first.every((entry) => Number.isInteger(entry.startMinute) && Number.isInteger(entry.endMinute)), true);
  assert.equal(first.every((entry, index) => index === 0 || entry.startMinute === first[index - 1].endMinute), true);
  assert.equal(first.some((entry) => entry.kind === "commute"), true);
  assert.equal(first.some((entry) => entry.kind === "sleep"), true);
});

test("stores and forwards the daily seed when generating a schedule", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "安静的角色", systemPrompt: "你是小雨。" };
  let generationInput;
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async (input) => {
      generationInput = input;
      return {
        entries: [
          { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
          { start: "08:00", end: "24:00", kind: "rest", activity: "休息", location: "家" },
        ],
      };
    },
    logger: { warn() {} },
  });
  const date = new Date("2026-08-15T01:00:00.000Z");
  const schedule = await manager.ensureDailySchedule(role, date);
  const expectedSeed = getDailyScheduleSeed(role.name, "2026-08-15");

  assert.equal(schedule.dailySeed, expectedSeed);
  assert.equal(schedule.dailySeedVersion, DAILY_SEED_VERSION);
  assert.equal(generationInput.seed, expectedSeed);
  assert.equal(typeof generationInput.seedKey, "string");
  assert.equal(typeof generationInput.random, "function");
});

test("normalizes and merges physical continuity state without inventing changes", () => {
  const entries = normalizeScheduleEntries({
    entries: [
      {
        start: "00:00",
        end: "08:00",
        kind: "rest",
        activity: "在家休息",
        location: "家",
        physicalState: {
          outfit: "灰色家居服",
          carriedItems: ["钥匙"],
          heldItems: ["手机"],
          internalDevices: ["左耳人工耳蜗"],
          bodyState: "精神正常",
          limbStates: { leftArm: "自然下垂", rightHand: "握着手机" },
        },
      },
      {
        start: "08:00",
        end: "10:00",
        kind: "work",
        activity: "专注工作",
        location: "家",
        physicalState: {
          bodyState: "专注",
          limbStates: { rightHand: "敲键盘" },
        },
      },
      {
        start: "10:00",
        end: "12:00",
        kind: "prepare",
        activity: "整理并放下手中物品",
        location: "家",
        physicalState: {
          outfit: null,
          carriedItems: [],
          heldItems: [],
        },
      },
      {
        start: "12:00",
        end: "24:00",
        kind: "rest",
        activity: "继续休息",
        location: "家",
      },
    ],
  });

  assert.deepEqual(entries[0].physicalState.heldItems, ["手机"]);
  assert.equal(entries[0].physicalState.limbStates.rightHand, "握着手机");
  assert.deepEqual(entries[1].physicalState, {
    bodyState: "专注",
    limbStates: { rightHand: "敲键盘" },
  });

  const merged = mergePhysicalState(entries[0].physicalState, entries[1].physicalState);
  assert.equal(merged.outfit, "灰色家居服");
  assert.deepEqual(merged.heldItems, ["手机"]);
  assert.equal(merged.bodyState, "专注");
  assert.equal(merged.limbStates.leftArm, "自然下垂");
  assert.equal(merged.limbStates.rightHand, "敲键盘");

  const cleared = mergePhysicalState(merged, entries[2].physicalState);
  assert.equal(cleared.outfit, null);
  assert.deepEqual(cleared.carriedItems, []);
  assert.deepEqual(cleared.heldItems, []);
  assert.deepEqual(buildPhysicalStateChanges(merged, cleared).heldItems, {
    from: ["手机"],
    to: [],
    fromRecorded: true,
    toRecorded: true,
  });
});

test("normalizes legacy outfit and carried items into the physical state ledger", () => {
  const state = normalizePhysicalState({
    outfit: "外出服",
    carriedItems: ["钱包"],
    heldItems: ["雨伞"],
    internal_devices: ["义眼"],
    body_state: "有些疲惫",
    limb_states: { left_leg: "轻微酸痛" },
  });
  assert.deepEqual(state, {
    outfit: "外出服",
    carriedItems: ["钱包"],
    heldItems: ["雨伞"],
    internalDevices: ["义眼"],
    bodyState: "有些疲惫",
    limbStates: { leftLeg: "轻微酸痛" },
  });
});

test("rejects unannounced physical state changes in ordinary schedule entries", () => {
  const entries = normalizeScheduleEntries({
    entries: [
      {
        start: "00:00",
        end: "08:00",
        kind: "rest",
        activity: "在家休息",
        location: "家",
        physicalState: { outfit: "家居服", heldItems: ["手机"] },
      },
      {
        start: "08:00",
        end: "12:00",
        kind: "work",
        activity: "工作",
        location: "家",
        physicalState: { outfit: "红色礼服", heldItems: ["平板电脑"] },
      },
      { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "家" },
    ],
  });
  const work = entries.find((entry) => entry.activity === "工作");
  assert.equal(work.physicalState, undefined);
  assert.equal(work.outfit, undefined);
  assert.equal(work.heldItems, undefined);
});

test("runtime state inherits physical facts and records explicit clears", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        {
          start: "00:00",
          end: "08:00",
          kind: "rest",
          activity: "在家休息",
          location: "家",
          physicalState: {
            outfit: "灰色家居服",
            carriedItems: ["钥匙"],
            heldItems: ["手机"],
            internalDevices: ["左耳人工耳蜗"],
            bodyState: "精神正常",
            limbStates: { leftArm: "自然下垂", rightHand: "握着手机" },
          },
        },
        {
          start: "08:00",
          end: "10:00",
          kind: "work",
          activity: "专注工作",
          location: "家",
          physicalState: {
            bodyState: "专注",
            limbStates: { rightHand: "敲键盘" },
          },
        },
        {
          start: "10:00",
          end: "12:00",
          kind: "prepare",
          activity: "放下手中物品",
          location: "家",
          physicalState: {
            heldItems: [],
            carriedItems: [],
            limbStates: { rightHand: null },
          },
        },
        { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "家" },
      ],
    }),
    logger: { warn() {} },
  });
  const scope = { chatId: 41, userId: 42 };
  const morning = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T09:00:00.000Z"),
  });
  assert.equal(morning.runtimeState.outfit, "灰色家居服");
  assert.deepEqual(morning.runtimeState.physicalState.heldItems, ["手机"]);
  assert.deepEqual(morning.runtimeState.physicalState.internalDevices, ["左耳人工耳蜗"]);
  assert.equal(morning.runtimeState.physicalState.bodyState, "专注");
  assert.equal(morning.runtimeState.physicalState.limbStates.leftArm, "自然下垂");
  assert.equal(morning.runtimeState.physicalState.limbStates.rightHand, "敲键盘");

  const prepared = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T10:30:00.000Z"),
  });
  assert.deepEqual(prepared.runtimeState.physicalState.heldItems, []);
  assert.deepEqual(prepared.runtimeState.physicalState.carriedItems, []);
  assert.deepEqual(prepared.runtimeState.physicalState.internalDevices, ["左耳人工耳蜗"]);
  assert.equal(prepared.runtimeState.physicalState.limbStates.rightHand, undefined);
  assert.equal(prepared.runtimeState.physicalState.limbStates.leftArm, "自然下垂");
  assert.deepEqual(prepared.runtimeState.physicalStateChanges.heldItems.to, []);
  assert.deepEqual(prepared.runtimeState.physicalStateChanges.carriedItems.to, []);
  assert.match(manager.buildRuntimeContextFromState(prepared), /当前手持物品：双手空着/);
});

test("explicit physical state updates persist into later schedule entries", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        {
          start: "00:00",
          end: "12:00",
          kind: "rest",
          activity: "在家休息",
          location: "家",
          physicalState: { outfit: "家居服", heldItems: ["手机"] },
        },
        { start: "12:00", end: "24:00", kind: "rest", activity: "继续休息", location: "家" },
      ],
    }),
    logger: { warn() {} },
  });
  const scope = { chatId: 51, userId: 52 };
  const at = new Date("2026-08-04T09:00:00.000Z");
  await manager.getState(role.name, { scope, at });
  const updated = await manager.updatePhysicalState(
    role.name,
    scope,
    { outfit: "黑色外出服", heldItems: [] },
    { at, reason: "角色换上外出服并放下手机" },
  );
  assert.equal(updated.ok, true);
  assert.equal(updated.physicalState.outfit, "黑色外出服");
  assert.deepEqual(updated.physicalState.heldItems, []);

  const later = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T13:00:00.000Z"),
  });
  assert.equal(later.runtimeState.outfit, "黑色外出服");
  assert.deepEqual(later.runtimeState.physicalState.heldItems, []);
  const otherUser = await manager.getState(role.name, {
    scope: { chatId: 53, userId: 54 },
    at,
  });
  assert.equal(otherUser.runtimeState.outfit, "家居服");
  assert.deepEqual(otherUser.runtimeState.physicalState.heldItems, ["手机"]);
  assert.equal(
    (await db.findAsync({ type: ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE })).length,
    1,
  );
});

test("internal device updates carry forward to the next day", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "12:00", kind: "rest", activity: "休息", location: "家" },
        { start: "12:00", end: "24:00", kind: "rest", activity: "继续休息", location: "家" },
      ],
    }),
    logger: { warn() {} },
  });
  const scope = { chatId: 61, userId: 62 };
  const dayOne = new Date("2026-08-04T09:00:00.000Z");
  await manager.getState(role.name, { scope, at: dayOne });
  await manager.updatePhysicalState(
    role.name,
    scope,
    { internalDevices: ["义眼"] },
    { at: dayOne, reason: "安装义眼" },
  );

  const nextDay = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-05T09:00:00.000Z"),
  });
  assert.deepEqual(nextDay.runtimeState.physicalState.internalDevices, ["义眼"]);
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
          { start: "12:00", end: "14:00", kind: "meal", activity: "吃饭", location: "工作室" },
          { start: "14:00", end: "24:00", kind: "work", activity: "工作", location: "工作室" },
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
  const afterCooldown = await manager.maybeSendProactive(
    session,
    new Date("2026-08-04T13:20:00.000Z"),
  );
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(afterCooldown.sent, false);
  assert.deepEqual(sent, ["吃饭"]);
});

test("honors proactive false and ignores filler rest entries", () => {
  const entries = normalizeScheduleEntries({
    entries: [
      { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
      { start: "08:00", end: "12:00", kind: "rest", activity: "安静休息", location: "家", proactive: false },
      { start: "12:00", end: "13:00", kind: "meal", activity: "吃饭", location: "家", proactive: true },
      { start: "13:00", end: "24:00", kind: "rest", activity: "继续休息", location: "家", proactive: false },
    ],
  });

  assert.equal(isIdleEntry(entries.find((entry) => entry.activity === "安静休息")), false);
  assert.equal(isIdleEntry(entries.find((entry) => entry.activity === "吃饭")), true);
  assert.equal(isIdleEntry(entries.find((entry) => entry.activity === "继续休息")), false);
});

test("does not treat explicit pre-sleep rest as actual sleep", () => {
  assert.equal(isSleepEntry({ kind: "rest", activity: "安静休息，慢慢准备睡觉" }), false);
  assert.equal(isSleepEntry({ kind: "sleep", activity: "准备睡觉并进入睡眠" }), true);
  assert.equal(isSleepEntry({ kind: "routine", activity: "准备睡觉" }), true);
});

test("coalesces concurrent proactive sends for the same schedule entry", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const sent = [];
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  let releaseSend;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const sendFinished = new Promise((resolve) => {
    releaseSend = resolve;
  });
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "12:00", kind: "work", activity: "工作", location: "工作室" },
        { start: "12:00", end: "14:00", kind: "meal", activity: "吃饭", location: "工作室" },
        { start: "14:00", end: "24:00", kind: "work", activity: "工作", location: "工作室" },
      ],
    }),
    proactiveProbability: 1,
    proactiveCooldownMs: 0,
    random: () => 0,
    sendProactive: async () => {
      sent.push("吃饭");
      markStarted();
      await sendFinished;
    },
    logger: { warn() {} },
  });
  const session = { type: "chat-session", chatId: 101, userId: 102, roleName: role.name };
  const firstPromise = manager.maybeSendProactive(
    session,
    new Date("2026-08-04T12:20:00.000Z"),
  );
  await started;
  const second = await manager.maybeSendProactive(
    session,
    new Date("2026-08-04T12:21:00.000Z"),
  );
  releaseSend();
  const first = await firstPromise;

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "in-flight");
  assert.deepEqual(sent, ["吃饭"]);
});

test("does not rewind a role into a blocked transition after a later state was persisted", async () => {
  const db = new Datastore({ inMemoryOnly: true });
  const role = { name: "小雨", description: "", systemPrompt: "你是小雨。" };
  const manager = createRoleScheduleManager({
    db,
    getRoles: async () => [role],
    timezone: "UTC",
    generateSchedule: async () => ({
      entries: [
        { start: "00:00", end: "08:00", kind: "sleep", activity: "睡觉", location: "家" },
        { start: "08:00", end: "08:20", kind: "commute", activity: "前往办公室", location: "家", destination: "办公室" },
        { start: "08:20", end: "12:00", kind: "work", activity: "工作", location: "办公室" },
        { start: "12:00", end: "24:00", kind: "rest", activity: "休息", location: "办公室" },
      ],
    }),
    logger: { warn() {} },
  });
  const scope = { chatId: 81, userId: 82 };

  const later = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T09:00:00.000Z"),
  });
  const earlier = await manager.getState(role.name, {
    scope,
    at: new Date("2026-08-04T07:00:00.000Z"),
  });

  assert.equal(later.runtimeState.location, "办公室");
  assert.equal(earlier.runtimeState.status, "stable");
  assert.equal(earlier.runtimeState.location, "家");
  assert.notEqual(earlier.runtimeState.status, "blocked_transition");
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
