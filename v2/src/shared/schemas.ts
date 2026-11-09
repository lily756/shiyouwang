/**
 * Character OS v2 — 公共解析器与容错 Schema 校验工具
 * 专门解决大模型输出 Markdown 代码块、JSON 尾随逗号、时间格式不统一等问题。
 */

import type {
  AffectReaction,
  ScheduleBlock,
  ScheduleCategory,
} from './types.ts';

const VALID_CATEGORIES = new Set<ScheduleCategory>([
  'sleep',
  'meal',
  'work',
  'study',
  'creative',
  'leisure',
  'exercise',
  'social',
  'commute',
  'routine',
]);

/**
 * 安全解析大模型返回的 JSON 字符串，支持剥离 ```json 代码块与截取最外层 {} / []
 */
export function safeParseJson<T = unknown>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // ignore
      }
    }
    const firstBracket = stripped.indexOf('[');
    const lastBracket = stripped.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(stripped.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // ignore
      }
    }
    return null;
  }
}

/**
 * 将 "HH:MM" 或数字分钟数统一转换为 0 ~ 1440 的整数分钟
 */
export function parseTimeToMinute(
  input: unknown,
  allowEndOfDay = false,
): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const max = allowEndOfDay ? 1440 : 1439;
    return Math.max(0, Math.min(max, Math.round(input)));
  }
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    const max = allowEndOfDay ? 1440 : 1439;
    return Math.max(0, Math.min(max, num));
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0 && allowEndOfDay) {
    return 1440;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * 将 0 ~ 1440 分钟数格式化为 "HH:MM"
 */
export function formatMinuteToTime(minute: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minute)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function normalizeScheduleCategory(raw: unknown): ScheduleCategory {
  const val = String(raw || '').trim().toLowerCase() as ScheduleCategory;
  if (VALID_CATEGORIES.has(val)) {
    return val;
  }
  return 'routine';
}

/**
 * 解析回复文本开头的 <affect ...>内心OS</affect> 标签，返回剥离后的干净正文与情绪突变对象
 */
export function extractAffectTagFromReply(rawReply: string): {
  cleanContent: string;
  affect: AffectReaction | null;
} {
  const text = String(rawReply || '');
  const affectRegex = /^[\s]*<affect\b([^>]*)>([\s\S]*?)<\/affect>[\s]*/i;
  const match = affectRegex.exec(text);
  if (!match) {
    return { cleanContent: text.trim(), affect: null };
  }

  const attrString = match[1] || '';
  const innerMonologue = (match[2] || '').trim();
  const cleanContent = text.slice(match[0].length).trim();

  const getAttr = (name: string): string => {
    const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
    const m = re.exec(attrString);
    return m ? m[1].trim() : '';
  };

  const parseDelta = (val: string): number => {
    const num = Number(val.replace(/^\+/, ''));
    return Number.isFinite(num) ? Math.max(-100, Math.min(100, num)) : 0;
  };

  const affect: AffectReaction = {
    deltaMood: parseDelta(getAttr('delta_mood') || '0'),
    deltaBond: parseDelta(getAttr('delta_bond') || '0'),
    deltaTrust: parseDelta(getAttr('delta_trust') || '0'),
    moodTag: getAttr('mood') || '平静',
    innerMonologue: innerMonologue || '顺其自然地回应',
    ...(getAttr('voice_tone') ? { voiceTone: getAttr('voice_tone') } : {}),
    ...(getAttr('sticker') ? { stickerEmotion: getAttr('sticker') } : {}),
  };

  return { cleanContent, affect };
}

export function clampNumber(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export type RawScheduleBlockCandidate = Partial<ScheduleBlock> & {
  start?: string | number;
  end?: string | number;
};
