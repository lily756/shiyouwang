"use strict";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const SCHEDULE_RECORD_TYPE = "role-daily-schedule";
const CAFFEINE_RECORD_TYPE = "role-caffeine-override";
const PROACTIVE_RECORD_TYPE = "role-schedule-proactive";
const BEHAVIOR_RECORD_TYPE = "role-behavior-outcome";
const ROLE_STATE_RECORD_TYPE = "role-runtime-state";
const ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE = "role-physical-state-event";
const ROLE_RUNTIME_OVERRIDE_RECORD_TYPE = "role-runtime-override";
const ROLE_AFFECTIVE_STATE_RECORD_TYPE = "role-affective-state";
const ROLE_PROACTIVE_PREFERENCE_RECORD_TYPE = "role-proactive-preference";
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
const DAILY_SEED_NAMESPACE = "role-daily-plan";
const DAILY_SEED_VERSION = 1;
const SCHEDULE_VERSION = 4;
const ROLE_STATE_VERSION = 1;
const PHYSICAL_STATE_VERSION = 1;
const RUNTIME_OVERRIDE_VERSION = 1;
const AFFECTIVE_STATE_VERSION = 1;
const PROACTIVE_PREFERENCE_VERSION = 1;
const DEFAULT_PREPARATION_MINUTES = 15;
const DEFAULT_TRAVEL_MINUTES = 15;
const MIN_TRANSITION_MINUTES = 10;

// These six axes intentionally describe both the relationship baseline and
// the character's current reaction. Long-term values change slowly and stay
// across sessions; short-term values are allowed to cool back toward that
// baseline after a conversation.
const EMOTION_DIMENSIONS = Object.freeze([
  "valence",
  "arousal",
  "closeness",
  "trust",
  "security",
  "stress",
]);
const EMOTION_DIMENSION_LABELS = Object.freeze({
  valence: "愉悦",
  arousal: "唤醒",
  closeness: "亲近",
  trust: "信任",
  security: "安全感",
  stress: "压力",
});
const BODY_CONDITION_FIELDS = Object.freeze([
  "health",
  "illness",
  "fatigue",
  "sleepiness",
  "pain",
]);
const BODY_CONDITION_LABELS = Object.freeze({
  health: "健康",
  illness: "病症负担",
  fatigue: "疲劳",
  sleepiness: "困倦",
  pain: "不适/疼痛",
});
const DEFAULT_LONG_TERM_EMOTION = Object.freeze({
  valence: 55,
  arousal: 45,
  closeness: 35,
  trust: 45,
  security: 50,
  stress: 25,
});
const DEFAULT_BODY_CONDITION = Object.freeze({
  health: 85,
  illness: 0,
  fatigue: 25,
  sleepiness: 25,
  pain: 0,
  condition: "",
  symptoms: [],
});
const SHORT_TERM_EMOTION_HALF_LIFE_HOURS = 6;
const BODY_HEALTH_RECOVERY_HALF_LIFE_HOURS = 14 * 24;
const BODY_ILLNESS_RECOVERY_HALF_LIFE_HOURS = 72;
const BODY_FATIGUE_RECOVERY_HALF_LIFE_HOURS = 10;
const BODY_SLEEPINESS_RECOVERY_HALF_LIFE_HOURS = 3;
const MAX_SHORT_TERM_EMOTION_DELTA = 45;
const MAX_LONG_TERM_EMOTION_DELTA = 12;
const MAX_BODY_CONDITION_DELTA = 50;
const PROACTIVE_FREQUENCY_MODES = Object.freeze([
  "off",
  "low",
  "normal",
  "high",
  "custom",
]);
const MIN_CUSTOM_PROACTIVE_INTERVAL_MINUTES = 5;
const MAX_CUSTOM_PROACTIVE_INTERVAL_MINUTES = 24 * 60;

const PHYSICAL_STATE_FIELDS = Object.freeze([
  "outfit",
  "carriedItems",
  "heldItems",
  "internalDevices",
  "bodyState",
  "limbStates",
]);
const PERSISTENT_PHYSICAL_STATE_FIELDS = Object.freeze(["internalDevices"]);
const RUNTIME_OVERRIDE_FIELDS = Object.freeze([
  "location",
  "destination",
  "activity",
  "environment",
  "mood",
]);
// A schedule can describe an activity snapshot (for example, "holding a
// sponge" while washing dishes), but that is not a durable fact about the
// character. These fields are reset at the next schedule boundary unless an
// explicit user/model state event keeps them alive.
const EPHEMERAL_SCHEDULE_PHYSICAL_STATE_FIELDS = Object.freeze([
  "heldItems",
  "bodyState",
  "limbStates",
]);
const INDOOR_TRANSITION_MINUTES = 1;
const RESIDENTIAL_INTERIOR_PATTERN = /(^家$|家里|住宅|公寓|宿舍|主卧|次卧|卧室|主卫|客卫|卫生间|洗手间|浴室|客厅|厨房|书房|工作角|阳台|玄关|衣帽间|储物间)/u;
const OFFICE_INTERIOR_PATTERN = /(办公室|工位|会议室|茶水间)/u;

const LIMB_STATE_ALIASES = new Map([
  ["leftarm", "leftArm"],
  ["left_arm", "leftArm"],
  ["左臂", "leftArm"],
  ["左胳膊", "leftArm"],
  ["rightarm", "rightArm"],
  ["right_arm", "rightArm"],
  ["右臂", "rightArm"],
  ["右胳膊", "rightArm"],
  ["lefthand", "leftHand"],
  ["left_hand", "leftHand"],
  ["左手", "leftHand"],
  ["righthand", "rightHand"],
  ["right_hand", "rightHand"],
  ["右手", "rightHand"],
  ["leftleg", "leftLeg"],
  ["left_leg", "leftLeg"],
  ["左腿", "leftLeg"],
  ["rightleg", "rightLeg"],
  ["right_leg", "rightLeg"],
  ["右腿", "rightLeg"],
  ["leftfoot", "leftFoot"],
  ["left_foot", "leftFoot"],
  ["左脚", "leftFoot"],
  ["rightfoot", "rightFoot"],
  ["right_foot", "rightFoot"],
  ["右脚", "rightFoot"],
]);

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

function getDailyScheduleSeedKey(roleName, dateKey) {
  return `${DAILY_SEED_NAMESPACE}:${DAILY_SEED_VERSION}:${normalizeRoleNameKey(roleName)}:${String(dateKey || "")}`;
}

function hashSeedText(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getDailyScheduleSeed(roleName, dateKey) {
  return hashSeedText(getDailyScheduleSeedKey(roleName, dateKey));
}

function createSeededRandom(seed) {
  let state = ((Number(seed) >>> 0) + 0x6d2b79f5) >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seededInteger(random, minimum, maximum) {
  const low = Math.ceil(Number(minimum));
  const high = Math.floor(Number(maximum));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return Number.isFinite(low) ? low : 0;
  }
  return low + Math.floor(random() * (high - low + 1));
}

function normalizeSeed(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number >>> 0 : fallback >>> 0;
}

function seededPick(random, values, fallback = "") {
  const candidates = Array.isArray(values) ? values.filter(Boolean) : [];
  return candidates.length > 0
    ? candidates[seededInteger(random, 0, candidates.length - 1)]
    : fallback;
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
      : value && typeof value === "object"
        ? Object.values(value)
      : [];
  return values
    .map((item) => normalizeStateText(item, 80))
    .filter(Boolean)
    .slice(0, 12);
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeProactiveFrequencyMode(value, fallback = "normal") {
  const requested = String(value || "").trim().toLocaleLowerCase();
  return PROACTIVE_FREQUENCY_MODES.includes(requested) ? requested : fallback;
}

function normalizeProactivePreference(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = normalizeProactiveFrequencyMode(source.mode);
  const requestedInterval = source.intervalMinutes ?? source.interval_minutes;
  const intervalNumber = Number(requestedInterval);
  const intervalMinutes = Number.isFinite(intervalNumber)
    ? clampInteger(
      intervalNumber,
      MIN_CUSTOM_PROACTIVE_INTERVAL_MINUTES,
      MIN_CUSTOM_PROACTIVE_INTERVAL_MINUTES,
      MAX_CUSTOM_PROACTIVE_INTERVAL_MINUTES,
    )
    : null;
  return {
    mode,
    intervalMinutes: mode === "custom" ? intervalMinutes : null,
  };
}

function clampStateScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Math.round(Math.min(100, Math.max(0, Number(fallback) || 0)));
  }
  return Math.round(Math.min(100, Math.max(0, number)));
}

function cloneEmotionVector(value, fallback = DEFAULT_LONG_TERM_EMOTION) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = fallback && typeof fallback === "object" ? fallback : DEFAULT_LONG_TERM_EMOTION;
  return Object.fromEntries(
    EMOTION_DIMENSIONS.map((dimension) => [
      dimension,
      clampStateScore(source[dimension], defaults[dimension]),
    ]),
  );
}

function normalizeEmotionDeltas(value, maximum) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const dimension of EMOTION_DIMENSIONS) {
    if (!hasOwn(value, dimension)) {
      continue;
    }
    const number = Number(value[dimension]);
    if (!Number.isFinite(number)) {
      continue;
    }
    result[dimension] = Math.round(Math.min(maximum, Math.max(-maximum, number)));
  }
  return result;
}

function applyEmotionDeltas(base, deltas) {
  const next = cloneEmotionVector(base);
  for (const dimension of EMOTION_DIMENSIONS) {
    if (hasOwn(deltas, dimension)) {
      next[dimension] = clampStateScore(next[dimension] + Number(deltas[dimension] || 0));
    }
  }
  return next;
}

function getElapsedHours(timestamp, at = new Date()) {
  const previous = Date.parse(String(timestamp || ""));
  const current = at instanceof Date ? at.getTime() : Date.parse(String(at || ""));
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) {
    return 0;
  }
  return Math.min(24 * 365, (current - previous) / (60 * 60 * 1_000));
}

function relaxStateScore(value, target, elapsedHours, halfLifeHours) {
  const source = clampStateScore(value, target);
  const destination = clampStateScore(target, source);
  const hours = Math.max(0, Number(elapsedHours) || 0);
  const halfLife = Math.max(0.001, Number(halfLifeHours) || 1);
  if (hours <= 0 || source === destination) {
    return source;
  }
  const remaining = Math.pow(0.5, hours / halfLife);
  return clampStateScore(destination + (source - destination) * remaining, destination);
}

function deriveShortTermEmotion(value, longTerm, updatedAt, at) {
  const baseline = cloneEmotionVector(longTerm);
  const current = cloneEmotionVector(value, baseline);
  const elapsedHours = getElapsedHours(updatedAt, at);
  if (elapsedHours <= 0) {
    return current;
  }
  return Object.fromEntries(
    EMOTION_DIMENSIONS.map((dimension) => [
      dimension,
      relaxStateScore(
        current[dimension],
        baseline[dimension],
        elapsedHours,
        SHORT_TERM_EMOTION_HALF_LIFE_HOURS,
      ),
    ]),
  );
}

function cloneBodyCondition(value, fallback = DEFAULT_BODY_CONDITION) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = fallback && typeof fallback === "object" ? fallback : DEFAULT_BODY_CONDITION;
  const result = {};
  for (const field of BODY_CONDITION_FIELDS) {
    result[field] = clampStateScore(source[field], defaults[field]);
  }
  result.condition = hasOwn(source, "condition")
    ? normalizeOptionalStateText(source.condition, 180) || ""
    : normalizeOptionalStateText(defaults.condition, 180) || "";
  result.symptoms = hasOwn(source, "symptoms")
    ? normalizeStateList(source.symptoms)
    : normalizeStateList(defaults.symptoms);
  return result;
}

function normalizeBodyConditionDeltas(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const field of BODY_CONDITION_FIELDS) {
    if (!hasOwn(value, field)) {
      continue;
    }
    const number = Number(value[field]);
    if (!Number.isFinite(number)) {
      continue;
    }
    result[field] = Math.round(Math.min(MAX_BODY_CONDITION_DELTA, Math.max(-MAX_BODY_CONDITION_DELTA, number)));
  }
  return result;
}

function applyBodyConditionDeltas(base, deltas) {
  const next = cloneBodyCondition(base);
  for (const field of BODY_CONDITION_FIELDS) {
    if (hasOwn(deltas, field)) {
      next[field] = clampStateScore(next[field] + Number(deltas[field] || 0));
    }
  }
  return next;
}

function getScheduledBodyTargets({ current = null, minute = 0, caffeineOverride = false } = {}) {
  const hour = Math.min(23, Math.max(0, Math.floor((Number(minute) || 0) / 60)));
  if (current?.kind === "sleep") {
    return {
      fatigue: 15,
      sleepiness: caffeineOverride ? 70 : 95,
    };
  }
  if (current?.kind === "nap") {
    return {
      fatigue: 20,
      sleepiness: caffeineOverride ? 60 : 82,
    };
  }
  if (hour < 6) {
    return { fatigue: 50, sleepiness: 78 };
  }
  if (hour < 9) {
    return { fatigue: 35, sleepiness: 38 };
  }
  if (hour < 17) {
    return { fatigue: 25, sleepiness: 22 };
  }
  if (hour < 21) {
    return { fatigue: 35, sleepiness: 36 };
  }
  return { fatigue: 50, sleepiness: 70 };
}

function deriveBodyCondition(value, updatedAt, {
  at = new Date(),
  current = null,
  minute = 0,
  caffeineOverride = false,
} = {}) {
  const body = cloneBodyCondition(value);
  const elapsedHours = getElapsedHours(updatedAt, at);
  const targets = getScheduledBodyTargets({ current, minute, caffeineOverride });
  const result = {
    ...body,
    health: relaxStateScore(
      body.health,
      DEFAULT_BODY_CONDITION.health,
      elapsedHours,
      BODY_HEALTH_RECOVERY_HALF_LIFE_HOURS,
    ),
    illness: relaxStateScore(
      body.illness,
      0,
      elapsedHours,
      BODY_ILLNESS_RECOVERY_HALF_LIFE_HOURS,
    ),
    fatigue: relaxStateScore(
      body.fatigue,
      targets.fatigue,
      elapsedHours,
      BODY_FATIGUE_RECOVERY_HALF_LIFE_HOURS,
    ),
    sleepiness: relaxStateScore(
      body.sleepiness,
      targets.sleepiness,
      elapsedHours,
      BODY_SLEEPINESS_RECOVERY_HALF_LIFE_HOURS,
    ),
    pain: relaxStateScore(
      body.pain,
      0,
      elapsedHours,
      BODY_ILLNESS_RECOVERY_HALF_LIFE_HOURS,
    ),
  };
  if (current?.kind === "sleep") {
    result.sleepiness = Math.max(result.sleepiness, caffeineOverride ? 70 : 95);
  } else if (current?.kind === "nap") {
    result.sleepiness = Math.max(result.sleepiness, caffeineOverride ? 60 : 82);
  }
  return result;
}

function normalizeAffectiveStateUpdate(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const conditionSpecified = hasOwn(source, "condition");
  const symptomsSpecified = hasOwn(source, "symptoms");
  return {
    shortTermDelta: normalizeEmotionDeltas(
      source.shortTermDelta || source.short_term_delta,
      MAX_SHORT_TERM_EMOTION_DELTA,
    ),
    longTermDelta: normalizeEmotionDeltas(
      source.longTermDelta || source.long_term_delta,
      MAX_LONG_TERM_EMOTION_DELTA,
    ),
    bodyDelta: normalizeBodyConditionDeltas(source.bodyDelta || source.body_delta),
    conditionSpecified,
    condition: conditionSpecified ? normalizeOptionalStateText(source.condition, 180) || "" : "",
    symptomsSpecified,
    symptoms: symptomsSpecified ? normalizeStateList(source.symptoms) : [],
  };
}

function hasAffectiveStateUpdate(update) {
  return Boolean(update) && (
    Object.keys(update.shortTermDelta || {}).length > 0 ||
    Object.keys(update.longTermDelta || {}).length > 0 ||
    Object.keys(update.bodyDelta || {}).length > 0 ||
    update.conditionSpecified ||
    update.symptomsSpecified
  );
}

function getAffectiveStateToken(record) {
  if (!record || typeof record !== "object") {
    return "default";
  }
  const fingerprint = hashSeedText(JSON.stringify({
    longTerm: record.longTerm || {},
    shortTerm: record.shortTerm || {},
    body: record.body || {},
  })).toString(36);
  return [
    "affect",
    record._id || "",
    record.updatedAt || record.createdAt || "",
    record.shortTermUpdatedAt || "",
    record.bodyUpdatedAt || "",
    fingerprint,
  ].join(":");
}

function materializeAffectiveState(record, options = {}) {
  const longTerm = cloneEmotionVector(record?.longTerm);
  const shortTerm = deriveShortTermEmotion(
    record?.shortTerm,
    longTerm,
    record?.shortTermUpdatedAt || record?.updatedAt || "",
    options.at,
  );
  const body = deriveBodyCondition(
    record?.body,
    record?.bodyUpdatedAt || record?.updatedAt || "",
    options,
  );
  return {
    version: AFFECTIVE_STATE_VERSION,
    longTerm,
    shortTerm,
    body,
    token: getAffectiveStateToken(record),
    updatedAt: record?.updatedAt || record?.createdAt || "",
  };
}

function formatEmotionVector(value) {
  const emotions = cloneEmotionVector(value);
  return EMOTION_DIMENSIONS
    .map((dimension) => `${EMOTION_DIMENSION_LABELS[dimension]}=${emotions[dimension]}/100`)
    .join("；");
}

function formatBodyCondition(value) {
  const body = cloneBodyCondition(value);
  const metrics = BODY_CONDITION_FIELDS
    .map((field) => `${BODY_CONDITION_LABELS[field]}=${body[field]}/100`);
  if (body.condition) {
    metrics.push(`状态=${body.condition}`);
  }
  if (body.symptoms.length > 0) {
    metrics.push(`症状=${body.symptoms.join("、")}`);
  }
  return metrics.join("；");
}

function pickExplicitStateField(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }
    for (const key of keys) {
      if (hasOwn(source, key)) {
        return { found: true, value: source[key] };
      }
    }
  }
  return { found: false, value: undefined };
}

function normalizeOptionalStateText(value, maximum = 180) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = normalizeStateText(value, maximum);
  return text || null;
}

function normalizeRuntimeOverride(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  const limits = {
    location: 120,
    destination: 120,
    activity: 240,
    environment: 240,
    mood: 80,
  };
  for (const field of RUNTIME_OVERRIDE_FIELDS) {
    if (!hasOwn(value, field)) {
      continue;
    }
    const normalized = normalizeStateText(value[field], limits[field]);
    if (normalized) {
      result[field] = normalized;
    }
  }
  return result;
}

function getRuntimeOverrideToken(record) {
  if (!record || typeof record !== "object") {
    return "";
  }
  return [
    record._id || "",
    record.updatedAt || record.createdAt || "",
    JSON.stringify(normalizeRuntimeOverride(record.updates)),
  ].join(":");
}

function normalizeLimbStateKey(value) {
  const key = String(value || "").trim();
  return LIMB_STATE_ALIASES.get(key.toLocaleLowerCase()) || LIMB_STATE_ALIASES.get(key) || "";
}

function normalizeLimbStates(value) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 12)) {
    const key = normalizeLimbStateKey(rawKey);
    if (!key) {
      continue;
    }
    result[key] = normalizeOptionalStateText(rawValue, 120);
  }
  return result;
}

function normalizePhysicalState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const nested = [value.physicalState, value.continuityState, value.bodyContinuity]
    .find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  const sources = nested ? [value, nested] : [value];
  const result = {};

  const outfit = pickExplicitStateField(sources, ["outfit", "clothing", "costume"]);
  if (outfit.found) {
    result.outfit = normalizeOptionalStateText(outfit.value, 160);
  }

  const carriedItems = pickExplicitStateField(sources, [
    "carriedItems",
    "carried_items",
    "props",
    "items",
  ]);
  if (carriedItems.found) {
    result.carriedItems = normalizeStateList(carriedItems.value);
  }

  const heldItems = pickExplicitStateField(sources, [
    "heldItems",
    "held_items",
    "handItems",
    "hand_items",
    "hands",
  ]);
  if (heldItems.found) {
    result.heldItems = normalizeStateList(heldItems.value);
  }

  const internalDevices = pickExplicitStateField(sources, [
    "internalDevices",
    "internal_devices",
    "implants",
    "implantedDevices",
    "devices",
  ]);
  if (internalDevices.found) {
    result.internalDevices = normalizeStateList(internalDevices.value);
  }

  const bodyState = pickExplicitStateField(sources, [
    "bodyState",
    "body_state",
    "physicalCondition",
    "condition",
  ]);
  if (bodyState.found) {
    result.bodyState = normalizeOptionalStateText(bodyState.value, 180);
  }

  const limbStates = pickExplicitStateField(sources, [
    "limbStates",
    "limb_states",
    "limbs",
    "limbStatus",
    "limb_status",
  ]);
  if (limbStates.found) {
    result.limbStates = normalizeLimbStates(limbStates.value);
  }

  return result;
}

function clonePhysicalState(value) {
  const normalized = normalizePhysicalState(value);
  const result = {};
  for (const field of PHYSICAL_STATE_FIELDS) {
    if (!hasOwn(normalized, field)) {
      continue;
    }
    if (field === "limbStates") {
      result[field] = { ...(normalized[field] || {}) };
    } else if (Array.isArray(normalized[field])) {
      result[field] = [...normalized[field]];
    } else {
      result[field] = normalized[field];
    }
  }
  return result;
}

function mergePhysicalState(previous, next) {
  const result = clonePhysicalState(previous);
  const update = normalizePhysicalState(next);
  for (const field of PHYSICAL_STATE_FIELDS) {
    if (!hasOwn(update, field)) {
      continue;
    }
    if (field === "limbStates") {
      const incoming = update[field] || {};
      if (Object.keys(incoming).length === 0) {
        result[field] = {};
        continue;
      }
      const limbs = {
        ...(result[field] || {}),
      };
      for (const [key, state] of Object.entries(incoming)) {
        if (state === null) {
          delete limbs[key];
        } else {
          limbs[key] = state;
        }
      }
      result[field] = limbs;
    } else if (Array.isArray(update[field])) {
      result[field] = [...update[field]];
    } else {
      result[field] = update[field];
    }
  }
  return result;
}

function resetEphemeralSchedulePhysicalState(value) {
  const result = clonePhysicalState(value);
  for (const field of EPHEMERAL_SCHEDULE_PHYSICAL_STATE_FIELDS) {
    delete result[field];
  }
  return result;
}

function mergePhysicalStateOverride(previous, next) {
  const result = clonePhysicalState(previous);
  const update = normalizePhysicalState(next);
  for (const field of PHYSICAL_STATE_FIELDS) {
    if (!hasOwn(update, field)) {
      continue;
    }
    if (field !== "limbStates") {
      result[field] = Array.isArray(update[field])
        ? [...update[field]]
        : update[field];
      continue;
    }

    const incoming = update.limbStates || {};
    if (Object.keys(incoming).length === 0) {
      // An empty object is the public API's explicit "clear all limbs"
      // signal. Keep it as an override so it also wins over schedule data.
      result.limbStates = {};
      continue;
    }
    const limbs = { ...(result.limbStates || {}) };
    for (const [key, state] of Object.entries(incoming)) {
      limbs[key] = state;
    }
    result.limbStates = limbs;
  }
  return result;
}

function getPhysicalStateAtScheduleIndex(
  entries,
  index,
  events = [],
  asOf = null,
  initialState = {},
) {
  let scheduleState = clonePhysicalState(initialState);
  let eventOverrides = {};
  const lastIndex = Math.min(
    Number.isFinite(Number(index)) ? Number(index) : -1,
    Array.isArray(entries) ? entries.length - 1 : -1,
  );
  const asOfTimestamp = asOf instanceof Date
    ? asOf.getTime()
    : Date.parse(asOf || "");
  const eventsByIndex = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const eventTimestamp = Date.parse(event.createdAt || event.updatedAt || "");
    if (Number.isFinite(asOfTimestamp) && Number.isFinite(eventTimestamp) && eventTimestamp > asOfTimestamp) {
      continue;
    }
    let eventIndex = Array.isArray(entries)
      ? entries.findIndex((entry) => getEntryKey(event.dateKey || "", entry) === event.entryKey)
      : -1;
    if (eventIndex < 0 && Array.isArray(entries)) {
      eventIndex = entries.findIndex((entry) =>
        Number(entry.startMinute) === Number(event.entryStartMinute),
      );
    }
    if (eventIndex < 0 || eventIndex > lastIndex) {
      continue;
    }
    const bucket = eventsByIndex.get(eventIndex) || [];
    bucket.push(event);
    eventsByIndex.set(eventIndex, bucket);
  }
  for (const bucket of eventsByIndex.values()) {
    bucket.sort((left, right) =>
      String(left.createdAt || left.updatedAt || "").localeCompare(
        String(right.createdAt || right.updatedAt || ""),
      ),
    );
  }
  for (let cursor = 0; cursor <= lastIndex; cursor += 1) {
    // Schedule snapshots are only authoritative for the entry they appear
    // on. Without this reset, a temporary action such as dishwashing leaks
    // into every later entry of the day.
    if (cursor > 0) {
      scheduleState = resetEphemeralSchedulePhysicalState(scheduleState);
    }
    scheduleState = mergePhysicalState(scheduleState, entries[cursor]);
    for (const event of eventsByIndex.get(cursor) || []) {
      // Explicit state changes are real conversation events, not schedule
      // hints. They must therefore continue to override later plan entries.
      eventOverrides = mergePhysicalStateOverride(eventOverrides, event.updates);
    }
  }
  return mergePhysicalState(scheduleState, eventOverrides);
}

function clonePhysicalStateValue(value) {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (value && typeof value === "object") {
    return { ...value };
  }
  return value;
}

function buildPhysicalStateChanges(previous, next) {
  const before = clonePhysicalState(previous);
  const after = clonePhysicalState(next);
  const changes = {};
  for (const field of PHYSICAL_STATE_FIELDS) {
    const beforeKnown = hasOwn(before, field);
    const afterKnown = hasOwn(after, field);
    if (!beforeKnown && !afterKnown) {
      continue;
    }
    if (JSON.stringify(beforeKnown ? before[field] : null) === JSON.stringify(afterKnown ? after[field] : null)) {
      continue;
    }
    changes[field] = {
      from: beforeKnown ? clonePhysicalStateValue(before[field]) : null,
      to: afterKnown ? clonePhysicalStateValue(after[field]) : null,
      fromRecorded: beforeKnown,
      toRecorded: afterKnown,
    };
  }
  return changes;
}

function allowsPhysicalStateChange(entry) {
  if (TRANSITION_KINDS.has(entry?.kind)) {
    return true;
  }
  const activity = String(entry?.activity || "");
  return /(换装|换衣|穿上|脱下|穿着|拿起|拾起|捡起|放下|丢下|收起|收拾|取出|装上|卸下|安装|移除|摘下|戴上|受伤|疼痛|酸痛|恢复|治疗|检查|疲惫|疲劳|精力|专注|睡觉|睡眠|醒来|起床|清空|丢掉|捡回|连接|断开)/u.test(activity);
}

function stripPhysicalStateField(entry, field) {
  const nextEntry = { ...entry };
  const nextPhysicalState = normalizePhysicalState(entry);
  delete nextPhysicalState[field];
  if (Object.keys(nextPhysicalState).length > 0) {
    nextEntry.physicalState = nextPhysicalState;
  } else {
    delete nextEntry.physicalState;
  }
  for (const legacyField of [
    "outfit",
    "carriedItems",
    "heldItems",
    "internalDevices",
    "bodyState",
    "limbStates",
  ]) {
    if (legacyField === field) {
      delete nextEntry[legacyField];
    }
  }
  return nextEntry;
}

function enforcePhysicalStateContinuity(entries) {
  let effective = {};
  return entries.map((rawEntry) => {
    let entry = rawEntry;
    const proposed = mergePhysicalState(effective, entry);
    const changes = buildPhysicalStateChanges(effective, proposed);
    if (Object.keys(effective).length > 0 &&
        Object.keys(changes).length > 0 &&
        !allowsPhysicalStateChange(entry)) {
      for (const field of Object.keys(changes)) {
        entry = stripPhysicalStateField(entry, field);
      }
    }
    effective = mergePhysicalState(effective, entry);
    return entry;
  });
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
    proactive: false,
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

function isIndoorLocationMove(fromLocation, toLocation) {
  const from = normalizeLocation(fromLocation);
  const to = normalizeLocation(toLocation);
  if (!from || !to) {
    return false;
  }
  const getDomain = (location) => {
    if (RESIDENTIAL_INTERIOR_PATTERN.test(location)) return "residence";
    if (OFFICE_INTERIOR_PATTERN.test(location)) return "office";
    return "";
  };
  const fromDomain = getDomain(from);
  const toDomain = getDomain(to);
  return Boolean(fromDomain && fromDomain === toDomain);
}

function getMovementDurations(nextEntry, previousEntry) {
  if (isIndoorLocationMove(previousEntry?.location, nextEntry?.location)) {
    return {
      preparationMinutes: 0,
      travelMinutes: INDOOR_TRANSITION_MINUTES,
      indoor: true,
    };
  }
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
    indoor: false,
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
  const indoor = isIndoorLocationMove(fromLocation, toLocation);
  if (indoor) {
    return [{
      startMinute,
      endMinute: startMinute + Math.max(1, travelMinutes),
      kind: "commute",
      activity: `在室内从${fromLocation || "当前位置"}步行前往${destination}`,
      environment: `${fromLocation || "室内"}到${destination}的室内通道`,
      location: fromLocation,
      destination,
      travelMinutes: Math.max(1, travelMinutes),
      mood: "短暂移动中",
      proactive: false,
      movement: true,
      indoorMovement: true,
    }];
  }
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

    const durations = getMovementDurations(entry, previous);
    const previousDuration = previous.endMinute - previous.startMinute;
    const currentDuration = entry.endMinute - entry.startMinute;
    const desiredTotal = durations.preparationMinutes + durations.travelMinutes;
    const previousCanFit = previousDuration > desiredTotal;
    const currentCanFit = currentDuration > desiredTotal;
    let total = desiredTotal;
    let shortenPrevious = previousCanFit;

    if (!previousCanFit && !currentCanFit) {
      const available = Math.max(previousDuration - 1, currentDuration - 1);
      const minimumTransitionMinutes = durations.indoor
        ? INDOOR_TRANSITION_MINUTES
        : MIN_TRANSITION_MINUTES;
      if (available < minimumTransitionMinutes) {
        result.push(entry);
        continue;
      }
      total = Math.min(desiredTotal, available);
      shortenPrevious = previousDuration >= currentDuration;
    }

    let preparationMinutes = durations.preparationMinutes;
    let travelMinutes = durations.travelMinutes;
    if (preparationMinutes + travelMinutes > total) {
      if (durations.indoor) {
        preparationMinutes = 0;
        travelMinutes = total;
      } else {
        preparationMinutes = Math.min(preparationMinutes, Math.max(1, total - 1));
        travelMinutes = total - preparationMinutes;
      }
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
    const indoor = isIndoorLocationMove(previous.location, next.location);
    const changesLocation = previousLocation !== nextLocation;
    if (indoor && changesLocation && entry.kind === "prepare") {
      // Stored schedules created before indoor movement existed must be
      // regenerated from their adjacent main entries.
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
      if (indoor && changesLocation && entry.indoorMovement !== true) {
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
    const physicalState = normalizePhysicalState(raw);
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
      ...(Object.keys(physicalState).length > 0 ? { physicalState } : {}),
      ...(hasOwn(physicalState, "outfit") ? { outfit: physicalState.outfit } : {}),
      ...(hasOwn(physicalState, "carriedItems")
        ? { carriedItems: physicalState.carriedItems }
        : {}),
      ...(hasOwn(physicalState, "heldItems") ? { heldItems: physicalState.heldItems } : {}),
      ...(hasOwn(physicalState, "internalDevices")
        ? { internalDevices: physicalState.internalDevices }
        : {}),
      ...(hasOwn(physicalState, "bodyState") ? { bodyState: physicalState.bodyState } : {}),
      ...(hasOwn(physicalState, "limbStates") ? { limbStates: physicalState.limbStates } : {}),
      ...(preparationMinutes ? { preparationMinutes } : {}),
      ...(travelMinutes ? { travelMinutes } : {}),
      mood: normalizeText(raw.mood ?? raw.energy, "平常状态", 80),
      proactive: !TRANSITION_KINDS.has(kind) && (
        raw.proactive === true ||
        (raw.proactive !== false && IDLE_KINDS.has(kind))
      ),
      ...(raw.movement === true || TRANSITION_KINDS.has(kind) ? { movement: true } : {}),
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  const continuitySafeCandidates = enforcePhysicalStateContinuity(candidates);
  const entries = [];
  let cursor = 0;

  for (const candidate of continuitySafeCandidates) {
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
      { start: "20:00", end: "22:30", kind: "rest", activity: "自由安排、休息和处理杂事", location: "家", environment: "家里或喜欢的角落", proactive: false },
      { start: "22:30", end: "24:00", kind: "sleep", activity: "准备睡觉并进入睡眠", location: "家", environment: "卧室，灯光很暗" },
    ],
  });
}

function buildSeededSchedule({ role = {}, dateKey = "", seed } = {}) {
  const dailySeed = Number.isFinite(Number(seed))
    ? Number(seed) >>> 0
    : getDailyScheduleSeed(role?.name, dateKey);
  const random = createSeededRandom(dailySeed);
  const profile = [role?.name, role?.description, role?.systemPrompt]
    .filter(Boolean)
    .join(" ");
  const isStudent = /(学生|学校|上课|课程|考试|学习)/u.test(profile);
  const isCreative = /(作家|画家|音乐|创作|设计|艺术|摄影|写作|程序员|开发)/u.test(profile);
  const isRemote = /(远程|居家|宅|在家工作|自由职业)/u.test(profile);
  const home = "家";
  const mainLocation = isRemote
    ? home
    : seededPick(random, isStudent
      ? ["学校", "图书馆", "自习室"]
      : ["办公室", "工作室", "安静的咖啡馆"], "工作地点");
  const mainEnvironment = mainLocation === "学校"
    ? "教室或校园里的学习空间"
    : mainLocation === "图书馆"
      ? "靠窗的阅览桌"
      : mainLocation === "自习室"
        ? "安静的自习桌"
        : mainLocation === "安静的咖啡馆"
          ? "靠墙的座位和小桌"
          : mainLocation === "工作室"
            ? "工作台和电脑前"
            : mainLocation === home
              ? "家里的书桌或工作角落"
              : "办公室的书桌或工作空间";
  const mainKind = isStudent ? "study" : isCreative ? "creative" : "work";
  const mainActivities = isStudent
    ? ["整理课程笔记", "完成当天的学习任务", "阅读资料并做练习"]
    : isCreative
      ? ["推进手头的创作", "整理灵感并完成一段作品", "处理今天的重要创作任务"]
      : ["处理今天的重要事情", "专注完成手头的工作", "整理待办并推进主要任务"];
  const mainActivity = seededPick(random, mainActivities, "处理今天的重要事情");
  const outsideOutfit = seededPick(random, ["日常外出服", "轻便外套", "舒适的工作服"], "日常外出服");
  const commuteStyle = seededPick(random, ["步行", "公交或地铁", "骑车"], "步行");
  const secondaryOptions = [
    {
      location: "附近公园",
      kind: "exercise",
      activity: seededPick(random, ["散步放松", "做一点轻运动", "在户外走走"], "散步放松"),
      environment: "树荫下的小路或长椅旁",
    },
    {
      location: "安静的咖啡馆",
      kind: isCreative ? "creative" : "leisure",
      activity: isCreative ? "带着灵感做一点轻量创作" : "坐下来喝点东西、看看窗外",
      environment: "靠窗的座位，背景有轻微的环境声",
    },
    {
      location: "社区活动室",
      kind: "social",
      activity: "和熟悉的人聊一会儿天",
      environment: "不太吵闹的公共活动空间",
    },
  ];
  const secondary = seededPick(random, secondaryOptions, secondaryOptions[0]);
  const entries = [];
  let cursor = 0;
  let currentLocation = home;
  let currentEnvironment = "卧室，安静昏暗";

  function addEntry(duration, entry) {
    const minutes = Math.max(0, Math.floor(Number(duration) || 0));
    const endMinute = Math.min(1440, cursor + minutes);
    if (endMinute <= cursor) {
      return false;
    }
    entries.push({
      startMinute: cursor,
      endMinute,
      ...entry,
    });
    cursor = endMinute;
    if (entry.location) {
      currentLocation = entry.location;
    }
    if (entry.environment) {
      currentEnvironment = entry.environment;
    }
    return true;
  }

  function addMovement(toLocation, toEnvironment, preparationMinutes, travelMinutes) {
    if (!toLocation || normalizeLocationKey(toLocation) === normalizeLocationKey(currentLocation)) {
      return true;
    }
    const fromLocation = currentLocation;
    const fromEnvironment = currentEnvironment;
    const leavingHome = normalizeLocationKey(fromLocation) === normalizeLocationKey(home) &&
      normalizeLocationKey(toLocation) !== normalizeLocationKey(home);
    addEntry(preparationMinutes, {
      kind: "prepare",
      activity: leavingHome
        ? "出门准备：换衣服、拿好钥匙、手机和钱包"
        : `收拾东西，准备前往${toLocation}`,
      location: fromLocation,
      environment: fromEnvironment,
      mood: "准备出发",
      proactive: false,
      movement: true,
      ...(leavingHome
        ? {
            physicalState: {
              outfit: outsideOutfit,
              carriedItems: ["钥匙", "手机", "钱包"],
            },
          }
        : {}),
    });
    addEntry(travelMinutes, {
      kind: "commute",
      activity: `乘${commuteStyle}前往${toLocation}`,
      location: fromLocation,
      destination: toLocation,
      environment: `从${fromLocation}前往${toLocation}的路上`,
      travelMinutes,
      mood: "在路上",
      proactive: false,
      movement: true,
    });
    currentLocation = toLocation;
    currentEnvironment = toEnvironment || toLocation;
    return true;
  }

  const wakeMinute = seededInteger(random, 390, 480);
  const breakfastDuration = seededInteger(random, 20, 35);
  const morningRoutineDuration = seededInteger(random, 15, 30);
  const morningPreparation = seededInteger(random, 10, 20);
  const morningTravel = seededInteger(random, 12, 28);

  addEntry(wakeMinute, {
    kind: "sleep",
    activity: "睡觉",
    location: home,
    environment: "卧室，安静昏暗",
    mood: "熟睡",
    physicalState: { outfit: "睡衣", bodyState: "睡眠中" },
  });
  addEntry(morningRoutineDuration, {
    kind: "routine",
    activity: "起床、洗漱和整理自己",
    location: home,
    environment: "卧室与洗手间",
    mood: "慢慢清醒",
    physicalState: { bodyState: "刚醒，逐渐清醒" },
  });
  addEntry(breakfastDuration, {
    kind: "meal",
    activity: seededPick(random, ["吃早餐", "简单吃点东西", "一边喝饮品一边吃早餐"], "吃早餐"),
    location: home,
    environment: "餐桌或厨房",
    mood: "平静",
    proactive: true,
  });

  const lunchStart = seededInteger(random, 690, 750);
  if (normalizeLocationKey(mainLocation) !== normalizeLocationKey(home)) {
    addMovement(mainLocation, mainEnvironment, morningPreparation, morningTravel);
  }
  addEntry(Math.max(30, lunchStart - cursor), {
    kind: mainKind,
    activity: mainActivity,
    location: mainLocation,
    environment: mainEnvironment,
    mood: "逐渐进入状态",
  });
  addEntry(seededInteger(random, 40, 65), {
    kind: "meal",
    activity: seededPick(random, ["吃午饭并休息一会儿", "认真吃午饭", "简单吃午饭"], "吃午饭"),
    location: mainLocation,
    environment: mainLocation === home ? "家里的餐桌" : "附近餐区或餐厅",
    mood: "放松",
    proactive: true,
  });

  const afternoonTarget = seededInteger(random, 990, 1050);
  const breakStart = Math.min(afternoonTarget - 35, cursor + seededInteger(random, 90, 150));
  addEntry(Math.max(30, breakStart - cursor), {
    kind: mainKind,
    activity: seededPick(random, ["继续处理主要任务", "保持专注完成手头的事", "整理思路并继续推进"], mainActivity),
    location: mainLocation,
    environment: mainEnvironment,
    mood: "专注",
  });
  addEntry(seededInteger(random, 10, 20), {
    kind: "break",
    activity: seededPick(random, ["短暂休息", "离开桌边活动一下", "喝水并看看窗外"], "短暂休息"),
    location: mainLocation,
    environment: mainEnvironment,
    mood: "稍微放松",
    proactive: true,
  });
  addEntry(Math.max(30, afternoonTarget - cursor), {
    kind: mainKind,
    activity: seededPick(random, ["收尾并整理今天的进度", "完成下午的主要安排", "把剩下的事情整理好"], "完成下午的主要安排"),
    location: mainLocation,
    environment: mainEnvironment,
    mood: "渐渐收尾",
  });

  const shouldGoOutside = random() < (isRemote ? 0.65 : 0.82);
  const secondaryPreparation = seededInteger(random, 8, 15);
  const secondaryTravel = seededInteger(random, 10, 24);
  const secondaryDuration = seededInteger(random, 45, 85);
  const returnPreparation = seededInteger(random, 8, 15);
  const returnTravel = seededInteger(random, 12, 25);
  const movementAndActivity = secondaryPreparation + secondaryTravel + secondaryDuration +
    returnPreparation + returnTravel;
  if (shouldGoOutside && cursor + movementAndActivity < 1_280) {
    addMovement(secondary.location, secondary.environment, secondaryPreparation, secondaryTravel);
    addEntry(secondaryDuration, {
      kind: secondary.kind,
      activity: secondary.activity,
      location: secondary.location,
      environment: secondary.environment,
      mood: secondary.kind === "exercise" ? "舒展开来" : "心情放松",
      proactive: secondary.kind !== "social",
    });
    addMovement(home, "家里的客厅或玄关", returnPreparation, returnTravel);
  } else if (normalizeLocationKey(currentLocation) !== normalizeLocationKey(home)) {
    addMovement(home, "家里的客厅或玄关", returnPreparation, returnTravel);
  }

  const dinnerStart = Math.max(cursor, seededInteger(random, 1110, 1185));
  addEntry(dinnerStart - cursor, {
    kind: "rest",
    activity: seededPick(random, ["回家后先放松一会儿", "整理东西、缓一缓", "在家安静待着"], "回家后先放松一会儿"),
    location: home,
    environment: "家里的客厅或喜欢的角落",
    mood: "放松",
    proactive: false,
  });
  addEntry(seededInteger(random, 35, 55), {
    kind: "meal",
    activity: seededPick(random, ["吃晚饭", "慢慢吃晚饭", "准备简单的晚餐并吃饭"], "吃晚饭"),
    location: home,
    environment: "家里的餐桌",
    mood: "安稳",
    proactive: true,
  });

  const sleepStart = Math.min(1410, Math.max(1335, cursor + 30, seededInteger(random, 1335, 1405)));
  addEntry(Math.max(0, sleepStart - cursor), {
    kind: "rest",
    activity: seededPick(random, ["自由安排、看看书或听会儿音乐", "收拾明天要用的东西", "安静休息，慢慢准备睡觉"], "自由安排和休息"),
    location: home,
    environment: "客厅或卧室，灯光逐渐变暗",
    mood: "平静",
    proactive: false,
  });
  addEntry(1440 - cursor, {
    kind: "sleep",
    activity: "准备睡觉并进入睡眠",
    location: home,
    environment: "卧室，安静昏暗",
    mood: "困倦",
    physicalState: { bodyState: "准备入睡" },
  });

  const normalized = normalizeScheduleEntries({ entries });
  return normalized.length > 0 && hasLocationCoverage(normalized)
    ? normalized
    : buildFallbackSchedule();
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
  if (SLEEP_KINDS.has(entry?.kind)) {
    return true;
  }
  // An explicit non-sleep kind wins over wording such as “睡前放松” or
  // “准备睡觉”; otherwise a long rest entry would become sleep early.
  if (entry?.kind && entry.kind !== "routine") {
    return false;
  }
  return /(睡觉|睡眠|午睡|小睡|sleep|nap)/iu.test(entry?.activity || "");
}

function isIdleEntry(entry) {
  return !isTransitionEntry(entry) && !isSleepEntry(entry) && entry?.proactive !== false &&
    (entry?.proactive === true || IDLE_KINDS.has(entry?.kind));
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
  const proactiveLocks = new Map();
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
    const roleName = record.roleName || record.roleNameKey || "";
    const dailySeed = normalizeSeed(
      record.dailySeed,
      getDailyScheduleSeed(roleName, record.dateKey),
    );
    return entries.length > 0 && hasLocationCoverage(entries)
      ? {
          ...record,
          roleNameKey: record.roleNameKey || normalizeRoleNameKey(record.roleName),
          timezone: record.timezone || resolvedTimezone,
          dailySeed,
          dailySeedVersion: record.dailySeedVersion || DAILY_SEED_VERSION,
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

  async function findAffectiveState(roleName, scope) {
    if (!hasRuntimeScope(scope)) {
      return null;
    }
    return db.findOneAsync({
      type: ROLE_AFFECTIVE_STATE_RECORD_TYPE,
      affectiveVersion: AFFECTIVE_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleNameKey: normalizeRoleNameKey(roleName),
    });
  }

  async function getAffectiveState(
    roleName,
    scope,
    {
      at = now(),
      current = null,
      minute = 0,
      caffeineOverride = false,
    } = {},
  ) {
    const record = await findAffectiveState(roleName, scope);
    return materializeAffectiveState(record, {
      at,
      current,
      minute,
      caffeineOverride,
    });
  }

  async function findProactivePreference(roleName, scope) {
    if (!hasRuntimeScope(scope)) {
      return null;
    }
    return db.findOneAsync({
      type: ROLE_PROACTIVE_PREFERENCE_RECORD_TYPE,
      preferenceVersion: PROACTIVE_PREFERENCE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleNameKey: normalizeRoleNameKey(roleName),
    });
  }

  function getProactivePolicy(preference) {
    const normalized = normalizeProactivePreference(preference);
    const normalCooldownMs = Math.max(0, cooldown);
    if (normalized.mode === "off") {
      return {
        ...normalized,
        enabled: false,
        disabledReason: "disabled-by-user",
        probability: 0,
        cooldownMs: Number.POSITIVE_INFINITY,
        allowMultiplePerEntry: false,
      };
    }
    // The server-level probability remains the master switch. This preserves
    // the existing guarantee that an administrator can disable all proactive
    // messages with ROLE_SCHEDULE_PROACTIVE_PROBABILITY=0.
    if (configuredProactiveProbability <= 0) {
      return {
        ...normalized,
        enabled: false,
        disabledReason: "disabled-by-server",
        probability: 0,
        cooldownMs: normalCooldownMs,
        allowMultiplePerEntry: false,
      };
    }
    if (normalized.mode === "low") {
      return {
        ...normalized,
        enabled: true,
        probability: Math.min(1, configuredProactiveProbability * 0.5),
        cooldownMs: Math.max(20 * 60 * 1_000, normalCooldownMs * 2),
        allowMultiplePerEntry: false,
      };
    }
    if (normalized.mode === "high") {
      const cooldownMs = Math.max(
        5 * 60 * 1_000,
        Math.min(normalCooldownMs || 15 * 60 * 1_000, 15 * 60 * 1_000),
      );
      return {
        ...normalized,
        enabled: true,
        probability: Math.min(0.8, Math.max(0.2, configuredProactiveProbability * 3)),
        cooldownMs,
        allowMultiplePerEntry: true,
        intervalMinutes: Math.ceil(cooldownMs / 60_000),
      };
    }
    if (normalized.mode === "custom") {
      const intervalMinutes = normalized.intervalMinutes || MIN_CUSTOM_PROACTIVE_INTERVAL_MINUTES;
      return {
        ...normalized,
        enabled: true,
        probability: 1,
        cooldownMs: intervalMinutes * 60 * 1_000,
        allowMultiplePerEntry: true,
        intervalMinutes,
      };
    }
    return {
      ...normalized,
      enabled: true,
      probability: configuredProactiveProbability,
      cooldownMs: normalCooldownMs,
      allowMultiplePerEntry: false,
    };
  }

  async function getProactivePreference(roleName, scope) {
    const record = await findProactivePreference(roleName, scope);
    return {
      ...normalizeProactivePreference(record),
      updatedAt: record?.updatedAt || record?.createdAt || "",
      source: record ? "user" : "default",
    };
  }

  async function setProactivePreference(
    roleName,
    scope,
    preference,
    { at = now(), reason = "用户调整主动消息频率" } = {},
  ) {
    if (!hasRuntimeScope(scope)) {
      return { ok: false, error: "缺少当前用户和会话范围，无法调整主动消息频率。" };
    }
    const requestedMode = String(preference?.mode || "").trim().toLocaleLowerCase();
    if (!PROACTIVE_FREQUENCY_MODES.includes(requestedMode)) {
      return { ok: false, error: "主动消息频率只能设为 off、low、normal、high 或 custom。" };
    }
    const normalized = normalizeProactivePreference(preference);
    if (normalized.mode === "custom" && !normalized.intervalMinutes) {
      return {
        ok: false,
        error: `自定义频率需要提供 ${MIN_CUSTOM_PROACTIVE_INTERVAL_MINUTES} 到 ${MAX_CUSTOM_PROACTIVE_INTERVAL_MINUTES} 分钟的间隔。`,
      };
    }

    const existing = await findProactivePreference(roleName, scope);
    const timestamp = getBehaviorTimestamp(at);
    const record = {
      type: ROLE_PROACTIVE_PREFERENCE_RECORD_TYPE,
      preferenceVersion: PROACTIVE_PREFERENCE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleName,
      roleNameKey: normalizeRoleNameKey(roleName),
      ...normalized,
      reason: normalizeText(reason, "用户调整主动消息频率", 240),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    if (existing?._id) {
      await db.updateAsync({ _id: existing._id }, { $set: record });
    } else {
      await db.insertAsync(record);
    }
    const savedPreference = {
      ...normalized,
      updatedAt: timestamp,
      source: "user",
    };
    return {
      ok: true,
      preference: savedPreference,
      policy: getProactivePolicy(savedPreference),
    };
  }

  async function findRuntimeOverride(roleName, scope, dateKey) {
    if (!hasRuntimeScope(scope)) {
      return null;
    }
    return db.findOneAsync({
      type: ROLE_RUNTIME_OVERRIDE_RECORD_TYPE,
      overrideVersion: RUNTIME_OVERRIDE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleNameKey: normalizeRoleNameKey(roleName),
      dateKey,
    });
  }

  async function findPhysicalStateEvents(roleName, scope, dateKey) {
    if (!hasRuntimeScope(scope)) {
      return [];
    }
    const records = await db.findAsync({
      type: ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE,
      stateVersion: PHYSICAL_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleNameKey: normalizeRoleNameKey(roleName),
      dateKey,
    });
    return records
      .filter((record) => record?.entryKey || Number.isFinite(Number(record?.entryStartMinute)))
      .sort((left, right) =>
        Number(left.entryStartMinute || 0) - Number(right.entryStartMinute || 0) ||
        String(left.createdAt || "").localeCompare(String(right.createdAt || "")),
      );
  }

  async function findPersistentPhysicalState(roleName, scope, beforeDateKey) {
    if (!hasRuntimeScope(scope)) {
      return {};
    }
    const records = await db.findAsync({
      type: ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE,
      stateVersion: PHYSICAL_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleNameKey: normalizeRoleNameKey(roleName),
    });
    let result = {};
    const priorRecords = records
      .filter((record) => String(record.dateKey || "") < String(beforeDateKey || ""))
      .sort((left, right) =>
        String(left.dateKey || "").localeCompare(String(right.dateKey || "")) ||
        Number(left.entryStartMinute || 0) - Number(right.entryStartMinute || 0) ||
        String(left.createdAt || "").localeCompare(String(right.createdAt || "")),
      );
    for (const record of priorRecords) {
      const updates = normalizePhysicalState(record.updates);
      const persistentUpdates = {};
      for (const field of PERSISTENT_PHYSICAL_STATE_FIELDS) {
        if (hasOwn(updates, field)) {
          persistentUpdates[field] = updates[field];
        }
      }
      result = mergePhysicalState(result, persistentUpdates);
    }
    return result;
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

  function buildRuntimeState({
    roleName,
    scope,
    schedule,
    current,
    currentIndex,
    minute,
    previous,
    physicalStateEvents = [],
    at = null,
    persistentPhysicalState = {},
    runtimeOverride = null,
    affectiveState = null,
  }) {
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

    const overrideUpdates = normalizeRuntimeOverride(runtimeOverride?.updates);
    const hasRuntimeOverride = Object.keys(overrideUpdates).length > 0;
    const hasSpatialOverride = hasOwn(overrideUpdates, "location") ||
      hasOwn(overrideUpdates, "destination");
    if (hasRuntimeOverride) {
      if (hasOwn(overrideUpdates, "location")) {
        location = overrideUpdates.location;
      }
      if (hasOwn(overrideUpdates, "destination")) {
        destination = overrideUpdates.destination;
      } else if (hasOwn(overrideUpdates, "location")) {
        // A confirmed current location is an arrival, rather than an
        // unfinished schedule commute. Do not leave the old target attached.
        destination = "";
      }
      if (hasOwn(overrideUpdates, "activity")) {
        activity = overrideUpdates.activity;
      }
      if (hasOwn(overrideUpdates, "environment")) {
        environment = overrideUpdates.environment;
      }
      if (hasOwn(overrideUpdates, "mood")) {
        mood = overrideUpdates.mood;
      }
      if (hasSpatialOverride) {
        if (!hasOwn(overrideUpdates, "activity") && location) {
          activity = `已到达${location}`;
        }
        if (!hasOwn(overrideUpdates, "environment") && location) {
          environment = location;
        }
        phase = "manual_override";
        status = "stable";
        transitionReason = "manual_runtime_override";
      }
    }

    const previousPhysicalState = getPhysicalStateAtScheduleIndex(
      schedule.entries,
      currentIndex - 1,
      physicalStateEvents,
      at,
      persistentPhysicalState,
    );
    const physicalState = getPhysicalStateAtScheduleIndex(
      schedule.entries,
      currentIndex,
      physicalStateEvents,
      at,
      persistentPhysicalState,
    );
    const physicalStateChanges = buildPhysicalStateChanges(
      previousPhysicalState,
      physicalState,
    );
    const outfit = hasOwn(physicalState, "outfit") && physicalState.outfit
      ? physicalState.outfit
      : "";
    const carriedItems = Array.isArray(physicalState.carriedItems)
      ? physicalState.carriedItems
      : [];
    const effectiveAffectiveState = affectiveState || materializeAffectiveState(null, {
      at,
      current,
      minute,
    });
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
      physicalStateVersion: PHYSICAL_STATE_VERSION,
      physicalState,
      ...(outfit ? { outfit } : {}),
      ...(hasOwn(physicalState, "carriedItems") ? { carriedItems } : {}),
      ...(Object.keys(physicalStateChanges).length > 0 ? { physicalStateChanges } : {}),
      affectiveStateVersion: AFFECTIVE_STATE_VERSION,
      emotionalState: {
        longTerm: cloneEmotionVector(effectiveAffectiveState.longTerm),
        shortTerm: cloneEmotionVector(effectiveAffectiveState.shortTerm),
      },
      bodyCondition: cloneBodyCondition(effectiveAffectiveState.body),
      affectiveStateToken: effectiveAffectiveState.token || "default",
      manualOverride: hasRuntimeOverride,
      runtimeOverrideToken: getRuntimeOverrideToken(runtimeOverride),
      ...(hasRuntimeOverride ? {
        runtimeOverrideUpdatedAt: runtimeOverride.updatedAt || runtimeOverride.createdAt || "",
        runtimeOverrideReason: runtimeOverride.reason || "",
      } : {}),
      stateToken: `${dateKey}:${entryKey}:${status}:${normalizeLocationKey(location)}:${normalizeLocationKey(destination)}:${getRuntimeOverrideToken(runtimeOverride)}:${effectiveAffectiveState.token || "default"}`,
      transitionReason,
      previousState: previous
        ? {
            entryKey: previous.entryKey || "",
            phase: previous.phase || "unknown",
            status: previous.status || "stable",
            location: previous.location || "",
            destination: previous.destination || "",
            physicalState: previousPhysicalState,
            bodyCondition: cloneBodyCondition(previous.bodyCondition),
          }
        : null,
      transitionAt: timestamp,
      updatedAt: timestamp,
      minute,
    };
  }

  async function syncRuntimeState({
    roleName,
    scope,
    schedule,
    current,
    currentIndex,
    minute,
    physicalStateEvents = [],
    at = null,
    persistentPhysicalState = {},
    runtimeOverride = null,
    affectiveState = null,
  }) {
    if (!hasRuntimeScope(scope) || !current) {
      return null;
    }
    const existing = await findRuntimeState(roleName, scope);
    const entryKey = getEntryKey(schedule.dateKey, current);
    if (existing?.dateKey === schedule.dateKey && existing.entryKey === entryKey) {
      const existingPhysicalState = normalizePhysicalState(existing);
      const mergedPhysicalState = getPhysicalStateAtScheduleIndex(
        schedule.entries,
        currentIndex,
        physicalStateEvents,
        at,
        persistentPhysicalState,
      );
      const physicalStateNeedsUpgrade = existing.physicalStateVersion !== PHYSICAL_STATE_VERSION ||
        JSON.stringify(existingPhysicalState) !== JSON.stringify(mergedPhysicalState);
      const runtimeOverrideNeedsUpgrade =
        String(existing.runtimeOverrideToken || "") !== getRuntimeOverrideToken(runtimeOverride) ||
        Boolean(existing.manualOverride) !== (Object.keys(normalizeRuntimeOverride(runtimeOverride?.updates)).length > 0);
      const affectiveStateNeedsUpgrade =
        String(existing.affectiveStateToken || "") !== String(affectiveState?.token || "default");
      if (physicalStateNeedsUpgrade || runtimeOverrideNeedsUpgrade || affectiveStateNeedsUpgrade) {
        const refreshed = buildRuntimeState({
          roleName,
          scope,
          schedule,
          current,
          currentIndex,
          minute,
          previous: existing,
          physicalStateEvents,
          at,
          persistentPhysicalState,
          runtimeOverride,
          affectiveState,
        });
        return persistRuntimeState(refreshed, existing);
      }
      return existing;
    }

    const existingIsNotLaterThanCurrent = existing?.dateKey !== schedule.dateKey ||
      !Number.isFinite(Number(existing?.entryStartMinute)) ||
      Number(existing.entryStartMinute) <= Number(current.startMinute);
    const nextState = buildRuntimeState({
      roleName,
      scope,
      schedule,
      current,
      currentIndex,
      minute,
      previous: existing?.dateKey === schedule.dateKey && existingIsNotLaterThanCurrent
        ? existing
        : null,
      physicalStateEvents,
      at,
      persistentPhysicalState,
      runtimeOverride,
      affectiveState,
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

  async function ensureDailySchedule(
    roleOrName,
    at = now(),
    { force = false, seed = null } = {},
  ) {
    const role = typeof roleOrName === "string" ? await resolveRole(roleOrName) : roleOrName;
    const roleName = role?.name || (typeof roleOrName === "string" ? roleOrName : "");
    const nameKey = normalizeRoleNameKey(roleName);
    if (!nameKey) {
      return null;
    }

    const dateKey = getDateKey(at, resolvedTimezone);
    const defaultDailySeed = getDailyScheduleSeed(roleName, dateKey);
    const hasRequestedSeed = seed !== null && seed !== undefined && String(seed).trim() !== "" &&
      Number.isFinite(Number(seed));
    const dailySeed = hasRequestedSeed
      ? normalizeSeed(seed, defaultDailySeed)
      : defaultDailySeed;
    const existing = force ? null : await loadStoredSchedule(roleName, dateKey);
    if (existing) {
      return existing;
    }

    const lockKey = `${nameKey}:${dateKey}`;
    if (generationLocks.has(lockKey)) {
      if (force) {
        await generationLocks.get(lockKey);
        return ensureDailySchedule(role, at, { force: true, seed: dailySeed });
      }
      return generationLocks.get(lockKey);
    }

    const promise = (async () => {
      const current = force ? null : await loadStoredSchedule(roleName, dateKey);
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
            seed: dailySeed,
            seedKey: getDailyScheduleSeedKey(roleName, dateKey),
            random: createSeededRandom(dailySeed),
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
        entries = buildSeededSchedule({ role, dateKey, seed: dailySeed });
        source = "seeded";
      }

      const timestamp = new Date().toISOString();
      const record = {
        type: SCHEDULE_RECORD_TYPE,
        scheduleVersion: SCHEDULE_VERSION,
        roleName,
        roleNameKey: nameKey,
        dateKey,
        timezone: resolvedTimezone,
        dailySeed,
        dailySeedVersion: DAILY_SEED_VERSION,
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

  async function updatePhysicalState(
    roleName,
    scope,
    updates,
    { at = now(), reason = "用户明确更新" } = {},
  ) {
    if (!hasRuntimeScope(scope)) {
      return { ok: false, error: "缺少当前用户和会话范围，无法更新角色实体状态。" };
    }
    const state = await getState(roleName, { scope, at });
    if (!state?.schedule?.entries?.length || !state.current) {
      return { ok: false, error: "当前没有可更新的角色日程状态。" };
    }
    const normalizedUpdates = normalizePhysicalState(updates);
    if (Object.keys(normalizedUpdates).length === 0) {
      return { ok: false, error: "没有提供需要更新的实体状态字段。" };
    }

    const currentIndex = state.schedule.entries.findIndex((entry) => entry === state.current);
    if (currentIndex < 0) {
      return { ok: false, error: "无法定位当前日程条目。" };
    }

    const currentEntry = state.schedule.entries[currentIndex];
    const timestamp = getBehaviorTimestamp(at);
    await db.insertAsync({
      type: ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE,
      stateVersion: PHYSICAL_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleName,
      roleNameKey: normalizeRoleNameKey(roleName),
      dateKey: state.dateKey,
      entryKey: getEntryKey(state.dateKey, currentEntry),
      entryStartMinute: currentEntry.startMinute,
      entryEndMinute: currentEntry.endMinute,
      entryKind: currentEntry.kind,
      updates: normalizedUpdates,
      persistentFields: PERSISTENT_PHYSICAL_STATE_FIELDS.filter((field) =>
        hasOwn(normalizedUpdates, field),
      ),
      reason: normalizeText(reason, "用户明确更新", 240),
      createdAt: timestamp,
    });

    const refreshedState = await getState(roleName, { scope, at });
    return {
      ok: true,
      state: refreshedState,
      updates: normalizedUpdates,
      physicalState: refreshedState?.runtimeState?.physicalState || {},
    };
  }

  async function updateAffectiveState(
    roleName,
    scope,
    updates,
    { at = now(), reason = "用户明确触发的情感或身体状态变化" } = {},
  ) {
    if (!hasRuntimeScope(scope)) {
      return { ok: false, error: "缺少当前用户和会话范围，无法更新角色情感或身体状态。" };
    }
    const normalizedUpdates = normalizeAffectiveStateUpdate(updates);
    if (!hasAffectiveStateUpdate(normalizedUpdates)) {
      return { ok: false, error: "没有提供可记录的情感或身体状态变化。" };
    }

    const state = await getState(roleName, { scope, at });
    if (!state?.schedule?.entries?.length || !state.current) {
      return { ok: false, error: "当前没有可更新的角色日程状态。" };
    }
    const timestamp = getBehaviorTimestamp(at);
    const existing = await findAffectiveState(roleName, scope);
    const current = state.affectiveState || materializeAffectiveState(existing, {
      at,
      current: state.current,
      minute: state.minute,
      caffeineOverride: state.caffeineOverride,
    });
    const nextLongTerm = applyEmotionDeltas(
      current.longTerm,
      normalizedUpdates.longTermDelta,
    );
    const hasStoredShortTerm = Boolean(
      existing?.shortTerm && typeof existing.shortTerm === "object" && !Array.isArray(existing.shortTerm),
    );
    const nextShortTerm = Object.keys(normalizedUpdates.shortTermDelta).length > 0
      ? applyEmotionDeltas(current.shortTerm, normalizedUpdates.shortTermDelta)
      : hasStoredShortTerm
        ? cloneEmotionVector(current.shortTerm)
        : cloneEmotionVector(nextLongTerm);
    const nextBody = applyBodyConditionDeltas(
      current.body,
      normalizedUpdates.bodyDelta,
    );
    if (normalizedUpdates.conditionSpecified) {
      nextBody.condition = normalizedUpdates.condition;
    }
    if (normalizedUpdates.symptomsSpecified) {
      nextBody.symptoms = [...normalizedUpdates.symptoms];
    }
    const shortTermUpdated = Object.keys(normalizedUpdates.shortTermDelta).length > 0;
    const bodyUpdated = Object.keys(normalizedUpdates.bodyDelta).length > 0 ||
      normalizedUpdates.conditionSpecified || normalizedUpdates.symptomsSpecified;
    const record = {
      type: ROLE_AFFECTIVE_STATE_RECORD_TYPE,
      affectiveVersion: AFFECTIVE_STATE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleName,
      roleNameKey: normalizeRoleNameKey(roleName),
      longTerm: nextLongTerm,
      shortTerm: nextShortTerm,
      body: nextBody,
      shortTermUpdatedAt: shortTermUpdated
        ? timestamp
        : existing?.shortTermUpdatedAt || existing?.updatedAt || "",
      bodyUpdatedAt: bodyUpdated
        ? timestamp
        : existing?.bodyUpdatedAt || existing?.updatedAt || "",
      reason: normalizeText(reason, "用户明确触发的情感或身体状态变化", 240),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    if (existing?._id) {
      await db.updateAsync({ _id: existing._id }, { $set: record });
    } else {
      await db.insertAsync(record);
    }

    const refreshedState = await getState(roleName, { scope, at });
    return {
      ok: true,
      state: refreshedState,
      updates: normalizedUpdates,
      affectiveState: refreshedState?.affectiveState || null,
      runtimeState: refreshedState?.runtimeState || null,
    };
  }

  async function updateRuntimeState(
    roleName,
    scope,
    updates,
    { at = now(), reason = "用户明确更新当前状态" } = {},
  ) {
    if (!hasRuntimeScope(scope)) {
      return { ok: false, error: "缺少当前用户和会话范围，无法更新角色当前状态。" };
    }
    const normalizedUpdates = normalizeRuntimeOverride(updates);
    if (Object.keys(normalizedUpdates).length === 0) {
      return { ok: false, error: "没有提供可记录的地点、活动或环境状态。" };
    }

    const state = await getState(roleName, { scope, at });
    if (!state?.schedule?.entries?.length || !state.current) {
      return { ok: false, error: "当前没有可更新的角色日程状态。" };
    }
    const timestamp = getBehaviorTimestamp(at);
    const existing = await findRuntimeOverride(roleName, scope, state.dateKey);
    const existingUpdates = normalizeRuntimeOverride(existing?.updates);
    const record = {
      type: ROLE_RUNTIME_OVERRIDE_RECORD_TYPE,
      overrideVersion: RUNTIME_OVERRIDE_VERSION,
      chatId: scope.chatId,
      userId: scope.userId,
      roleName,
      roleNameKey: normalizeRoleNameKey(roleName),
      dateKey: state.dateKey,
      entryKey: getEntryKey(state.dateKey, state.current),
      entryStartMinute: state.current.startMinute,
      updates: { ...existingUpdates, ...normalizedUpdates },
      reason: normalizeText(reason, "用户明确更新当前状态", 240),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    if (existing?._id) {
      await db.updateAsync({ _id: existing._id }, { $set: record });
    } else {
      await db.insertAsync(record);
    }

    const refreshedState = await getState(roleName, { scope, at });
    return {
      ok: true,
      state: refreshedState,
      updates: record.updates,
      runtimeState: refreshedState?.runtimeState || null,
    };
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
    const physicalStateEvents = await findPhysicalStateEvents(
      roleName,
      scope,
      schedule.dateKey,
    );
    const persistentPhysicalState = await findPersistentPhysicalState(
      roleName,
      scope,
      schedule.dateKey,
    );
    const runtimeOverride = await findRuntimeOverride(
      roleName,
      scope,
      schedule.dateKey,
    );
    const affectiveState = await getAffectiveState(roleName, scope, {
      at,
      current,
      minute,
      caffeineOverride,
    });
    const runtimeState = await syncRuntimeState({
      roleName,
      scope,
      schedule,
      current,
      currentIndex,
      minute,
      physicalStateEvents,
      at,
      persistentPhysicalState,
      runtimeOverride,
      affectiveState,
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
      physicalStateEvents,
      persistentPhysicalState,
      runtimeOverride,
      affectiveState,
      runtimeState,
      isSleeping: Boolean(current && isSleepEntry(current) && !caffeineOverride && !runtimeState?.manualOverride),
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
        const previousIsNotLaterThanCurrent = !Number.isFinite(Number(persistedState.entryStartMinute)) ||
          Number(persistedState.entryStartMinute) <= Number(state.current.startMinute);
        const previous = previousEntryStillExists && previousIsNotLaterThanCurrent
          ? persistedState
          : null;
        let repairedState = buildRuntimeState({
          roleName: state.schedule.roleName || persistedState.roleName,
          scope,
          schedule: state.schedule,
          current: state.current,
          currentIndex,
          minute: state.minute,
          previous,
          physicalStateEvents: state.physicalStateEvents,
          at,
          persistentPhysicalState: state.persistentPhysicalState,
          runtimeOverride: state.runtimeOverride,
          affectiveState: state.affectiveState,
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
            physicalStateEvents: state.physicalStateEvents,
            at,
            persistentPhysicalState: state.persistentPhysicalState,
            runtimeOverride: state.runtimeOverride,
            affectiveState: state.affectiveState,
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
    const affectiveState = state.affectiveState || materializeAffectiveState(null, {
      current: entry,
      minute: state.minute,
      caffeineOverride: state.caffeineOverride,
    });
    const runtimeStatus = runtime.status || (
      entry.kind === "commute"
        ? "in_transit"
        : entry.kind === "prepare"
          ? "preparing"
          : "stable"
    );
    const runtimeOverridesSchedule = runtimeStatus === "blocked_transition" || runtime.manualOverride;
    const currentActivity = runtimeOverridesSchedule
      ? runtime.activity || entry.activity
      : entry.activity;
    const currentEnvironment = runtimeOverridesSchedule
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
            : runtime.manualOverride
              ? currentLocation
                ? `当前地点：${currentLocation}（已按用户明确说明更新）。`
                : "当前状态已按用户明确说明更新。"
              : currentLocation
                ? `当前地点：${currentLocation}。`
                : "当前地点未单独记录，以环境描述为准。";
    const physicalState = normalizePhysicalState(runtime);
    const formatPhysicalList = (field, emptyLabel, unknownLabel) => {
      if (!hasOwn(physicalState, field)) {
        return unknownLabel;
      }
      return physicalState[field].length > 0
        ? physicalState[field].join("、")
        : emptyLabel;
    };
    const formatPhysicalText = (field, emptyLabel, unknownLabel) => {
      if (!hasOwn(physicalState, field)) {
        return unknownLabel;
      }
      return physicalState[field] || emptyLabel;
    };
    const limbStateText = !hasOwn(physicalState, "limbStates")
      ? "未记录"
      : Object.entries(physicalState.limbStates)
        .map(([limb, status]) => `${limb}=${status}`)
        .join("；") || "无特别记录";
    const formatPhysicalChangeValue = (value) => Array.isArray(value)
      ? value.join("、") || "无"
      : value && typeof value === "object"
        ? Object.entries(value).map(([key, item]) => `${key}=${item || "已清除"}`).join("；") || "无"
        : value;
    const physicalChanges = runtime.physicalStateChanges && typeof runtime.physicalStateChanges === "object"
      ? Object.entries(runtime.physicalStateChanges)
        .map(([field, change]) => `${field}：${formatPhysicalChangeValue(change.from) ?? "未记录"}→${formatPhysicalChangeValue(change.to) ?? "已清除"}`)
        .join("；")
      : "";
    const continuityLines = [
      `状态机阶段：${runtime.phase || getEntryPhase(entry)}；状态：${runtimeStatus}。`,
      `当前穿着：${formatPhysicalText("outfit", "无特别穿着记录", "未记录；保持最近一次已知穿着连续")}。`,
      `当前随身物品：${formatPhysicalList("carriedItems", "明确没有随身物品", "未记录；不要凭空增加关键物品")}。`,
      `当前手持物品：${formatPhysicalList("heldItems", "双手空着", "未记录；不要凭空改变手持物品")}。`,
      `身体内部装置：${formatPhysicalList("internalDevices", "明确没有记录的内部装置", "未记录；不要擅自添加或移除")}。`,
      `身体状态：${formatPhysicalText("bodyState", "无特别身体状态记录", "未记录；不要擅自诊断或改变")}。`,
      `四肢状态：${limbStateText}。`,
      physicalChanges ? `本次状态变更：${physicalChanges}。` : "",
      !configuredVideoLocationGuard
        ? "当前日程状态存在时只作连续性参考；不要因为地点状态同步异常拒绝用户明确的视频请求，普通日常回复仍应如实描述当前地点。"
        : runtimeStatus === "blocked_transition"
        ? "不要声称已经到达目标地点，也不要生成目标地点的自拍；先如实说明还在原地点或移动尚未完成。"
        : "在本轮回复、图片和视频中保持当前地点、环境、活动、穿着、随身物品、手持物品、内部装置、身体状态和四肢状态连续；只有日程或用户明确状态更新记录变化时才切换。",
      "不要向用户解释状态机或后台记录。",
    ].filter(Boolean);
    const behaviorContext = runtime.manualOverride ? "" : buildBehaviorContext(state);
    return [
      "角色日程运行时状态（这是当前角色的内部现实设定）：",
      `日期：${state.dateKey}；时区：${state.timezone}；当前分钟：${formatMinute(state.minute)}。`,
      runtime.manualOverride
        ? `当前日程原计划：${formatMinute(entry.startMinute)}-${formatMinute(entry.endMinute)}，${entry.activity}；当前实际状态以用户明确更新为准：${currentActivity}。`
        : `当前计划：${formatMinute(entry.startMinute)}-${formatMinute(entry.endMinute)}，${currentActivity}。`,
      `当前环境：${currentEnvironment}；情绪/精力：${runtime.mood || entry.mood}。`,
      `短期六维情绪：${formatEmotionVector(affectiveState.shortTerm)}。`,
      `长期六维情感：${formatEmotionVector(affectiveState.longTerm)}。`,
      `结构化身体状态：${formatBodyCondition(affectiveState.body)}。`,
      "六维数值和身体数值只用于维持角色反应、关系与体力的连续性；自然地体现它们，不要向用户说出分数、后台记录或状态机，也不能据此作医学诊断。",
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

  async function resetRoleStateAndSchedule(
    roleOrName,
    { scope = null, at = now() } = {},
  ) {
    const role = typeof roleOrName === "string" ? await resolveRole(roleOrName) : roleOrName;
    if (!role?.name) {
      return { ok: false, error: "当前角色不存在，无法从零重置。" };
    }

    const roleName = role.name;
    const roleNameKey = normalizeRoleNameKey(roleName);
    const dateKey = getDateKey(at, resolvedTimezone);
    const previousSchedule = await loadStoredSchedule(roleName, dateKey);
    const defaultDailySeed = getDailyScheduleSeed(roleName, dateKey);
    const excludedSeeds = new Set([
      defaultDailySeed,
      normalizeSeed(previousSchedule?.dailySeed, defaultDailySeed),
    ]);
    const resetRoll = Math.min(0.999999999999, Math.max(0, Number(random()) || 0));
    let dailySeed = Math.floor(resetRoll * 4_294_967_296) >>> 0;
    for (let attempt = 0; attempt < 4 && excludedSeeds.has(dailySeed); attempt += 1) {
      dailySeed = (dailySeed + 0x9e3779b9 + attempt) >>> 0;
    }

    const removeRoleRecords = async (type, { onlyDateKey = "" } = {}) => {
      const records = await db.findAsync({ type });
      const ids = records
        .filter((record) => normalizeRoleNameKey(record?.roleNameKey || record?.roleName) === roleNameKey)
        .filter((record) => !onlyDateKey || record?.dateKey === onlyDateKey)
        .map((record) => record._id)
        .filter(Boolean);
      if (ids.length === 0) {
        return 0;
      }
      return db.removeAsync({ _id: { $in: ids } }, { multi: true });
    };

    // A schedule is global to a role, so a full reset must remove every
    // scope's state records tied to it. This prevents a different chat from
    // carrying an old transition or physical override into the fresh plan.
    const cleared = {
      runtimeStates: await removeRoleRecords(ROLE_STATE_RECORD_TYPE),
      runtimeOverrides: await removeRoleRecords(ROLE_RUNTIME_OVERRIDE_RECORD_TYPE),
      physicalStateEvents: await removeRoleRecords(ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE),
      affectiveStates: await removeRoleRecords(ROLE_AFFECTIVE_STATE_RECORD_TYPE),
      caffeineOverrides: await removeRoleRecords(CAFFEINE_RECORD_TYPE),
      proactiveRecords: await removeRoleRecords(PROACTIVE_RECORD_TYPE),
      behaviorOutcomes: await removeRoleRecords(BEHAVIOR_RECORD_TYPE),
      replacedScheduleRecords: await removeRoleRecords(SCHEDULE_RECORD_TYPE, { onlyDateKey: dateKey }),
    };

    const schedule = await ensureDailySchedule(role, at, { force: true, seed: dailySeed });
    if (!schedule) {
      return { ok: false, error: "无法生成重置后的角色日程。", cleared };
    }
    const state = hasRuntimeScope(scope)
      ? await getState(roleName, { scope, at })
      : null;
    return {
      ok: true,
      roleName,
      dateKey,
      dailySeed: schedule.dailySeed,
      schedule,
      state,
      cleared,
    };
  }

  async function maybeSendProactive(session, at = now()) {
    if (typeof sendProactive !== "function" || !session?.roleName || session.chatId === undefined || session.userId === undefined) {
      return { sent: false, reason: "not-configured" };
    }
    const scope = { chatId: session.chatId, userId: session.userId };
    const preference = await getProactivePreference(session.roleName, scope);
    const policy = getProactivePolicy(preference);
    if (!policy.enabled) {
      return {
        sent: false,
        reason: policy.disabledReason || "disabled-by-user",
        preference,
        policy,
      };
    }
    const state = await getState(session.roleName, {
      scope,
      at,
    });
    if (
      !state?.current ||
      state.isSleeping ||
      state.runtimeState?.manualOverride ||
      state.runtimeState?.status === "blocked_transition" ||
      !isIdleEntry(state.current)
    ) {
      return {
        sent: false,
        reason: state.runtimeState?.manualOverride ? "manual-runtime-override" : "not-idle",
        state,
        preference,
        policy,
      };
    }

    const referenceTimestamp = at instanceof Date ? at.getTime() : Date.parse(at) || Date.now();
    const intervalBucket = policy.allowMultiplePerEntry
      ? Math.floor(referenceTimestamp / Math.max(1, policy.cooldownMs || 1))
      : "entry";
    const proactiveKey = [
      session.chatId,
      session.userId,
      state.schedule.roleNameKey,
      state.dateKey,
      state.current.startMinute,
      intervalBucket,
    ].join(":");
    if (proactiveLocks.has(proactiveKey)) {
      return { sent: false, reason: "in-flight", state, preference, policy };
    }

    const promise = (async () => {
      const scheduleQuery = {
        type: PROACTIVE_RECORD_TYPE,
        chatId: session.chatId,
        userId: session.userId,
        roleNameKey: state.schedule.roleNameKey,
        dateKey: state.dateKey,
      };
      const previousRecords = await db.findAsync(scheduleQuery);
      const existing = policy.allowMultiplePerEntry
        ? previousRecords.find((record) => record.proactiveKey === proactiveKey)
        : previousRecords.find((record) =>
          Number(record.entryStartMinute) === Number(state.current.startMinute),
        );
      // The default and low modes keep the original one-message-per-entry
      // behavior. High and custom modes add a time bucket to the record key,
      // so a long idle entry can produce another message only after the user
      // selected interval has elapsed.
      if (existing && (
        existing.sentAt ||
        existing.attemptedAt ||
        ["sending", "sent", "failed"].includes(existing.status)
      )) {
        return {
          sent: false,
          reason: policy.allowMultiplePerEntry ? "interval-already-handled" : "entry-already-handled",
          state,
          preference,
          policy,
        };
      }

      // Use the claim time too. In high/custom mode two timer ticks may land
      // on opposite interval buckets while the first Telegram send is still
      // in flight; treating that claim as recent prevents a duplicate send.
      const latestSentAt = previousRecords
        .map((record) => Date.parse(record.sentAt || record.attemptedAt || record.completedAt || ""))
        .filter(Number.isFinite)
        .sort((left, right) => right - left)[0] || 0;
      if (latestSentAt && referenceTimestamp - latestSentAt < policy.cooldownMs) {
        return { sent: false, reason: "cooldown", state, preference, policy };
      }
      const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
      if (roll >= policy.probability) {
        return { sent: false, reason: "random-skip", state, preference, policy };
      }

      const roles = await getRoles();
      const role = roles.find((candidate) =>
        normalizeRoleNameKey(candidate.name) === state.schedule.roleNameKey,
      );
      if (!role) {
        return { sent: false, reason: "role-not-found", state, preference, policy };
      }

      const attemptedAt = (at instanceof Date ? at : new Date(at)).toISOString();
      const record = {
        _id: `role-proactive:${encodeURIComponent(proactiveKey)}`,
        ...scheduleQuery,
        roleName: role.name,
        proactiveKey,
        frequencyMode: preference.mode,
        ...(policy.intervalMinutes ? { intervalMinutes: policy.intervalMinutes } : {}),
        entryStartMinute: state.current.startMinute,
        entryEndMinute: state.current.endMinute,
        kind: state.current.kind,
        activity: state.current.activity,
        status: "sending",
        attemptedAt,
        ...(existing?.createdAt ? { createdAt: existing.createdAt } : { createdAt: attemptedAt }),
      };
      let claimed;
      try {
        if (existing?._id) {
          const recordFields = { ...record };
          delete recordFields._id;
          await db.updateAsync(
            { _id: existing._id },
            { $set: recordFields },
          );
          claimed = { ...existing, ...recordFields, _id: existing._id };
        } else {
          claimed = await db.insertAsync(record);
        }
      } catch (error) {
        const alreadyClaimed = await db.findOneAsync({ _id: record._id });
        if (alreadyClaimed) {
          return {
            sent: false,
            reason: policy.allowMultiplePerEntry ? "interval-already-handled" : "entry-already-handled",
            state,
            preference,
            policy,
          };
        }
        throw error;
      }

      try {
        const result = await sendProactive({
          role,
          session,
          state,
        });
        const completedAt = new Date().toISOString();
        await db.updateAsync(
          { _id: claimed._id },
          { $set: { status: "sent", sentAt: attemptedAt, completedAt } },
        );
        return { sent: true, result, state, preference, policy };
      } catch (error) {
        const failedAt = new Date().toISOString();
        await db.updateAsync(
          { _id: claimed._id },
          { $set: { status: "failed", completedAt: failedAt } },
        ).catch(() => undefined);
        logger.warn?.("发送角色主动日程消息失败:", error.message || error);
        return { sent: false, reason: "send-failed", error, state, preference, policy };
      }
    })();

    proactiveLocks.set(proactiveKey, promise);
    try {
      return await promise;
    } finally {
      proactiveLocks.delete(proactiveKey);
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
        const seenSessionKeys = new Set();
        for (const session of sessions) {
          const sessionKey = [
            session?.chatId,
            session?.userId,
          ].join(":");
          if (seenSessionKeys.has(sessionKey)) {
            continue;
          }
          seenSessionKeys.add(sessionKey);
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
    getAffectiveState: async (roleName, scope = null, at = now()) => {
      const state = await getState(roleName, { scope, at });
      return state?.affectiveState || null;
    },
    getProactivePolicy,
    getProactivePreference,
    getRuntimeState: async (roleName, scope = null, at = now()) =>
      (await getState(roleName, { scope, at }))?.runtimeState || null,
    getRuntimeContext,
    getTodaySchedule,
    resetRoleStateAndSchedule,
    updateAffectiveState,
    updatePhysicalState,
    updateRuntimeState,
    setProactivePreference,
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
  AFFECTIVE_STATE_VERSION,
  BEHAVIOR_RECORD_TYPE,
  CAFFEINE_RECORD_TYPE,
  DAILY_SEED_VERSION,
  DEFAULT_TIMEZONE,
  EMOTION_DIMENSIONS,
  IDLE_KINDS,
  PHYSICAL_STATE_VERSION,
  PROACTIVE_PREFERENCE_VERSION,
  ROLE_PHYSICAL_STATE_EVENT_RECORD_TYPE,
  ROLE_AFFECTIVE_STATE_RECORD_TYPE,
  ROLE_PROACTIVE_PREFERENCE_RECORD_TYPE,
  ROLE_RUNTIME_OVERRIDE_RECORD_TYPE,
  ROLE_STATE_RECORD_TYPE,
  ROLE_STATE_VERSION,
  RUNTIME_OVERRIDE_VERSION,
  SCHEDULE_RECORD_TYPE,
  SCHEDULE_VERSION,
  SLEEP_KINDS,
  buildSeededSchedule,
  buildFallbackSchedule,
  createSeededRandom,
  createRoleScheduleManager,
  formatMinute,
  getDateKey,
  getDailyScheduleSeed,
  getDailyScheduleSeedKey,
  getMinuteOfDay,
  isBehaviorEntry,
  isIdleEntry,
  isSleepEntry,
  buildPhysicalStateChanges,
  formatBodyCondition,
  formatEmotionVector,
  mergePhysicalState,
  materializeAffectiveState,
  normalizeAffectiveStateUpdate,
  normalizeProactivePreference,
  normalizePhysicalState,
  normalizeRuntimeOverride,
  normalizeScheduleEntries,
  parseSchedulePayload,
};
