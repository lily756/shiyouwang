/**
 * Character OS v2 — React Native Web App
 * 兼容 Node.js 原生运行环境（SSR 与组件树断言）与现代浏览器运行时
 */

import type {
  Character,
  CharacterRelationship,
  ChatMessage,
  DailySchedule,
  InventoryItem,
  MediaTaskRecord,
  MemoryImprint,
  User,
} from '../shared/types.ts';
import {
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  appStyles as styles,
  escapeHtml,
  formatMinute,
  renderVNodeToHtml,
  type RNVNode,
} from './rn-primitives.ts';
export { getBrowserClientScript } from './browser-runtime.ts';

export interface ClientViewState {
  currentUser: User | null;
  authMode?: 'login' | 'register';
  authError?: string;
  bindCommand?: string;
  characters: Character[];
  activeCharacterId: string | null;
  relationship: CharacterRelationship | null;
  schedule: DailySchedule | null;
  inventory: InventoryItem[];
  imprints: MemoryImprint[];
  messages: ChatMessage[];
  mediaTasks: MediaTaskRecord[];
  drawerOpen: boolean;
  studioModalOpen: boolean;
}

function renderAuthModal(state: ClientViewState): RNVNode | null {
  if (state.currentUser) return null;
  const isReg = state.authMode === 'register';
  return View(
    { style: styles.modalOverlay },
    View(
      { style: styles.modalCard },
      Text({ style: styles.modalTitle }, 'Character OS v2 · 账号登录 / 注册'),
      View(
        { style: styles.invRow },
        TouchableOpacity(
          { 'data-action': 'switch-auth-login', style: !isReg ? styles.btnPrimary : styles.btnSecondary },
          Text({ style: styles.btnText }, '登录账号'),
        ),
        TouchableOpacity(
          { 'data-action': 'switch-auth-register', style: isReg ? styles.btnPrimary : styles.btnSecondary },
          Text({ style: styles.btnText }, '注册新账号'),
        ),
      ),
      state.authError ? Text({ style: styles.affectText }, `⚠️ ${state.authError}`) : null,
      TextInput({ id: 'auth-username', placeholder: '用户名 (如: akira)', style: styles.modalInput }),
      isReg
        ? TextInput({ id: 'auth-displayname', placeholder: '角色对你的称呼 (默认: 主人)', style: styles.modalInput })
        : null,
      TextInput({ id: 'auth-password', placeholder: '密码 (至少4位)', type: 'password', style: styles.modalInput }),
      TouchableOpacity(
        { 'data-action': isReg ? 'submit-register' : 'submit-login', style: styles.btnPrimary },
        Text({ style: styles.btnText }, isReg ? '注册并进入世界' : '立即登录'),
      ),
      TouchableOpacity(
        { 'data-action': 'guest-login', style: styles.btnSecondary },
        Text({ style: styles.btnText }, '⚡ 免密游客体验 (一键进入)'),
      ),
    ),
  );
}

function renderSidebar(state: ClientViewState): RNVNode {
  return View(
    { style: styles.sidebar },
    View(
      { style: styles.headerBox },
      Text({ style: styles.headerTitle }, 'Character OS v2'),
      state.currentUser
        ? View(
            { style: styles.blockItem },
            Text(
              { style: styles.blockTime },
              `👤 ${state.currentUser.displayName} (@${state.currentUser.username})`,
            ),
            state.currentUser.telegramUserId
              ? Text({ style: styles.blockDesc }, `✅ 已绑定 TG: ${state.currentUser.telegramUserId}`)
              : null,
            state.bindCommand
              ? Text({ style: styles.badgeText }, `📌 向 TG 发送: ${state.bindCommand}`)
              : null,
            View(
              { style: styles.invRow },
              TouchableOpacity(
                { 'data-action': 'bind-telegram', style: styles.btnSecondary },
                Text({ style: styles.btnText }, '🔗 TG绑定码'),
              ),
              TouchableOpacity(
                { 'data-action': 'logout', style: styles.btnSecondary },
                Text({ style: styles.btnText }, '退出'),
              ),
            ),
          )
        : null,
      TouchableOpacity(
        { 'data-action': 'open-studio', style: styles.btnPrimary },
        Text({ style: styles.btnText }, '+ 新建角色 (角色工坊)'),
      ),
      TouchableOpacity(
        { 'data-action': 'seed-demo', style: styles.btnSecondary },
        Text({ style: styles.btnText }, '⚡ 一键加载示范角色 (双炽)'),
      ),
    ),
    ScrollView(
      { style: styles.charList },
      ...state.characters.map((c) =>
        TouchableOpacity(
          {
            'data-action': 'select-character',
            'data-id': c.id,
            style: c.id === state.activeCharacterId ? styles.charItemActive : styles.charItem,
          },
          Text({ style: styles.charName }, c.name),
          Text({ style: styles.charDesc }, c.description || c.corePersona || ''),
        ),
      ),
    ),
  );
}

function renderChatWindow(state: ClientViewState): RNVNode {
  const char = state.characters.find((c) => c.id === state.activeCharacterId);
  const rel = state.relationship;
  const activeBlock = state.schedule?.blocks.find((b) => b.status === 'active');
  const act = activeBlock ? activeBlock.activity : rel?.currentActivity || '休息中';
  const sub = `📍 ${rel?.currentLocation || '未知地点'} · ⏱️ ${act} · 💭 ${rel?.currentMoodTag || '平静'} · [${rel?.relationshipStage || 'stranger'}] · 羁绊 ${rel?.bondScore ?? 0} / 1000`;

  return View(
    { style: styles.chatWindow },
    View(
      { style: styles.chatHeader },
      View(
        null,
        Text({ style: styles.chatHeaderTitle }, char ? char.name : '未选择角色'),
        Text({ style: styles.chatHeaderSubtitle }, sub),
      ),
      TouchableOpacity(
        { 'data-action': 'toggle-drawer', style: styles.btnSecondary },
        Text({ style: styles.btnText }, state.drawerOpen ? '收起抽屉 ❯' : '展开抽屉 ❮'),
      ),
    ),
    ScrollView(
      { style: styles.messageList },
      ...state.messages.map((m) => {
        const isUser = m.role === 'user';
        return View(
          { style: isUser ? styles.msgBubbleUser : styles.msgBubbleAssistant },
          m.affectReaction &&
            View(
              { style: styles.affectMonologue },
              Text(
                { style: styles.affectText },
                `💭 内心OS: ${m.affectReaction.innerMonologue} | 心情 ${m.affectReaction.moodTag} (羁绊+${m.affectReaction.deltaBond})`,
              ),
            ),
          Text({ style: styles.msgContent }, m.content),
          m.stickerId &&
            View({ style: styles.stickerBadge }, Text({ style: styles.badgeText }, `🏷️ 贴纸: ${m.stickerId}`)),
          m.mediaUrls &&
            m.mediaUrls.length > 0 &&
            View(
              null,
              ...m.mediaUrls.map((u) =>
                u.endsWith('.mp4') || u.includes('/video')
                  ? View({ style: styles.mediaCard }, Text({ style: styles.mediaText }, `🎬 视频: ${u}`))
                  : Image({ src: u, style: styles.mediaImage }),
              ),
            ),
        );
      }),
    ),
    View(
      { style: styles.inputBar },
      TextInput({ id: 'chat-input', placeholder: '给TA发消息...', style: styles.chatInput }),
      View(
        { style: styles.inputActions },
        TouchableOpacity({ 'data-action': 'send-message', style: styles.btnPrimary }, Text({ style: styles.btnText }, '发送')),
        TouchableOpacity(
          { 'data-action': 'quick-selfie', style: styles.btnSecondary },
          Text({ style: styles.btnText }, '📸 让TA发自拍'),
        ),
        TouchableOpacity(
          { 'data-action': 'quick-video', style: styles.btnSecondary },
          Text({ style: styles.btnText }, '🎬 让TA发视频'),
        ),
      ),
    ),
  );
}

function renderDrawer(state: ClientViewState): RNVNode | null {
  if (!state.drawerOpen) return null;
  const rel = state.relationship;
  const [eq, held, car, shared] = (
    ['character_equipped', 'character_held', 'character_carried', 'shared_home'] as const
  ).map((sc) => state.inventory.filter((i) => i.scope === sc));

  return ScrollView(
    { style: styles.drawer },
    View(
      { style: styles.drawerSection },
      Text({ style: styles.sectionTitle }, '三层情感与深刻印记'),
      Text(
        { style: styles.sectionText },
        `羁绊 (Bond): ${rel?.bondScore ?? 0} / 1000 | 信任: ${rel?.trustScore ?? 0} / 100 | 心境: ${rel?.moodValence ?? 0}`,
      ),
      Text({ style: styles.sectionText }, `内心独白: "${rel?.innerMonologue || '（暂无独白）'}"`),
      Text({ style: styles.sectionText }, `已解锁阶段: ${(rel?.unlockedStages || ['stranger']).join(', ')}`),
      Text(
        { style: styles.sectionText },
        `深刻印记 (${state.imprints.length}): ${state.imprints.map((i) => `[${i.category}] ${i.content}(w:${i.emotionalWeight})`).join('; ') || '暂无'}`,
      ),
    ),
    View(
      { style: styles.drawerSection },
      Text({ style: styles.sectionTitle }, '角色穿戴与随身物品'),
      Text({ style: styles.sectionText }, `👔 穿戴: ${rel?.outfitDesc || eq.map((i) => i.name).join(', ') || '常规便服'}`),
      Text({ style: styles.sectionText }, `✋ 手持: ${held.map((i) => `${i.name} x${i.quantity}`).join(', ') || '两手空空'}`),
      Text({ style: styles.sectionText }, `🎒 随身: ${car.map((i) => `${i.name} x${i.quantity}`).join(', ') || '无随身物品'}`),
    ),
    View(
      { style: styles.drawerSection },
      Text({ style: styles.sectionTitle }, '共享空间 / 家里冰箱库存'),
      Text({ style: styles.sectionText }, shared.map((i) => `🧊 ${i.name} x ${i.quantity} ${i.unit}`).join(', ') || '冰箱空空如也'),
      View(
        { style: styles.invRow },
        TextInput({ id: 'inv-name', placeholder: '物品 (如: 牛奶)', style: styles.inputSmall }),
        TextInput({ id: 'inv-qty', placeholder: '数量 (如: 2)', style: styles.inputSmall }),
        TextInput({ id: 'inv-unit', placeholder: '单位 (如: 瓶)', style: styles.inputSmall }),
        TouchableOpacity(
          { 'data-action': 'add-inventory', style: styles.btnPrimary },
          Text({ style: styles.btnText }, '放入冰箱/共享空间'),
        ),
      ),
    ),
    View(
      { style: styles.drawerSection },
      Text({ style: styles.sectionTitle }, '今日弹性 Schedule 时间轴 (00:00 - 24:00)'),
      ...(state.schedule?.blocks || []).map((b) =>
        View(
          { style: styles.blockItem },
          Text({ style: styles.blockTime }, `${formatMinute(b.startMinute)} - ${formatMinute(b.endMinute)} [${b.status}]`),
          Text({ style: styles.blockDesc }, `${b.activity} @ ${b.location}`),
        ),
      ),
    ),
  );
}

function renderStudioModal(state: ClientViewState): RNVNode | null {
  if (!state.studioModalOpen) return null;
  const fields = [
    ['char-name', '角色姓名 (如: 御狐神双炽)'],
    ['char-desc', '一句话简介 (如: 忠诚温雅、九尾银狐转世)'],
    ['char-persona', 'L0 核心灵魂设定 (身份、性格特质、忠诚羁绊)'],
    ['char-speech', '说话语气与口癖范例 (如: "双炽随时听候您的差遣...")'],
    ['char-home', '家/默认常驻地点 (如: 妖馆4号室)'],
    ['char-outfit', '默认穿着 (如: 黑色西服三件套、白衬衫)'],
    ['char-carried', '随身常备物品 (逗号分隔，如: 怀表, 妖馆门卡)'],
  ];
  return View(
    { style: styles.modalOverlay },
    ScrollView(
      { style: styles.modalCard },
      View(
        { style: styles.modalHeader },
        Text({ style: styles.modalTitle }, '角色工坊 (Character Studio)'),
        TouchableOpacity({ 'data-action': 'close-studio' }, Text({ style: styles.headerTitle }, '✕')),
      ),
      ...fields.map(([id, ph]) => TextInput({ id, placeholder: ph, style: styles.modalInput })),
      TouchableOpacity(
        { 'data-action': 'generate-avatar', style: styles.btnSecondary },
        Text({ style: styles.btnText }, '🎨 用 VVdance Seedream 生成人设底图'),
      ),
      TextInput({ id: 'char-avatar-url', placeholder: '人设底图 URL (生图后自动填入)', style: styles.modalInput }),
      TouchableOpacity(
        { 'data-action': 'save-character', style: styles.btnPrimary },
        Text({ style: styles.btnText }, '保存并创建角色'),
      ),
    ),
  );
}

export function renderAppTree(state: ClientViewState): RNVNode {
  return View(
    { style: styles.container },
    renderAuthModal(state),
    renderSidebar(state),
    renderChatWindow(state),
    renderDrawer(state),
    renderStudioModal(state),
  );
}

export function renderAppShellHtml(title: string = 'Character OS v2'): string {
  const initialHtml = renderVNodeToHtml(
    renderAppTree({
      currentUser: null,
      authMode: 'login',
      characters: [],
      activeCharacterId: null,
      relationship: null,
      schedule: null,
      inventory: [],
      imprints: [],
      messages: [],
      mediaTasks: [],
      drawerOpen: true,
      studioModalOpen: false,
    }),
  );
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box;margin:0;padding:0;}html,body{width:100%;height:100%;background:#0e1621;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden;}#rn-root{width:100%;height:100%;display:flex;}.rn-view,.rn-scrollview{display:flex;flex-direction:column;box-sizing:border-box;}.rn-text{display:inline;box-sizing:border-box;}.rn-touchable{display:flex;flex-direction:column;box-sizing:border-box;cursor:pointer;border:none;background:transparent;color:inherit;font-family:inherit;}.rn-scrollview{overflow-y:auto;overflow-x:hidden;}.rn-textinput{box-sizing:border-box;outline:none;font-family:inherit;color:inherit;}.rn-image{box-sizing:border-box;object-fit:cover;}::-webkit-scrollbar{width:6px;height:6px;}::-webkit-scrollbar-thumb{background:#242f3d;border-radius:3px;}</style></head><body><div id="rn-root">${initialHtml}</div><script type="module" src="/assets/rn-web-app.js"></script></body></html>`;
}
