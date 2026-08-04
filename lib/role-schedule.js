"use strict";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const SCHEDULE_RECORD_TYPE = "role-daily-schedule";
const CAFFEINE_RECORD_TYPE = "role-caffeine-override";
const PROACTIVE_RECORD_TYPE = "role-schedule-proactive";
const BEHAVIOR_RECORD_TYPE = "role-behavior-outcome";
const ROLE_STATE_RECORD_TYPE = "role-runtime-state";
const DEFAULT_INTERVAL_MS = 20_000;
const DEFAULT_SLEEP_IGNORE_PROBABILITY = 0.35;
const DEFAULT_SLEEP_DELAY_PROBABILITY = 0.45;
const DEFAULT_SLEEP_DELAY_MIN_MS = 15_000;
const DEFAULT_SLEEP_DELAY_MAX_MS = 180_000;
const DEFAULT_PROACTIVE_PROBABILITY = 0.04;
const DEFAULT_PROACTIVE_COOLDOWN_MS = 10 * 60 * 1_000;
const DEFAULT_BEHAVIOR_EXECUTION_PROBABILITY = 0.85;
const DEFAULT_BEHAVIOR_COMPLETION_PROBABILITY = 0.8;
const DEFAULT_BEHAVIOR_RETRY_PROBABILITY = 0.55;
const DEFAULT_BEHAVIOR_TOMORROW_PROBABILITY = 0.35;
const MAX_BEHAVIOR_ATTEMPTS = 2;
const MAX_SCHEDULE_ENTRIES = 96;
const SCHEDULE_VERSION = 3;
const ROLE_STATE_VERSION = 1;
const DEFAULT_PREPARATION_MINUTES = 15;
const DEFAULT_TRAVEL_MINUTES = 15;
const MIN_TRANSITION_MINUTES = 10;

const IDLE_KINDS = new Set([
  "rest",
  "meal",
  "break",
  "leisure",
  "free",
]);
const SLEEP_KINDS = new Set(["sleep", "nap"]);
const TRANSITION_KINDS = new Set(["prepare", "commute"]);
const NON_BEHAVIOR_KINDS = new Set([
  "sleep",
  "nap",
  "rest",
  "break",
  "leisure",
  "free",
  "prepare",
  "commute",
]);

function clampProbability(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function normalizeRoleNameKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function isValidTimeZone(timezone) {
  if (typeof timezone !== "string" || !timezone.trim()) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function getDateParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
  };
}

function getDateKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = getDateParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getMinuteOfDay(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return Number(fields.hour) * 60 + Number(fields.minute);
}

function parseTime(value, { allowEndOfDay = false } = {}) {
  if (Number.isInteger(value)) {
    return value >= 0 && value <= 1440 ? value : null;
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (allowEndOfDay ? 24 : 23) || (hour === 24 && minute !== 0)) {
    return null;
  }
  return hour * 60 + minute;
}

function formatMinute(value) {
  const minute = clampInteger(value, 0, 0, 1440);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function normalizeKind(value, activity = "") {
  const requested = String(value || "").trim().toLocaleLowerCase();
  if (SLEEP_KINDS.has(requested)) {
    return requested === "nap" ? "nap" : "sleep";
  }
  if (IDLE_KINDS.has(requested)) {
    return requested;
  }
  if (["prepare", "preparation", "departure"].includes(requested)) {
    return "prepare";
  }
  if (["commute", "travel", "transit"].includes(requested)) {
    return "commute";
  }
  if (["work", "study", "exercise", "routine", "creative", "social"].includes(requested)) {
    return requested;
  }

  const text = `${requested} ${String(activity || "").toLocaleLowerCase()}`;
  if (/(睡觉|睡眠|午睡|小睡|sleep|nap)/u.test(text)) {
    return text.includes("午睡") || text.includes("小睡") || text.includes("nap")
      ? "nap"
      : "sleep";
  }
  if (/(吃饭|吃午饭|吃晚饭|早餐|午餐|晚餐|加餐|meal|breakfast|lunch|dinner)/u.test(text)) {
    return "meal";
  }
  if (/(休息|放松|发呆|闲着|空闲|break|rest|leisure|free)/u.test(text)) {
    return "rest";
  }
  if (/(出门准备|准备出门|换衣服|换装|收拾(?:好)?(?:东西|物品)|拿(?:好|齐)(?:钥匙|手机|钱包|包)|prepare|departure)/u.test(text)) {
    return "prepare";
  }
  if (/(通勤|路上|commute)/u.test(text)) {
    return "commute";
  }
  if (/(运动|锻炼|健身|exercise|workout)/u.test(text)) {
    return "exercise";
  }
  if (/(学习|阅读|study|read)/u.test(text)) {
    return "study";
  }
  if (/(工作|办公|work)/u.test(text)) {
    return "work";
  }
  return "routine";
}

function normalizeText(value, fallback, maximum = 240) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, maximum);
}

function normalizeOptionalMinutes(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.floor(number)))
    : null;
}

function normalizeLocation(value) {
  return normalizeText(value, "", 120);
}

function normalizeLocationKey(value) {
  return normalizeLocation(value).toLocaleLowerCase().replace(/[\s，。、“”‘’'"()（）\[\]【】]/gu, "");
}

function isTransitionEntry(entry) {
  return Boolean(entry?.movement) || TRANSITION_KINDS.has(entry?.kind);
}

function hasLocationCoverage(entries) {
  const mainEntries = (Array.isArray(entries) ? entries : [])
    .filter((entry) => !isTransitionEntry(entry));
  return mainEntries.length > 0 && mainEntries.every((entry) => Boolean(normalizeLocation(entry.location)));
}

function getEntryPhase(entry) {
  if (!entry) return "unknown";
  if (entry.kind === "sleep" || entry.kind === "nap") return "sleeping";
  if (entry.kind === "prepare") return "preparing";
  if (entry.kind === "commute") return "travelling";
  if (entry.kind === "meal") return "eating";
  if (entry.kind === "exercise") return "exercising";
  if (entry.kind === "work") return "working";
  if (entry.kind === "study") return "studying";
  if (entry.kind === "creative") return "creating";
  if (entry.kind === "social") return "socialising";
  if (entry.kind === "rest" || entry.kind === "break" || entry.kind === "leisure" || entry.kind === "free") {
    return "resting";
  }
  return "routine";
}

function getEntryKey(dateKey, entry) {
  return [
    dateKey,
    entry?.startMinute,
    entry?.endMinute,
    entry?.kind,
    normalizeLocationKey(entry?.location),
    normalizeLocationKey(entry?.destination),
  ].join(":");
}

function hasScheduledArrival(schedule, currentIndex, previous) {
  if (!schedule?.entries?.length || !previous || currentIndex <= 0) {
    return false;
  }
  const current = schedule.entries[currentIndex];
  const targetLocation = normalizeLocationKey(current?.location);
  if (!targetLocation) {
    return false;
  }

  let previousIndex = schedule.entries.findIndex((entry) =>
    getEntryKey(schedule.dateKey, entry) === previous.entryKey,
  );
  if (previousIndex < 0) {
    const previousLocation = normalizeLocationKey(previous.location);
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const entry = schedule.entries[index];
      if (!isTransitionEntry(entry) && normalizeLocationKey(entry.location) === previousLocation) {
        previousIndex = index;
        break;
      }
    }
  }
  if (previousIndex < 0 || previousIndex >= currentIndex) {
    return false;
  }
  return schedule.entries
    .slice(previousIndex + 1, currentIndex)
    .some((entry) =>
      entry.kind === "commute" &&
      normalizeLocationKey(entry.destination) === targetLocation,
    );
}

function normalizeStateText(value, maximum = 180) {
  return normalizeText(value, "", maximum);
}

function normalizeStateList(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、,，;；]/u)
      : [];
  return values
    .map((item) => normalizeStateText(item, 80))
    .filter(Boolean)
    .slice(0, 12);
}

function makeFreeEntry(startMinute, endMinute, location = "") {
  return {
    startMinute,
    endMinute,
    kind: "rest",
    activity: "自由安排 / 休息",
    environment: "按当天情况自然变化",
    ...(location ? { location } : {}),
    mood: "放松",
    proactive: true,
  };
}

function fillScheduleGaps(entries) {
  const result = [];
  let cursor = 0;
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const startMinute = Math.max(cursor, rawEntry.startMinute);
    const endMinute = Math.min(1440, rawEntry.endMinute);
    if (startMinute > cursor) {
      result.push(makeFreeEntry(cursor, startMinute, result.at(-1)?.location || ""));
    }
    if (endMinute <= startMinute) {
      continue;
    }
    result.push({ ...rawEntry, startMinute, endMinute });
    cursor = endMinute;
  }
  if (cursor < 1440) {
    result.push(makeFreeEntry(cursor, 1440, result.at(-1)?.location || ""));
  }
  return result;
}

function getMovementDurations(nextEntry) {
  return {
    preparationMinutes: normalizeOptionalMinutes(
      nextEntry?.preparationMinutes,
      5,
      60,
    ) || DEFAULT_PREPARATION_MINUTES,
    travelMinutes: normalizeOptionalMinutes(
      nextEntry?.travelMinutes,
      5,
      180,
    ) || DEFAULT_TRAVEL_MINUTES,
  };
}

function makeMovementEntries({
  startMinute,
  preparationMinutes,
  travelMinutes,
  fromEntry,
  toEntry,
}) {
  const fromLocation = normalizeLocation(fromEntry?.location);
  const toLocation = normalizeLocation(toEntry?.location);
  const preparationEnd = startMinute + preparationMinutes;
  const commuteEnd = preparationEnd + travelMinutes;
  const destination = toLocation || "目的地";
  return [
    {
      startMinute,
      endMinute: preparationEnd,
      kind: "prepare",
      activity: "出门准备：换衣服、拿好钥匙、手机和钱包",
      environment: fromEntry?.environment || "出发地",
      location: fromLocation,
      mood: fromEntry?.mood || "准备出发",
      proactive: false,
      movement: true,
    },
    {
      startMinute: preparationEnd,
      endMinute: commuteEnd,
      kind: "commute",
      activity: `前往${destination}（路上交通）`,
      environment: `从${fromLocation || "出发地"}前往${destination}的路上`,
      location: fromLocation,
      destination,
      travelMinutes,
      mood: "在路上",
      proactive: false,
      movement: true,
    },
  ];
}

function insertMovementTransitions(entries) {
  const result = [];
  for (const entry of entries) {
    const previous = result.at(-1);
    const previousLocation = normalizeLocationKey(previous?.location);
    const currentLocation = normalizeLocationKey(entry?.location);
    const needsMovement = previous &&
      !isTransitionEntry(previous) &&
      !isTransitionEntry(entry) &&
      previousLocation &&
      currentLocation &&
      previousLocation !== currentLocation;

    if (!needsMovement) {
      result.push(entry);
      continue;
    }

    const durations = getMovementDurations(entry);
    const previousDuration = previous.endMinute - previous.startMinute;
    const currentDuration = entry.endMinute - entry.startMinute;
    const desiredTotal = durations.preparationMinutes + durations.travelMinutes;
    const previousCanFit = previousDuration > desiredTotal;
    const currentCanFit = currentDuration > desiredTotal;
    let total = desiredTotal;
    let shortenPrevious = previousCanFit;

    if (!previousCanFit && !currentCanFit) {
      const available = Math.max(previousDuration - 1, currentDuration - 1);
      if (available < MIN_TRANSITION_MINUTES) {
        result.push(entry);
        continue;
      }
      total = Math.min(desiredTotal, available);
      shortenPrevious = previousDuration >= currentDuration;
    }

    let preparationMinutes = durations.preparationMinutes;
    let travelMinutes = durations.travelMinutes;
    if (preparationMinutes + travelMinutes > total) {
      preparationMinutes = Math.min(preparationMinutes, Math.max(1, total - 1));
      travelMinutes = total - preparationMinutes;
    }

    if (shortenPrevious) {
      const transitionStart = previous.endMinute - total;
      previous.endMinute = transitionStart;
      result.push(...makeMovementEntries({
        startMinute: transitionStart,
        preparationMinutes,
        travelMinutes,
        fromEntry: previous,
        toEntry: entry,
      }));
    } else {
      const transitionStart = entry.startMinute;
      entry.startMinute += total;
      result.push(...makeMovementEntries({
        startMinute: transitionStart,
        preparationMinutes,
        travelMinutes,
        fromEntry: previous,
        toEntry: entry,
      }));
    }
    result.push(entry);
  }
  return result;
}

function getAdjacentMainEntry(entries, index, direction) {
  for (let cursor = index + direction; cursor >= 0 && cursor < entries.length; cursor += direction) {
    if (!isTransitionEntry(entries[cursor])) {
      return entries[cursor];
    }
  }
  return null;
}

function hasValidMovementTransitions(entries) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isTransitionEntry(entry)) {
      continue;
    }
    const previous = getAdjacentMainEntry(entries, index, -1);
    const next = getAdjacentMainEntry(entries, index, 1);
    if (!previous || !next) {
      return false;
    }
    const previousLocation = normalizeLocationKey(previous.location);
    const nextLocation = normalizeLocationKey(next.location);
    if (!previousLocation || !nextLocation) {
      return false;
    }
    if (entry.kind === "prepare") {
      if (normalizeLocationKey(entry.location) !== previousLocation) {
        return false;
      }
      continue;
    }
    if (entry.kind === "commute") {
      if (normalizeLocationKey(entry.location) !== previousLocation ||
          normalizeLocationKey(entry.destination) !== nextLocation) {
        return false;
      }
    }
  }
  return true;
}

function normalizeScheduleEntries(payload) {
  const rawEntries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entries)
      ? payload.entries
      : [];
  const candidates = [];

  for (const raw of rawEntries.slice(0, MAX_SCHEDULE_ENTRIES * 2)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const startMinute = parseTime(
      raw.startMinute ?? raw.start ?? raw.start_time ?? raw.from,
    );
    const endMinute = parseTime(
      raw.endMinute ?? raw.end ?? raw.end_time ?? raw.to,
      { allowEndOfDay: true },
    );
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      continue;
    }
    const kind = normalizeKind(
      raw.kind ?? raw.category ?? raw.type,
      raw.activity ?? raw.task ?? raw.title,
    );
    const location = normalizeLocation(
      raw.location ?? raw.place ?? raw.placeName ?? raw.fromLocation,
    );
    const destination = normalizeLocation(
      raw.destination ?? raw.toLocation ?? raw.targetLocation,
    );
    const outfit = normalizeStateText(raw.outfit ?? raw.clothing ?? raw.costume, 160);
    const carriedItems = normalizeStateList(
      raw.carriedItems ?? raw.carried_items ?? raw.props ?? raw.items,
    );
    const preparationMinutes = normalizeOptionalMinutes(
      raw.preparationMinutes ?? raw.departurePreparationMinutes ?? raw.prepareMinutes,
      5,
      60,
    );
    const travelMinutes = normalizeOptionalMinutes(
      raw.travelMinutes ?? raw.transitMinutes ?? raw.trafficMinutes,
      5,
      180,
    );
    candidates.push({
      startMinute,
      endMinute,
      kind,
      activity: normalizeText(
        raw.activity ?? raw.task ?? raw.title ?? raw.description,
        "日常安排",
      ),
      environment: normalizeText(
        raw.environment ?? raw.setting ?? raw.scene ?? location,
        "当前所在环境",
      ),
      ...(location ? { location } : {}),
      ...(destination ? { destination } : {}),
      ...(outfit ? { outfit } : {}),
      ...(carriedItems.length > 0 ? { carriedItems } : {}),
      ...(preparationMinutes ? { preparationMinutes } : {}),
      ...(travelMinutes ? { travelMinutes } : {}),
      mood: normalizeText(raw.mood ?? raw.energy, "平常状态", 80),
      proactive: !TRANSITION_KINDS.has(kind) && (raw.proactive === true || IDLE_KINDS.has(kind)),
      ...(raw.movement === true || TRANSITION_KINDS.has(kind) ? { movement: true } : {}),
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  const entries = [];
  let cursor = 0;

  for (const candidate of candidates) {
    const startMinute = Math.max(cursor, candidate.startMinute);
    const endMinute = Math.min(1440, candidate.endMinute);
    if (startMinute > cursor) {
      entries.push(makeFreeEntry(cursor, startMinute, entries.at(-1)?.location || ""));
    }
    if (endMinute <= startMinute) {
      continue;
    }
    entries.push({ ...candidate, startMinute, endMinute });
    cursor = endMinute;
    if (entries.length >= MAX_SCHEDULE_ENTRIES) {
      break;
    }
  }

  if (cursor < 1440) {
    entries.push(makeFreeEntry(cursor, 1440, entries.at(-1)?.location || ""));
  }
  // Model-generated schedules sometimes describe a commute with a path label
  // as `location` (for example, "商场到车库的路上") or point it at an
  // intermediate place. The runtime state machine needs transitions to be
  // anchored to the adjacent main entries, otherwise it permanently enters
  // blocked_transition. Repair the whole transition chain when any movement
  // entry is inconsistent, then regenerate it from the canonical locations.
  const canonicalEntries = hasValidMovementTransitions(entries)
    ? entries
    : fillScheduleGaps(entries.filter((entry) => !isTransitionEntry(entry)));
  return insertMovementTransitions(canonicalEntries);
}

function buildFallbackSchedule() {
  return normalizeScheduleEntries({
    entries: [
      { start: "00:00", end: "07:30", kind: "sleep", activity: "睡觉", location: "家", environment: "卧室，安静昏暗", outfit: "睡衣" },
      { start: "07:30", end: "08:00", kind: "routine", activity: "起床、洗漱和整理自己", location: "家", environment: "卧室与洗手间", outfit: "睡衣" },
      { start: "08:00", end: "08:30", kind: "meal", activity: "吃早餐", location: "家", environment: "餐桌", outfit: "睡衣" },
      { start: "08:30", end: "08:45", kind: "prepare", activity: "出门准备：换衣服、拿好钥匙、手机和钱包", location: "家", environment: "卧室与玄关", outfit: "日常外出服", carriedItems: ["钥匙", "手机", "钱包"], proactive: false },
      { start: "08:45", end: "09:05", kind: "commute", activity: "前往工作地点", location: "家", destination: "工作地点", environment: "步行、公交或地铁的路上", travelMinutes: 20, proactive: false },
      { start: "09:05", end: "12:00", kind: "work", activity: "处理今天的重要事情", location: "工作地点", environment: "书桌或工作空间" },
      { start: "12:00", end: "13:00", kind: "meal", activity: "吃午饭并慢慢休息", location: "工作地点", environment: "办公楼餐区或附近餐厅" },
      { start: "13:00", end: "17:30", kind: "work", activity: "继续工作、学习或创作", location: "工作地点", environment: "工作空间", outfit: "日常外出服", carriedItems: ["钥匙", "手机", "钱包"] },
      { start: "17:30", end: "17:45", kind: "prepare", activity: "收拾东西、换上适合运动的衣服", location: "工作地点", environment: "工作空间与洗手间", outfit: "运动服", carriedItems: ["钥匙", "手机", "钱包", "水壶"], proactive: false },
      { start: "17:45", end: "18:00", kind: "commute", activity: "前往附近公园", location: "工作地点", destination: "附近公园", environment: "下班路上", travelMinutes: 15, proactive: false },
      { start: "18:00", end: "18:45", kind: "exercise", activity: "散步或做一点运动", location: "附近公园", environment: "户外小路" },
      { start: "18:45", end: "19:00", kind: "prepare", activity: "收拾水壶和随身物品，准备回家", location: "附近公园", environment: "公园长椅旁", proactive: false },
      { start: "19:00", end: "19:20", kind: "commute", activity: "回家", location: "附近公园", destination: "家", environment: "回家路上", travelMinutes: 20, proactive: false },
      { start: "19:20", end: "20:00", kind: "meal", activity: "吃晚饭", location: "家", environment: "餐桌" },
      { start: "20:00", end: "22:30", kind: "rest", activity: "自由安排、休息和处理杂事", location: "家", environment: "家里或喜欢的角落" },
      { start: "22:30", end: "24:00", kind: "sleep", activity: "准备睡觉并进入睡眠", location: "家", environment: "卧室，灯光很暗" },
    ],
  });
}

function parseSchedulePayload(value) {
  if (value && typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function isSleepEntry(entry) {
  return SLEEP_KINDS.has(entry?.kind) || /(睡觉|睡眠|午睡|小睡|sleep|nap)/iu.test(entry?.activity || "");
}

function isIdleEntry(entry) {
  return !isTransitionEntry(entry) && !isSleepEntry(entry) &&
    (Boolean(entry?.proactive) || IDLE_KINDS.has(entry?.kind));
}

function isBehaviorEntry(entry) {
  return Boolean(entry?.activity) && !NON_BEHAVIOR_KINDS.has(entry?.kind) && !isSleepEntry(entry);
}

function normalizeRoll(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.999999, Math.max(0, number)) : 0;
}

function shiftDateKey(dateKey, offsetDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) {
    return dateKey;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseProbabilityEnv(value, fallback) {
  return clampProbability(value, fallback);
}

function createRoleScheduleManager({
  db,
  getRoles,
  generateSchedule,
  sendProactive,
  timezone = DEFAULT_TIMEZONE,
  videoLocationGuardEnabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
  sleepIgnoreProbability = DEFAULT_SLEEP_IGNORE_PROBABILITY,
  sleepDelayProbability = DEFAULT_SLEEP_DELAY_PROBABILITY,
  sleepDelayMinMs = DEFAULT_SLEEP_DELAY_MIN_MS,
  sleepDelayMaxMs = DEFAULT_SLEEP_DELAY_MAX_MS,
  proactiveProbability = DEFAULT_PROACTIVE_PROBABILITY,
  proactiveCooldownMs = DEFAULT_PROACTIVE_COOLDOWN_MS,
  behaviorExecutionProbability = DEFAULT_BEHAVIOR_EXECUTION_PROBABILITY,
  behaviorCompletionProbability = DEFAULT_BEHAVIOR_COMPLETION_PROBABILITY,
  behaviorRetryProbability = DEFAULT_BEHAVIOR_RETRY_PROBABILITY,
  behaviorTomorrowProbability = DEFAULT_BEHAVIOR_TOMORROW_PROBABILITY,
  generateFailureReason,
  random = Math.random,
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!db || typeof db.findAsync !== "function") {
    throw new Error("role schedule manager requires a NeDB-like db");
  }
  if (typeof getRoles !== "function") {
    throw new Error("role schedule manager requires getRoles");
  }

  const resolvedTimezone = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const configuredVideoLocationGuard = videoLocationGuardEnabled !== false;
  const configuredSleepIgnore = parseProbabilityEnv(
    sleepIgnoreProbability,
    DEFAULT_SLEEP_IGNORE_PROBABILITY,
  );
  const configuredSleepDelay = parseProbabilityEnv(
    sleepDelayProbability,
    DEFAULT_SLEEP_DELAY_PROBABILITY,
  );
  const delayMin = clampInteger(sleepDelayMinMs, DEFAULT_SLEEP_DELAY_MIN_MS, 0, 24 * 60 * 60 * 1_000);
  const delayMax = clampInteger(
    sleepDelayMaxMs,
    DEFAULT_SLEEP_DELAY_MAX_MS,
    delayMin,
    24 * 60 * 60 * 1_000,
  );
  const configuredProactiveProbability = parseProbabilityEnv(
    proactiveProbability,
    DEFAULT_PROACTIVE_PROBABILITY,
  );
  const cooldown = clampInteger(
    proactiveCooldownMs,
    DEFAULT_PROACTIVE_COOLDOWN_MS,
    0,
    7 * 24 * 60 * 60 * 1_000,
  );
  const configuredBehaviorExecution = parseProbabilityEnv(
    behaviorExecutionProbability,
    DEFAULT_BEHAVIOR_EXECUTION_PROBABILITY,
  );
  const configuredBehaviorCompletion = parseProbabilityEnv(
    behaviorCompletionProbability,
    DEFAULT_BEHAVIOR_COMPLETION_PROBABILITY,
  );
  const configuredBehaviorRetry = parseProbabilityEnv(
    behaviorRetryProbability,
    DEFAULT_BEHAVIOR_RETRY_PROBABILITY,
  );
  const configuredBehaviorTomorrow = parseProbabilityEnv(
    behaviorTomorrowProbability,
    DEFAULT_BEHAVIOR_TOMORROW_PROBABILITY,
  );
  const generationLocks = new Map();
  let schedulerTimer;
  let tickRunning = false;

  async function resolveRole(roleName) {
    const nameKey = normalizeRoleNameKey(roleName);
    if (!nameKey) {
      return null;
    }
    const roles = await getRoles();
    return roles.find((role) => normalizeRoleNameKey(role.name) === nameKey) || null;
  }

  async function findStoredSchedule(roleName, dateKey) {
    const records = await db.findAsync({ type: SCHEDULE_RECORD_TYPE, dateKey });
    const nameKey = normalizeRoleNameKey(roleName);
    return records.find((record) =>
      Number(record.scheduleVersion) === SCHEDULE_VERSION &&
      normalizeRoleNameKey(record.roleNameKey || record.roleName) === nameKey,
    ) || null;
  }

  function normalizeStoredSchedule(record) {
    if (!record || Number(record.scheduleVersion) !== SCHEDULE_VERSION) {
      return null;
    }
    const entries = normalizeScheduleEntries(record.entries);
    return entries.length > 0 && hasLocationCoverage(entries)
      ? {
          ...record,
          roleNameKey: record.roleNameKey || normalizeRoleNameKey(record.roleName),
          timezone: record.timezone || resolvedTimezone,
          entries,
        }
      : null;
  }

  async function loadStoredSchedule(roleName, dateKey) {
    const stored = await findStoredSchedule(roleName, dateKey);
    const normalized = normalizeStoredSchedule(stored);
    if (!normalized || !stored?._id) {
      return normalized;
    }

    const storedEntries = JSON.stringify(stored.entries || []);
    const normalizedEntries = JSON.stringify(normalized.entries || []);
    if (storedEntries === normalizedEntries) {
      return normalized;
    }

    const updatedAt = new Date().toISOString();
    await db.updateAsync(
      { _id: stored._id },
      { $set: { entries: normalized.entries, updatedAt } },
    );
    return { ...normalized, entries: normalized.entries, updatedAt };
  }

  function hasRuntimeScope(scope) {
    return Boolean(scope) && scope.chatId !== undefined && scope.userId !== undefined;
  }

  async function findRuntimeState(roleName, scope) {
    if (!hasRuntimeScope(scope)) {
      return null;
    }
    return db.findOneAsync({
      type: ROLE_STATE_RECORD_TYPE,
      stateVersion: ROLE_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleNameKey: normalizeRoleNameKey(roleName),
    });
  }

  function getNextMovementDestination(schedule, currentIndex, currentEntry) {
    for (let index = currentIndex + 1; index < schedule.entries.length; index += 1) {
      const candidate = schedule.entries[index];
      if (candidate.kind === "commute" && candidate.destination) {
        return candidate.destination;
      }
      if (!isTransitionEntry(candidate) && candidate.location) {
        return candidate.location;
      }
    }
    return currentEntry?.destination || "";
  }

  function buildRuntimeState({ roleName, scope, schedule, current, currentIndex, minute, previous }) {
    const dateKey = schedule.dateKey;
    const entryKey = getEntryKey(dateKey, current);
    const currentLocation = normalizeStateText(current.location, 120);
    const previousLocation = normalizeStateText(previous?.location, 120);
    const nextDestination = normalizeStateText(
      getNextMovementDestination(schedule, currentIndex, current),
      120,
    );
    let phase = getEntryPhase(current);
    let status = "stable";
    let location = currentLocation || previousLocation;
    let destination = "";
    let activity = current.activity;
    let environment = current.environment;
    let mood = current.mood;
    let transitionReason = "schedule_boundary";
    const currentIsTransition = isTransitionEntry(current);
    const scheduledArrival = !currentIsTransition && hasScheduledArrival(
      schedule,
      currentIndex,
      previous,
    );
    const locationMismatch = !currentIsTransition && previous &&
      previousLocation &&
      currentLocation &&
      normalizeLocationKey(previousLocation) !== normalizeLocationKey(currentLocation);

    if (current.kind === "prepare") {
      status = "preparing";
      destination = nextDestination;
      location = previousLocation || currentLocation;
      transitionReason = "preparing_to_move";
    } else if (current.kind === "commute") {
      status = "in_transit";
      destination = normalizeStateText(current.destination || nextDestination, 120);
      location = currentLocation || previousLocation;
      transitionReason = "travelling_to_destination";
    } else if (
      previous?.status === "in_transit" &&
      previous.destination &&
      currentLocation &&
      normalizeLocationKey(previous.destination) === normalizeLocationKey(currentLocation)
    ) {
      status = "stable";
      destination = "";
      transitionReason = "arrived_at_destination";
    } else if (scheduledArrival) {
      status = "stable";
      destination = "";
      location = currentLocation || location;
      transitionReason = "arrived_after_scheduled_transition";
    } else if (
      locationMismatch
    ) {
      status = "blocked_transition";
      phase = "transition_blocked";
      location = previousLocation;
      destination = currentLocation;
      activity = `尚未完成前往${currentLocation}，原计划是${current.activity}`;
      environment = previous.environment || environment;
      mood = previous.mood || mood;
      transitionReason = "missing_or_invalid_transition";
    } else if (previous?.status === "blocked_transition") {
      status = "blocked_transition";
      phase = "transition_blocked";
      location = previousLocation || location;
      destination = previous.destination || nextDestination;
      activity = previous.activity || activity;
      environment = previous.environment || environment;
      mood = previous.mood || mood;
      transitionReason = "waiting_for_valid_transition";
    }

    const outfit = normalizeStateText(current.outfit || previous?.outfit, 160);
    const carriedItems = normalizeStateList(current.carriedItems?.length
      ? current.carriedItems
      : previous?.carriedItems);
    const timestamp = new Date().toISOString();
    return {
      type: ROLE_STATE_RECORD_TYPE,
      stateVersion: ROLE_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleName,
      roleNameKey: normalizeRoleNameKey(roleName),
      dateKey,
      entryKey,
      entryStartMinute: current.startMinute,
      entryEndMinute: current.endMinute,
      entryKind: current.kind,
      phase,
      status,
      activity,
      location,
      destination,
      environment,
      mood,
      ...(outfit ? { outfit } : {}),
      ...(carriedItems.length > 0 ? { carriedItems } : {}),
      stateToken: `${dateKey}:${entryKey}:${status}:${normalizeLocationKey(location)}:${normalizeLocationKey(destination)}`,
      transitionReason,
      previousState: previous
        ? {
            entryKey: previous.entryKey || "",
            phase: previous.phase || "unknown",
            status: previous.status || "stable",
            location: previous.location || "",
            destination: previous.destination || "",
          }
        : null,
      transitionAt: timestamp,
      updatedAt: timestamp,
      minute,
    };
  }

  async function syncRuntimeState({ roleName, scope, schedule, current, currentIndex, minute }) {
    if (!hasRuntimeScope(scope) || !current) {
      return null;
    }
    const existing = await findRuntimeState(roleName, scope);
    const entryKey = getEntryKey(schedule.dateKey, current);
    if (existing?.dateKey === schedule.dateKey && existing.entryKey === entryKey) {
      return existing;
    }

    const nextState = buildRuntimeState({
      roleName,
      scope,
      schedule,
      current,
      currentIndex,
      minute,
      previous: existing?.dateKey === schedule.dateKey ? existing : null,
    });
    return persistRuntimeState(nextState, existing);
  }

  async function persistRuntimeState(nextState, existing = null) {
    const { _id, ...fields } = nextState;
    if (existing?._id) {
      await db.updateAsync({ _id: existing._id }, { $set: fields });
      return { ...fields, _id: existing._id };
    }
    return db.insertAsync(fields);
  }

  async function ensureDailySchedule(roleOrName, at = now()) {
    const role = typeof roleOrName === "string" ? await resolveRole(roleOrName) : roleOrName;
    const roleName = role?.name || (typeof roleOrName === "string" ? roleOrName : "");
    const nameKey = normalizeRoleNameKey(roleName);
    if (!nameKey) {
      return null;
    }

    const dateKey = getDateKey(at, resolvedTimezone);
    const existing = await loadStoredSchedule(roleName, dateKey);
    if (existing) {
      return existing;
    }

    const lockKey = `${nameKey}:${dateKey}`;
    if (generationLocks.has(lockKey)) {
      return generationLocks.get(lockKey);
    }

    const promise = (async () => {
      const current = await loadStoredSchedule(roleName, dateKey);
      if (current) {
        return current;
      }

      let entries = [];
      let source = "fallback";
      let generationError = "";
      if (typeof generateSchedule === "function" && role) {
        try {
          const generated = await generateSchedule({
            role,
            dateKey,
            timezone: resolvedTimezone,
          });
          entries = normalizeScheduleEntries(parseSchedulePayload(generated));
          if (entries.length > 0 && hasLocationCoverage(entries)) {
            source = "model";
          } else {
            entries = [];
          }
        } catch (error) {
          generationError = String(error?.message || error).slice(0, 300);
          logger.warn?.(`生成「${roleName}」日程失败，使用兜底日程:`, generationError);
        }
      }
      if (entries.length === 0) {
        entries = buildFallbackSchedule();
      }

      const timestamp = new Date().toISOString();
      const record = {
        type: SCHEDULE_RECORD_TYPE,
        scheduleVersion: SCHEDULE_VERSION,
        roleName,
        roleNameKey: nameKey,
        dateKey,
        timezone: resolvedTimezone,
        entries,
        source,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(generationError ? { generationError } : {}),
      };
      const stored = await db.findOneAsync({
        type: SCHEDULE_RECORD_TYPE,
        dateKey,
        roleNameKey: nameKey,
      });
      if (stored?._id) {
        await db.updateAsync({ _id: stored._id }, { $set: record });
        return { ...stored, ...record };
      }
      return db.insertAsync(record);
    })();

    generationLocks.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      generationLocks.delete(lockKey);
    }
  }

  async function findBehaviorOutcome(roleName, dateKey, entryStartMinute) {
    const records = await db.findAsync({ type: BEHAVIOR_RECORD_TYPE, dateKey });
    const roleNameKey = normalizeRoleNameKey(roleName);
    return records.find((record) =>
      normalizeRoleNameKey(record.roleNameKey || record.roleName) === roleNameKey &&
      Number(record.entryStartMinute) === Number(entryStartMinute),
    ) || null;
  }

  async function findBehaviorOutcomesForDate(roleName, dateKey) {
    const records = await db.findAsync({ type: BEHAVIOR_RECORD_TYPE, dateKey });
    const roleNameKey = normalizeRoleNameKey(roleName);
    return records
      .filter((record) => normalizeRoleNameKey(record.roleNameKey || record.roleName) === roleNameKey)
      .sort((left, right) => Number(left.entryStartMinute) - Number(right.entryStartMinute));
  }

  async function findPendingBehaviorRetries(roleName) {
    const roleNameKey = normalizeRoleNameKey(roleName);
    const records = await db.findAsync({
      type: BEHAVIOR_RECORD_TYPE,
      roleNameKey,
      status: "rescheduled",
    });
    return records
      .filter((record) => record.retryPlan?.targetDateKey)
      .sort((left, right) => {
        const leftKey = `${left.retryPlan.targetDateKey}:${String(left.retryPlan.targetMinute).padStart(4, "0")}`;
        const rightKey = `${right.retryPlan.targetDateKey}:${String(right.retryPlan.targetMinute).padStart(4, "0")}`;
        return leftKey.localeCompare(rightKey);
      });
  }

  function getFallbackFailureReason(entry) {
    const activity = String(entry?.activity || "这件事");
    const reasons = {
      work: "临时被一件突发的小事打断，没能顺利进入状态",
      study: "注意力一直飘走，今天没能把思路整理好",
      exercise: "身体状态不太配合，热身后还是决定先停下来",
      meal: "时间被别的事情挤掉了，没能按计划好好吃完",
      commute: "路上临时遇到状况，原来的安排被打乱了",
      routine: "中途被琐事打断，最后没有完整做完",
      creative: "灵感和状态没有接上，勉强继续反而会更糟",
      social: "临时没有合适的精力应付交流，只好先放一放",
    };
    return `${activity}：${reasons[entry?.kind] || "临时被一些琐事打断，今天没能顺利完成"}。`;
  }

  async function createFailureReason({ role, entry, state, attempt }) {
    if (typeof generateFailureReason === "function") {
      try {
        const generated = await generateFailureReason({ role, entry, state, attempt });
        const text = normalizeText(generated, "", 300);
        if (text) {
          return text.replace(/[。！!]+$/u, "") + "。";
        }
      } catch (error) {
        logger.warn?.("生成角色行为失败原因失败，使用兜底原因:", error.message || error);
      }
    }
    return getFallbackFailureReason(entry);
  }

  function getBehaviorTimestamp(at) {
    const date = at instanceof Date ? at : new Date(at);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function getRetryPlan({ dateKey, entry, minute, tomorrow }) {
    if (tomorrow || entry.endMinute >= 1440) {
      return {
        mode: "tomorrow",
        label: "明天",
        targetDateKey: shiftDateKey(dateKey, 1),
        targetMinute: entry.startMinute,
      };
    }
    return {
      mode: "later_today",
      label: "稍后",
      targetDateKey: dateKey,
      targetMinute: Math.min(1439, Math.max(entry.endMinute, minute + 1)),
    };
  }

  async function saveBehaviorOutcome(record) {
    const timestamp = record.updatedAt || new Date().toISOString();
    const { _id, ...recordFields } = record;
    const updates = { ...recordFields, updatedAt: timestamp };
    if (record._id) {
      await db.updateAsync({ _id: record._id }, { $set: updates });
      return { ...updates, _id };
    }
    return db.insertAsync(updates);
  }

  async function runBehaviorAttempt({ role, entry, state, record = null, at = now(), isRetry = false }) {
    const timestamp = getBehaviorTimestamp(at);
    const attemptNumber = (record?.attempts?.length || 0) + 1;
    const executionProbability = configuredBehaviorExecution;
    const completionProbability = configuredBehaviorCompletion;
    const retryProbability = configuredBehaviorRetry;
    const attempt = {
      attempt: attemptNumber,
      retryAttempt: isRetry,
      attemptedAt: timestamp,
      executionProbability,
      ...(isRetry
        ? { executionDecision: "retry", executionRoll: null, executed: true }
        : (() => {
            const executionRoll = normalizeRoll(random());
            const executed = executionRoll < executionProbability;
            return {
              executionRoll,
              executed,
              executionDecision: executed ? "execute" : "skip",
            };
          })()),
    };

    const baseRecord = record || {
      type: BEHAVIOR_RECORD_TYPE,
      roleName: role.name,
      roleNameKey: normalizeRoleNameKey(role.name),
      dateKey: state.dateKey,
      entryStartMinute: entry.startMinute,
      entryEndMinute: entry.endMinute,
      activity: entry.activity,
      kind: entry.kind,
      environment: entry.environment,
      attempts: [],
      createdAt: timestamp,
    };
    const attempts = [...(baseRecord.attempts || []), attempt];

    if (!attempt.executed) {
      attempt.status = "skipped";
      attempt.skipReason = "今天的状态不太适合做这件事，先把精力留给别的安排。";
      return saveBehaviorOutcome({
        ...baseRecord,
        attempts,
        status: "skipped",
        executionDecision: "skipped",
        updatedAt: timestamp,
        failureReason: "",
        retryPlan: null,
      });
    }

    const completionRoll = normalizeRoll(random());
    const completed = completionRoll < completionProbability;
    attempt.completionProbability = completionProbability;
    attempt.completionRoll = completionRoll;
    attempt.completed = completed;
    if (completed) {
      attempt.status = "completed";
      return saveBehaviorOutcome({
        ...baseRecord,
        attempts,
        status: "completed",
        executionDecision: "execute",
        completedAt: timestamp,
        failureReason: baseRecord.failureReason || "",
        retryPlan: null,
        updatedAt: timestamp,
      });
    }

    const failureReason = await createFailureReason({ role, entry, state, attempt });
    attempt.status = "failed";
    attempt.failureReason = failureReason;
    const nextRecord = {
      ...baseRecord,
      attempts,
      status: "failed",
      executionDecision: "execute",
      failureReason,
      lastFailureReason: failureReason,
      updatedAt: timestamp,
      retryPlan: null,
    };

    if (attemptNumber >= MAX_BEHAVIOR_ATTEMPTS) {
      attempt.retryDecision = "stop_after_retry";
      return saveBehaviorOutcome(nextRecord);
    }

    const retryRoll = normalizeRoll(random());
    const retry = retryRoll < retryProbability;
    attempt.retryProbability = retryProbability;
    attempt.retryRoll = retryRoll;
    attempt.retryDecision = retry ? "retry" : "stop";
    if (!retry) {
      return saveBehaviorOutcome(nextRecord);
    }

    const rescheduleRoll = normalizeRoll(random());
    const tomorrow = rescheduleRoll < configuredBehaviorTomorrow || entry.endMinute >= 1440;
    const retryPlan = getRetryPlan({
      dateKey: state.dateKey,
      entry,
      minute: state.minute,
      tomorrow,
    });
    attempt.rescheduleRoll = rescheduleRoll;
    attempt.rescheduleDecision = retryPlan.mode;
    return saveBehaviorOutcome({
      ...nextRecord,
      status: "rescheduled",
      retryPlan,
      updatedAt: timestamp,
    });
  }

  async function processBehavior(roleOrName, at = now()) {
    const role = typeof roleOrName === "string" ? await resolveRole(roleOrName) : roleOrName;
    if (!role?.name) {
      return null;
    }
    const state = await getState(role.name, { at });
    const entry = state?.current;
    if (!state || !isBehaviorEntry(entry)) {
      return null;
    }
    const existing = state.behavior || await findBehaviorOutcome(
      role.name,
      state.dateKey,
      entry.startMinute,
    );
    if (existing) {
      return existing;
    }
    return runBehaviorAttempt({ role, entry, state, at });
  }

  async function processDueBehaviorRetries(roleOrName, at = now()) {
    const role = typeof roleOrName === "string" ? await resolveRole(roleOrName) : roleOrName;
    if (!role?.name) {
      return [];
    }
    const currentDateKey = getDateKey(at, resolvedTimezone);
    const currentMinute = getMinuteOfDay(at, resolvedTimezone);
    const pending = await findPendingBehaviorRetries(role.name);
    const due = pending.filter((record) => {
      const plan = record.retryPlan;
      return plan.targetDateKey < currentDateKey ||
        (plan.targetDateKey === currentDateKey && Number(plan.targetMinute) <= currentMinute);
    }).slice(0, 8);
    const results = [];
    for (const record of due) {
      const entry = {
        startMinute: Number(record.entryStartMinute),
        endMinute: Number(record.entryEndMinute),
        kind: record.kind,
        activity: record.activity,
        environment: record.environment,
        mood: "重新尝试",
      };
      const state = {
        dateKey: record.retryPlan.targetDateKey,
        minute: currentMinute,
        current: entry,
        schedule: { roleName: role.name, roleNameKey: normalizeRoleNameKey(role.name) },
        timezone: resolvedTimezone,
      };
      results.push(await runBehaviorAttempt({
        role,
        entry,
        state,
        record,
        at,
        isRetry: true,
      }));
    }
    return results;
  }

  async function getState(roleName, { scope = null, at = now() } = {}) {
    const schedule = await ensureDailySchedule(roleName, at);
    if (!schedule) {
      return null;
    }
    const minute = getMinuteOfDay(at, resolvedTimezone);
    const currentIndexValue = schedule.entries.findIndex((entry) =>
      minute >= entry.startMinute && minute < entry.endMinute,
    );
    const currentIndex = currentIndexValue >= 0
      ? currentIndexValue
      : Math.max(0, schedule.entries.length - 1);
    const current = schedule.entries[currentIndex];
    let caffeineOverride = false;
    if (scope && current && isSleepEntry(current)) {
      const overrides = await db.findAsync({
        type: CAFFEINE_RECORD_TYPE,
        chatId: scope.chatId,
        userId: scope.userId,
        dateKey: schedule.dateKey,
        roleNameKey: schedule.roleNameKey,
      });
      caffeineOverride = overrides.some((override) =>
        Number(override.sleepEntryStartMinute) === Number(current.startMinute) &&
        minute < Number(override.wakeUntilMinute || 0),
      );
    }
    const behaviorOutcomes = await findBehaviorOutcomesForDate(roleName, schedule.dateKey);
    const behavior = current && isBehaviorEntry(current)
      ? behaviorOutcomes.find((outcome) =>
          Number(outcome.entryStartMinute) === Number(current.startMinute),
        ) || null
      : null;
    const pendingBehaviorRetries = await findPendingBehaviorRetries(roleName);
    const runtimeState = await syncRuntimeState({
      roleName,
      scope,
      schedule,
      current,
      currentIndex,
      minute,
    });
    return {
      schedule,
      dateKey: schedule.dateKey,
      minute,
      current,
      behavior,
      recentBehaviorOutcomes: behaviorOutcomes
        .filter((outcome) => Number(outcome.entryStartMinute) <= minute)
        .slice(-3),
      pendingBehaviorRetries: pendingBehaviorRetries.slice(0, 3),
      runtimeState,
      isSleeping: Boolean(current && isSleepEntry(current) && !caffeineOverride),
      caffeineOverride,
      timezone: resolvedTimezone,
    };
  }

  async function repairBlockedRuntimeStates(at = now()) {
    const blockedStates = await db.findAsync({
      type: ROLE_STATE_RECORD_TYPE,
      stateVersion: ROLE_STATE_VERSION,
      status: "blocked_transition",
    });
    let repaired = 0;
    for (const persistedState of blockedStates) {
      const scope = {
        chatId: persistedState.chatId,
        userId: persistedState.userId,
      };
      if (!persistedState.roleName || !hasRuntimeScope(scope)) {
        continue;
      }
      try {
        const state = await getState(persistedState.roleName, { scope, at });
        if (!state?.current || !state.runtimeState || state.runtimeState.status !== "blocked_transition") {
          continue;
        }
        const currentIndex = state.schedule.entries.findIndex((entry) => entry === state.current);
        if (currentIndex < 0) {
          continue;
        }
        const currentEntryKey = getEntryKey(state.schedule.dateKey, state.current);
        const previousEntryStillExists = state.schedule.entries.some((entry) =>
          getEntryKey(state.schedule.dateKey, entry) === persistedState.entryKey,
        );
        const previous = previousEntryStillExists ? persistedState : null;
        let repairedState = buildRuntimeState({
          roleName: state.schedule.roleName || persistedState.roleName,
          scope,
          schedule: state.schedule,
          current: state.current,
          currentIndex,
          minute: state.minute,
          previous,
        });
        let repairReason = previous
          ? "auto_repaired_blocked_transition"
          : "auto_repaired_stale_schedule_state";

        // If the persisted state still describes an impossible transition,
        // adopt the canonical entry for the current minute. This is safer
        // than keeping a permanent block caused by stale schedule data; the
        // normalized schedule remains the source of truth for future ticks.
        if (repairedState.status === "blocked_transition") {
          repairedState = buildRuntimeState({
            roleName: state.schedule.roleName || persistedState.roleName,
            scope,
            schedule: state.schedule,
            current: state.current,
            currentIndex,
            minute: state.minute,
            previous: null,
          });
          repairReason = "auto_repaired_unrecoverable_transition";
        }
        if (repairedState.status === "blocked_transition") {
          continue;
        }

        const timestamp = new Date().toISOString();
        repairedState.transitionReason = repairReason;
        repairedState.autoRepairedAt = timestamp;
        repairedState.autoRepairFromEntryKey = persistedState.entryKey || currentEntryKey;
        await persistRuntimeState(repairedState, state.runtimeState);
        repaired += 1;
        logger.warn?.(
          `已自动修复角色「${persistedState.roleName}」会话 ${String(scope.chatId)}:${String(scope.userId)} 的地点状态：${repairReason}`,
        );
      } catch (error) {
        logger.warn?.(
          `自动修复角色「${persistedState.roleName}」地点状态失败:`,
          error.message || error,
        );
      }
    }
    return { checked: blockedStates.length, repaired };
  }

  async function wakeWithCaffeine(roleName, scope, at = now()) {
    if (!scope) {
      return { ok: false, reason: "missing-scope" };
    }
    const state = await getState(roleName, { scope, at });
    if (!state?.current || !isSleepEntry(state.current)) {
      return { ok: false, reason: "not-sleeping", state };
    }
    if (state.caffeineOverride) {
      return { ok: true, alreadyAwake: true, state };
    }

    const record = {
      type: CAFFEINE_RECORD_TYPE,
      chatId: scope.chatId,
      userId: scope.userId,
      roleName: state.schedule.roleName,
      roleNameKey: state.schedule.roleNameKey,
      dateKey: state.dateKey,
      sleepEntryStartMinute: state.current.startMinute,
      wakeUntilMinute: state.current.endMinute,
      createdAt: new Date().toISOString(),
    };
    const existing = await db.findOneAsync({
      type: CAFFEINE_RECORD_TYPE,
      chatId: scope.chatId,
      userId: scope.userId,
      dateKey: state.dateKey,
      roleNameKey: state.schedule.roleNameKey,
      sleepEntryStartMinute: state.current.startMinute,
    });
    if (existing?._id) {
      await db.updateAsync({ _id: existing._id }, { $set: record });
    } else {
      await db.insertAsync(record);
    }
    return {
      ok: true,
      alreadyAwake: false,
      state: { ...state, isSleeping: false, caffeineOverride: true },
    };
  }

  async function shouldHandleIncomingMessage(roleName, scope, at = now()) {
    const state = await getState(roleName, { scope, at });
    if (!state?.isSleeping) {
      return { action: "reply", state };
    }

    const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
    if (roll < configuredSleepIgnore) {
      return { action: "ignore", state };
    }
    if (roll < configuredSleepIgnore + configuredSleepDelay) {
      const delay = delayMin === delayMax
        ? delayMin
        : delayMin + Math.floor((Math.min(0.999999, Math.max(0, Number(random()) || 0))) * (delayMax - delayMin + 1));
      return { action: "delay", delayMs: Math.min(delayMax, delay), state };
    }
    return { action: "reply", state };
  }

  function buildBehaviorContext(state) {
    const lines = [];
    const outcome = state?.behavior;
    const activity = state?.current?.activity || "当前安排";
    if (state?.current && isBehaviorEntry(state.current)) {
      if (!outcome) {
        lines.push(`当前行为“${activity}”还没有完成自主判定，不要假装已经完成。`);
      } else if (outcome.status === "completed") {
        lines.push(`当前行为“${activity}”已经完成。`);
      } else if (outcome.status === "skipped") {
        lines.push(`当前行为“${activity}”今天被暂时跳过了。`);
      } else if (outcome.status === "rescheduled") {
        const plan = outcome.retryPlan;
        lines.push(
          `当前行为“${activity}”没有完成，原因是：${outcome.failureReason || "临时出了点状况"}；已决定${plan?.label || "稍后"}补做。`,
        );
      } else if (outcome.status === "failed") {
        lines.push(
          `当前行为“${activity}”没有完成，原因是：${outcome.failureReason || "临时出了点状况"}；目前没有继续补做的安排。`,
        );
      }
    }

    const recent = Array.isArray(state?.recentBehaviorOutcomes)
      ? state.recentBehaviorOutcomes
        .filter((candidate) => candidate !== outcome)
        .filter((candidate) => ["failed", "rescheduled", "skipped"].includes(candidate.status))
        .at(-1)
      : null;
    if (recent) {
      const recentLabel = recent.status === "skipped"
        ? "被暂时跳过"
        : recent.status === "rescheduled"
          ? `没完成，已决定${recent.retryPlan?.label || "稍后"}补做`
          : "没完成，也没有继续补做";
      lines.push(
        `刚才的行为“${recent.activity || "之前的安排"}”${recentLabel}；${recent.failureReason || recent.attempts?.at(-1)?.skipReason || "当时状态不太合适"}。`,
      );
    }

    const pending = Array.isArray(state?.pendingBehaviorRetries)
      ? state.pendingBehaviorRetries[0]
      : null;
    if (pending?.retryPlan) {
      lines.push(
        `还有一项“${pending.activity || "之前的安排"}”计划在${pending.retryPlan.label || "稍后"}补做。`,
      );
    }
    return lines.join("\n");
  }

  function buildRuntimeContextFromState(state) {
    if (!state?.current) {
      return "";
    }
    const entry = state.current;
    const runtime = state.runtimeState || {};
    const runtimeStatus = runtime.status || (
      entry.kind === "commute"
        ? "in_transit"
        : entry.kind === "prepare"
          ? "preparing"
          : "stable"
    );
    const currentActivity = runtimeStatus === "blocked_transition"
      ? runtime.activity || entry.activity
      : entry.activity;
    const currentEnvironment = runtimeStatus === "blocked_transition"
      ? runtime.environment || entry.environment
      : entry.environment;
    const currentLocation = runtime.location || entry.location || "";
    const sleepStatus = state.isSleeping
      ? "当前处于睡眠状态；如果用户询问你在做什么，应如实说你正在睡觉。"
      : state.caffeineOverride
        ? "原计划正在睡觉，但用户使用了 /caffeine；当前对这个用户视为已经醒来。"
        : "当前不是睡眠状态。";
    const locationStatus = !configuredVideoLocationGuard
      ? currentLocation
        ? `当前地点记录：${currentLocation}（仅作日程参考；用户明确要求的视频地点优先）。`
        : "当前地点未单独记录；用户明确要求的视频地点可按请求处理。"
      : runtimeStatus === "in_transit"
        ? `正在从${runtime.location || entry.location || "出发地"}前往${runtime.destination || entry.destination || "目的地"}，还在路上，尚未到达。`
        : runtimeStatus === "preparing"
          ? `当前仍在${currentLocation || "出发地"}做出门准备，尚未出发；计划前往${runtime.destination || "下一个地点"}。`
          : runtimeStatus === "blocked_transition"
            ? `状态连续性约束：仍在${currentLocation || "上一地点"}，尚未完成前往${runtime.destination || "目的地"}的移动。`
            : currentLocation
              ? `当前地点：${currentLocation}。`
              : "当前地点未单独记录，以环境描述为准。";
    const continuityLines = [
      `状态机阶段：${runtime.phase || getEntryPhase(entry)}；状态：${runtimeStatus}。`,
      runtime.outfit ? `当前穿着：${runtime.outfit}。` : "当前穿着没有单独记录；保持最近一次已知穿着连续。",
      Array.isArray(runtime.carriedItems) && runtime.carriedItems.length > 0
        ? `当前随身物品：${runtime.carriedItems.join("、")}。`
        : "当前随身物品没有单独记录；不要凭空更换或增加关键物品。",
      !configuredVideoLocationGuard
        ? "当前日程状态存在时只作连续性参考；不要因为地点状态同步异常拒绝用户明确的视频请求，普通日常回复仍应如实描述当前地点。"
        : runtimeStatus === "blocked_transition"
          ? "不要声称已经到达目标地点，也不要生成目标地点的自拍；先如实说明还在原地点或移动尚未完成。"
        : "在本轮回复、图片和视频中保持当前地点、环境、活动、穿着和随身物品连续；只有日程真正进入新的 prepare/commute/到达阶段后才切换。",
      "不要向用户解释状态机或后台记录。",
    ];
    const behaviorContext = buildBehaviorContext(state);
    return [
      "角色日程运行时状态（这是当前角色的内部现实设定）：",
      `日期：${state.dateKey}；时区：${state.timezone}；当前分钟：${formatMinute(state.minute)}。`,
      `当前计划：${formatMinute(entry.startMinute)}-${formatMinute(entry.endMinute)}，${currentActivity}。`,
      `当前环境：${currentEnvironment}；情绪/精力：${runtime.mood || entry.mood}。`,
      locationStatus,
      ...continuityLines,
      sleepStatus,
      behaviorContext,
      "当用户问“你在做什么/现在在哪/刚才在干嘛”等问题时，优先根据这段当前日程和环境回答，不要编造与日程冲突的活动；除非用户明确问日程机制，否则不要提到后台计划表或系统实现。",
    ].join("\n");
  }

  async function getRuntimeContext(roleName, scope = null, at = now()) {
    return buildRuntimeContextFromState(await getState(roleName, { scope, at }));
  }

  function formatSchedule(schedule) {
    if (!schedule?.entries?.length) {
      return "今天还没有可用的日程。";
    }
    return schedule.entries
      .map((entry) => {
        const environment = entry.environment ? `（${entry.environment}）` : "";
        const destination = entry.kind === "commute" && entry.destination
          ? ` → ${entry.destination}`
          : "";
        const location = entry.location ? ` [${entry.location}${destination}]` : "";
        return `${formatMinute(entry.startMinute)}-${formatMinute(entry.endMinute)} ${entry.activity}${location}${environment}`;
      })
      .join("\n");
  }

  async function getTodaySchedule(roleName, at = now()) {
    const schedule = await ensureDailySchedule(roleName, at);
    return schedule ? { ...schedule, formatted: formatSchedule(schedule) } : null;
  }

  async function maybeSendProactive(session, at = now()) {
    if (typeof sendProactive !== "function" || !session?.roleName || session.chatId === undefined || session.userId === undefined) {
      return { sent: false, reason: "not-configured" };
    }
    const state = await getState(session.roleName, {
      scope: { chatId: session.chatId, userId: session.userId },
      at,
    });
    if (
      !state?.current ||
      state.isSleeping ||
      state.runtimeState?.status === "blocked_transition" ||
      !isIdleEntry(state.current)
    ) {
      return { sent: false, reason: "not-idle", state };
    }

    const previousRecords = await db.findAsync({
      type: PROACTIVE_RECORD_TYPE,
      chatId: session.chatId,
      userId: session.userId,
      roleNameKey: state.schedule.roleNameKey,
      dateKey: state.dateKey,
    });
    const latestSentAt = previousRecords
      .map((record) => Date.parse(record.sentAt || record.createdAt || ""))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0] || 0;
    const referenceTimestamp = at instanceof Date ? at.getTime() : Date.parse(at) || Date.now();
    if (latestSentAt && referenceTimestamp - latestSentAt < cooldown) {
      return { sent: false, reason: "cooldown", state };
    }
    const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
    if (roll >= configuredProactiveProbability) {
      return { sent: false, reason: "random-skip", state };
    }

    const roles = await getRoles();
    const role = roles.find((candidate) =>
      normalizeRoleNameKey(candidate.name) === state.schedule.roleNameKey,
    );
    if (!role) {
      return { sent: false, reason: "role-not-found", state };
    }

    const sentAt = (at instanceof Date ? at : new Date(at)).toISOString();
    const existing = previousRecords.find((record) =>
      Number(record.entryStartMinute) === Number(state.current.startMinute),
    );
    const record = {
      type: PROACTIVE_RECORD_TYPE,
      chatId: session.chatId,
      userId: session.userId,
      roleName: role.name,
      roleNameKey: state.schedule.roleNameKey,
      dateKey: state.dateKey,
      entryStartMinute: state.current.startMinute,
      kind: state.current.kind,
      sentAt,
      ...(existing?.createdAt ? { createdAt: existing.createdAt } : { createdAt: sentAt }),
    };
    if (existing?._id) {
      await db.updateAsync({ _id: existing._id }, { $set: record });
    } else {
      await db.insertAsync(record);
    }

    try {
      const result = await sendProactive({
        role,
        session,
        state,
      });
      return { sent: true, result, state };
    } catch (error) {
      logger.warn?.("发送角色主动日程消息失败:", error.message || error);
      return { sent: false, reason: "send-failed", error, state };
    }
  }

  async function tick(at = now()) {
    if (tickRunning) {
      return;
    }
    tickRunning = true;
    try {
      const roles = await getRoles();
      for (const role of roles) {
        await ensureDailySchedule(role, at);
        await processDueBehaviorRetries(role, at);
        await processBehavior(role, at);
      }
      await repairBlockedRuntimeStates(at);
      if (typeof sendProactive === "function") {
        const sessions = await db.findAsync({ type: "chat-session" });
        for (const session of sessions) {
          await maybeSendProactive(session, at);
        }
      }
    } catch (error) {
      logger.warn?.("角色日程定时检查失败:", error.message || error);
    } finally {
      tickRunning = false;
    }
  }

  function startScheduler() {
    if (schedulerTimer) {
      return;
    }
    void tick();
    schedulerTimer = setInterval(() => void tick(), Math.max(1_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
    schedulerTimer.unref?.();
  }

  function stopScheduler() {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = undefined;
    }
  }

  return {
    buildRuntimeContextFromState,
    ensureDailySchedule,
    formatSchedule,
    getDateKey: (date = now()) => getDateKey(date, resolvedTimezone),
    getMinuteOfDay: (date = now()) => getMinuteOfDay(date, resolvedTimezone),
    getState,
    getRuntimeState: async (roleName, scope = null, at = now()) =>
      (await getState(roleName, { scope, at }))?.runtimeState || null,
    getRuntimeContext,
    getTodaySchedule,
    repairBlockedRuntimeStates,
    isBehaviorEntry,
    isIdleEntry,
    isSleepEntry,
    maybeSendProactive,
    processBehavior,
    processDueBehaviorRetries,
    shouldHandleIncomingMessage,
    startScheduler,
    stopScheduler,
    tick,
    wakeWithCaffeine,
  };
}

module.exports = {
  BEHAVIOR_RECORD_TYPE,
  CAFFEINE_RECORD_TYPE,
  DEFAULT_TIMEZONE,
  IDLE_KINDS,
  ROLE_STATE_RECORD_TYPE,
  ROLE_STATE_VERSION,
  SCHEDULE_RECORD_TYPE,
  SCHEDULE_VERSION,
  SLEEP_KINDS,
  buildFallbackSchedule,
  createRoleScheduleManager,
  formatMinute,
  getDateKey,
  getMinuteOfDay,
  isBehaviorEntry,
  isIdleEntry,
  isSleepEntry,
  normalizeScheduleEntries,
  parseSchedulePayload,
};
