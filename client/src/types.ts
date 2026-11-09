export interface Role {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string | null;
  currentActivity?: string;
  location?: string;
  isSleeping?: boolean;
}

export interface RuntimeState {
  location?: string;
  activity?: string;
  environment?: string;
  outfit?: string;
  carriedItems?: string[];
  mood?: string;
  phase?: string;
  startMinute?: number;
  endMinute?: number;
  updatedAt?: string;
}

export interface EmotionVector {
  valence: number;
  arousal: number;
  closeness: number;
  trust: number;
  security: number;
  stress: number;
}

export interface BodyCondition {
  health: number;
  illness: number;
  fatigue: number;
  sleepiness: number;
  pain: number;
  condition?: string;
  symptoms?: string[];
}

export interface AffectiveState {
  longTerm: EmotionVector;
  shortTerm: EmotionVector;
  body: BodyCondition;
  reason?: string;
  updatedAt?: string;
}

export interface ScheduleEntry {
  start: string;
  end: string;
  startMinute: number;
  endMinute: number;
  kind: string;
  activity: string;
  location: string;
  destination?: string;
  environment?: string;
  mood?: string;
  proactive?: boolean;
}

export interface ScheduleData {
  roleName: string;
  dateKey: string;
  timezone: string;
  source: string;
  entries: ScheduleEntry[];
  formatted: string;
}

export interface ClientMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  media?: Array<{ type: string; url?: string; prompt?: string }>;
  createdAt?: string;
}

export interface ChatSession {
  id: string;
  roleName: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  userId: number;
  chatId: number;
  username?: string;
  firstName?: string;
  displayName: string;
  token?: string;
  isGuest?: boolean;
}
