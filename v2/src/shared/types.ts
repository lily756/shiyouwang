/**
 * Character OS v2 — 全局核心领域类型与接口契约
 * 所有模块与 Subagent 必须严格遵循此文件中的类型定义。
 */

export type RoleVisibility = 'public' | 'private';

export type RelationshipStage =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'ambiguous'
  | 'lover'
  | 'devoted';

export type InventoryScope =
  | 'character_equipped' // 角色当前穿戴（衣服、鞋袜、饰品）
  | 'character_held'     // 角色当前手持物品（如水杯、手机、雨伞）
  | 'character_carried'  // 角色当前随身背包/口袋物品（如钥匙、钱包、怀表）
  | 'character_private'  // 角色专属私人空间物品（卧室抽屉、书架）
  | 'shared_home';       // 与用户共享的生活空间/冰箱库存（如牛奶、吐司、咖啡豆）

export type ScheduleCategory =
  | 'sleep'
  | 'meal'
  | 'work'
  | 'study'
  | 'creative'
  | 'leisure'
  | 'exercise'
  | 'social'
  | 'commute'
  | 'routine';

export type ScheduleBlockStatus =
  | 'planned'
  | 'active'
  | 'completed'
  | 'rescheduled'
  | 'skipped';

export type MemoryImprintCategory =
  | 'milestone'     // 关系重要里程碑
  | 'promise'       // 双方重要约定
  | 'user_fact'     // 用户核心事实与偏好/禁忌
  | 'emotional_peak'; // 强烈情感波动事件

export type MediaTaskKind = 'image_t2i' | 'image_i2i' | 'video';
export type MediaTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface User {
  id: string;
  username: string;
  displayName: string;
  timezone: string;
  telegramUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LifestyleProfile {
  homeLocation: string;
  defaultEnvironment: string;
  usualPlaces: string[];
  dailyBaseline: string; // 角色专属生活基调描述（非社畜模板）
  defaultOutfit: string;
  defaultCarriedItems: string[];
}

export interface Character {
  id: string;
  creatorUserId: string;
  visibility: RoleVisibility;
  name: string;
  description: string;
  avatarUrl: string;
  referenceImageDataUrl: string; // 用于 VVdance Seedream/Seedance 锁定五官与画风的人设底图
  corePersona: string;           // L0 核心灵魂设定
  speechStyle: string;           // 说话风格与 Few-shot 示例
  lifestyleProfile: LifestyleProfile;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterRelationship {
  id: string;
  userId: string;
  characterId: string;
  // 空间与外观实时快照
  currentLocation: string;
  currentSceneDesc: string;
  currentActivity: string;
  outfitDesc: string;
  // Layer 2: 叙事型心境
  currentMoodTag: string;
  innerMonologue: string;
  relationshipStage: RelationshipStage;
  // Layer 3: 量化养成指标
  bondScore: number;       // 0 ~ 1000
  trustScore: number;      // 0 ~ 100
  moodValence: number;     // -100 ~ +100
  attachmentLevel: number; // 0 ~ 100
  unlockedStages: RelationshipStage[];
  // 主动消息与咖啡因唤醒控制
  proactiveEnabled: boolean;
  caffeineWakeUntil: string | null;
  updatedAt: string;
}

export interface ScheduleBlock {
  id: string;
  startMinute: number; // 0 ~ 1440
  endMinute: number;   // 0 ~ 1440
  category: ScheduleCategory;
  activity: string;
  location: string;
  environment: string;
  mood: string;
  proactiveHint: boolean;
  status: ScheduleBlockStatus;
}

export interface DailySchedule {
  id: string;
  userId: string;
  characterId: string;
  dateKey: string; // YYYY-MM-DD
  timezone: string;
  source: 'model' | 'repaired' | 'fallback';
  blocks: ScheduleBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  userId: string;
  characterId: string;
  scope: InventoryScope;
  locationTag: string; // 如 "冰箱"、"玄关"、"随身口袋"
  name: string;
  quantity: number;
  unit: string;
  description: string;
  updatedAt: string;
}

export interface MemoryImprint {
  id: string;
  userId: string;
  characterId: string;
  category: MemoryImprintCategory;
  content: string;
  emotionalWeight: number; // 1 ~ 10
  createdAt: string;
}

export interface FadingMemory {
  id: string;
  userId: string;
  characterId: string;
  dateKey: string; // YYYY-MM-DD
  summary: string;
  salienceScore: number; // 初始重要度 1 ~ 10
  createdAt: string;
}

export interface CharacterDiary {
  id: string;
  userId: string;
  characterId: string;
  dateKey: string;
  moodSummary: string;
  content: string;
  isUnlocked: boolean;
  createdAt: string;
}

export interface StickerRecord {
  id: string;
  characterId: string | null; // null 表示通用或用户入站贴纸缓存
  fileHash: string;
  imageUrl: string;
  emotionTag: string;         // 如 "害羞", "傲娇", "开心", "困倦", "生气"
  semanticMeaning: string;    // 画面与梗的语义描述
  createdAt: string;
}

export interface AffectReaction {
  deltaMood: number;
  deltaBond: number;
  deltaTrust: number;
  moodTag: string;
  innerMonologue: string;
  voiceTone?: string;
  stickerEmotion?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  characterId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sourceClient: 'app' | 'web' | 'telegram' | 'proactive';
  mediaUrls?: string[];
  stickerId?: string;
  affectReaction?: AffectReaction;
  createdAt: string;
}

export interface MediaTaskRecord {
  id: string;
  userId: string;
  characterId: string;
  kind: MediaTaskKind;
  status: MediaTaskStatus;
  actionIntent: string;
  composedPrompt: string;
  externalTaskId: string | null;
  resultUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ================= 南向 Provider 抽象接口 =================

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMCompletionRequest {
  messages: LLMChatMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCompletionResponse {
  content: string;
  toolCalls: LLMToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}

export interface ImageGenerationRequest {
  prompt: string;
  referenceImages?: string[]; // Data URLs or remote URLs
  aspectRatio?: string;
}

export interface ImageGenerationResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  referenceImages?: string[];
  ratio?: string;
  duration?: number;
  generateAudio?: boolean;
}

export interface VideoTaskSubmissionResult {
  ok: boolean;
  taskId?: string;
  error?: string;
}

export interface VideoTaskPollResult {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  videoUrl?: string;
  error?: string;
}

export interface MediaProvider {
  readonly name: string;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  submitVideoTask(request: VideoGenerationRequest): Promise<VideoTaskSubmissionResult>;
  getVideoTaskStatus(taskId: string): Promise<VideoTaskPollResult>;
}

// ================= 北向 WebSocket 实时同步事件协议 =================

export type SyncEventType =
  | 'message.created'
  | 'relationship.updated'
  | 'schedule.updated'
  | 'inventory.updated'
  | 'media.updated'
  | 'sticker.sent';

export interface SyncEvent<T = unknown> {
  type: SyncEventType;
  userId: string;
  characterId: string;
  timestamp: string;
  payload: T;
}
