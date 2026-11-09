# Character OS v2 (MVP) — 工程工作指南、代码规范、测试与验收标准

> **致所有执行开发任务的 Subagent (Gemini 3.8 Flash Worker)**：
> 在编写任何代码前，你**必须**完整阅读并严格遵守本规范。主架构师（Lead Agent）将依据本规范的验收门禁（Gates）对你的产出进行自动化类型检查、单元测试与 E2E 集成测试验收。任何违反规范的代码将被打回重做。

---

## 一、 MVP 核心范围定义（DeepSeek + VVdance 精简闭环版）

本阶段聚焦构建一个干净、高内聚、多端实时同步的 MVP 核心服务端与客户端底座：
1. **南向文本大模型后端（仅实现 DeepSeek，预留扩展接口）**：
   - 基于 OpenAI 兼容协议对接 DeepSeek（`OPENAI_API_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`）。
   - 支持流式对话、Tool Calling、JSON 安全解析，以及 **L0 静态灵魂前缀固定**（最大化命中 DeepSeek 硬盘前缀缓存）。
2. **南向多模态媒体后端（仅实现 VVdance：Seedream 图片 + Seedance 视频）**：
   - **Seedream 图片生成/编辑**：`POST ${SEEDREAM_API_BASE_URL}/api/v3/images/generations`，支持文生图（T2I）及带角色设定底图/参考图的图生图（I2I，`image: string[]`）。
   - **Seedance 视频生成**：
     - 创建任务：`POST ${SEEDANCE_API_BASE_URL}/api/v3/contents/generations/ark/tasks`
     - 轮询状态：`GET ${SEEDANCE_API_BASE_URL}/api/v3/contents/generations/tasks/${taskId}`
   - **服务端自动构图（Media Prompt Composer）**：主对话模型调用媒体工具时只需传 `action_intent`（核心动作意图），由服务端自动结合角色的 `人设底图`、`当前所在地点`、`当前穿着` 与 `手持物品` 组装最终请求，彻底消除提示词左右互搏。
3. **核心生命引擎（彻底修复旧版四大顽疾）**：
   - **三层自然衰减上下文（Salience-Decaying 3-Tier Context）**：
     - `L0 静态灵魂层`：角色人设、说话语气范例、核心世界观（置顶永不稀释，杜绝 OOC）。
     - `L1 深刻印记与指数衰减记忆层`：高情感权重的 `memory_imprints` 持久保留；日常记忆 `fading_memories` 随天数按艾宾浩斯指数衰减 $R = S \cdot e^{-\lambda \cdot \Delta t}$，低于阈值自动淡出上下文。
     - `L2 紧凑对话窗 + 第一人称感官快照`：最近 20 轮消息 + 正向 `<current_perception>`（当前时间、地点、正在做的日程、穿着、随身/手边物品、家里冰箱可用库存、当下心境与羁绊）。**严禁出现任何“不要凭空改变物品”等负面防御性禁令**。
   - **记忆驱动的弹性日程（Reactive Schedule Engine）**：
     - 按 `(user_id, character_id, date_key)` 懒加载生成 6~10 个符合角色专属人设的生活时段（Time Blocks）。
     - 首尾自动补齐 00:00~24:00，间隙自动视为自由休息，**严禁因空白碎片丢弃整个日程**。支持随对话约定动态顺延或重排后续未发生时段。
   - **统一空间物品图谱 + 双通道同步（Dual-Channel Inventory）**：
     - 统一管理 5 类归属：`character_equipped`（穿戴）、`character_held`（手持）、`character_carried`（随身）、`character_private`（角色房间）、`shared_home`（共享家里/冰箱库存）。
     - **严禁在日程切换时粗暴清空手持/随身物品**。
     - 支持主模型显式 Tool 更新 + **Post-Turn 回合后置异步提取器**自动根据本轮对话增减物品、更新穿着与重排日程。
   - **三层立体情感反馈引擎（Tri-Layer Affective Engine）**：
     - Layer 1（本轮即时推理突变）：解析回复开头的 `<affect delta_mood="..." delta_bond="..." mood="..." sticker="...">内心OS</affect>`，毫秒级实时反馈并触发对应情绪 Sticker。
     - Layer 2（叙事型心境与内心独白）：持续记录表面态度与内心真实想法。
     - Layer 3（量化养成指标与阈值解锁）：维护 `bond_score` (0-1000)、`trust_score` (0-100)、`mood_valence` (-100~100)，驱动主动消息（Proactive）频率与关系阶段解锁。
4. **北向多端同步网关（REST + WebSocket）**：
   - 提供专属的强类型 REST API 与 WebSocket 实时事件总线（`EventHub`），支持 Web/App 客户端与 Telegram 适配器实时同步同一 `(user_id, character_id)` 主世界线。

---

## 二、 目录结构与模块划分规范

所有新代码必须严格创建在 `/Volumes/SSB/崩老头/localTest/v2` 下：

```text
v2/
├── package.json
├── tsconfig.json
├── WORK_GUIDE.md
├── src/
│   ├── shared/
│   │   ├── types.ts             # 全局核心领域类型与接口契约
│   │   └── schemas.ts           # 请求/响应/LLM JSON 解析校验器
│   ├── db/
│   │   ├── connection.ts        # node:sqlite (DatabaseSync) 初始化、WAL 与 Schema 迁移
│   │   └── repositories.ts      # 强类型参数化 SQL DAO 层 (Users, Characters, Relationships, Schedules, Inventory, Memories, Messages, MediaTasks)
│   ├── providers/
│   │   ├── llm.ts               # LLMProvider 抽象接口 + DeepSeekProvider 实现 + MockLLMProvider
│   │   └── media.ts             # MediaProvider 抽象接口 + VVdaveMediaProvider (Seedream + Seedance) + MockMediaProvider
│   ├── engine/
│   │   ├── context-builder.ts   # 三层自然衰减上下文与 <current_perception> 组装器
│   │   ├── affect-engine.ts     # <affect> 标签流式剥离、三层情感计算与阶段阈值解锁
│   │   ├── schedule-engine.ts   # 弹性日程生成、间隙自愈、当前时段查询与动态重排
│   │   ├── inventory-engine.ts  # 统一空间物品图谱 CRUD、自然常识流转与场景视野过滤
│   │   ├── memory-engine.ts     # 深刻印记铸造、艾宾浩斯衰减计算与每晚角色日记
│   │   ├── post-turn-extractor.ts # 回合后置异步状态提取器 (自动同步衣着/物品/日程/记忆)
│   │   └── chat-orchestrator.ts # 主对话编排器 (串联 Context -> LLM/Tools -> Affect -> Extractor -> EventHub)
│   ├── server/
│   │   ├── event-hub.ts         # 多端 WebSocket 实时同步广播中心
│   │   ├── app.ts               # HTTP REST + WebSocket 服务端 (内置轻量路由与静态测试台)
│   │   └── telegram-adapter.ts  # 轻量级 Telegram 双向同步适配器
└── tests/
    ├── unit/
    │   ├── db.test.ts           # 数据库 Schema 与 DAO 单元测试
    │   ├── schedule.test.ts     # 弹性日程生成、首尾补齐与动态重排单元测试
    │   ├── inventory.test.ts    # 物品跨日程保留、穿戴/手持/冰箱库存联动单元测试
    │   ├── affect-memory.test.ts# 三层情感解析、阈值解锁与记忆指数衰减单元测试
    │   └── providers.test.ts    # DeepSeek 与 VVdance (Seedream/Seedance) 请求构造单元测试
    └── e2e/
        └── full-lifecycle.e2e.test.ts # 端到端全链路闭环测试 (创角 -> 生成日程 -> 聊天互动 -> 拿取冰箱物品 -> 情绪突变 -> 触发VVdance生图/视频 -> 多端WS同步)
```

---

## 三、 严格代码规范（Coding Standards）

1. **运行环境与 Node.js v24 原生 TypeScript 黄金语法规则（极其重要！）**：
   - 目标运行时为 **Node.js v24.7.0**（`package.json` 已开启 `"type": "module"`），支持直接用 `node --no-warnings` 原生运行 `.ts` 文件与 `node --test` 原生测试运行器。
   - **必须遵守 Node v24 Erasable TypeScript 语法红线**（违反将直接导致运行时 SyntaxError）：
     1. **纯类型导入必须加 `type` 关键字**：如 `import type { User, Character } from '../shared/types.ts';`（若混合导入则写 `import { someFn, type SomeType } from './mod.ts';`）。
     2. **本地相对路径导入必须带 `.ts` 扩展名**：如 `import { DatabaseManager } from '../db/connection.ts';`。
     3. **严禁使用构造函数参数属性（Parameter Properties）**：不能写 `constructor(private readonly db: DatabaseSync) {}`，必须显式声明字段：
        ```ts
        private readonly db: DatabaseSync;
        constructor(db: DatabaseSync) {
          this.db = db;
        }
        ```
     4. **严禁使用 TypeScript `enum`**：一律使用联合类型 `export type RoleVisibility = 'public' | 'private';` 或 `as const` 对象。
   - **数据库必须使用内置 `node:sqlite` (`import { DatabaseSync } from 'node:sqlite'`)**。
   - **严禁**模仿旧版建单张 `documents` 表再用 JS `JSON.parse` 全表过滤！所有核心查询必须走 SQL 索引与 `prepare()` 参数化语句。
2. **文件体积与模块化红线**：
   - **单个 `.ts` 源文件原则上不超过 350 行（绝对上限 450 行）**。职责必须单一清晰。
3. **TypeScript 严格类型安全**：
   - 开启 `"strict": true`。禁止使用隐式 `any`。
   - 所有外部输入与大模型返回的 JSON 必须有防御性容错解析（支持剥离 Markdown ` ```json ` 代码块、截断修复与默认值兜底），**绝不允许因为大模型少写一个字段导致整个功能抛错崩溃**。
4. **可测试性与依赖注入（Dependency Injection）**：
   - `DeepSeekProvider` 和 `VVdanceMediaProvider` 必须支持注入自定义 `fetchFn`（默认为全局 `fetch`），以便在无外网沙箱测试中验证其构造的 URL、Header（`Bearer`）与 JSON Payload 完全符合接口契约。

---

## 四、 单元测试与 E2E 测试规范（Testing Spec）

所有测试统一使用 `node --test` 与 `node:assert/strict` 编写，确保零外部网络依赖即可 100% 确定性跑通：

### 1. 单元测试必测项（`tests/unit/*.test.ts`）
* **`db.test.ts`**：验证内存 SQLite (`:memory:`) 初始化全部 10 张表、外键级联、用户绑定 Telegram ID、唯一主世界线查询性能。
* **`schedule.test.ts`**：
  * 验证即使 LLM 只返回了 `08:00-21:30` 的 4 个零散时段且中间有空隙，`ScheduleEngine` 也能自动补齐 `00:00-08:00` 睡眠、中间休息间隙、并将尾部睡眠延伸至 `24:00`，**绝不丢弃模型生成的有效活动**。
  * 验证对话触发日程重排时，已发生的过去时段保持不变，仅顺延或替换当前及未来时段。
* **`inventory.test.ts`**：
  * 验证角色在 `09:00` 拿起“保温杯”（`character_held`）并带着“钥匙、手机”（`character_carried`），切换到 `10:30` 下一个日程时段时，**所持与随身物品完整保留，绝不丢失**。
  * 验证角色在“家中”时，`<current_perception>` 自动包含 `shared_home`（如冰箱里的牛奶 1.5 瓶）；当角色移动到“工作室”时，视野中仅保留随身/手持物，隐藏家里冰箱物品。
* **`affect-memory.test.ts`**：
  * 验证流式/文本回复中的 `<affect delta_mood="+20" delta_bond="+15" mood="脸红心跳" sticker="害羞">...</affect>` 被准确剥离，正文干净无残留，且关系表中的 `mood_valence`、`bond_score`、`inner_monologue` 立即更新，跨越阈值时自动解锁新阶段（如 `friend` $\to$ `ambiguous`）。
  * 验证 `MemoryEngine` 的艾宾浩斯指数衰减：7 天前的低重要度闲聊 `current_retention` 自动衰减至阈值以下并移出活跃 Prompt，而高情感权重的 `memory_imprints` 始终保留。
* **`providers.test.ts`**：
  * 验证 `DeepSeekProvider` 正确拼装 `https://api.deepseek.com/beta/chat/completions` 请求，且 L0 静态灵魂始终位于 `messages[0]` 以命中前缀缓存。
  * 验证 `VVdanceMediaProvider`：
    * Seedream 生图请求准确发往 `/api/v3/images/generations`，当 `include_self=true` 时自动带上角色人设底图与当前穿着/地点构图；
    * Seedance 视频任务准确发往 `/api/v3/contents/generations/ark/tasks` 并正确轮询 `/api/v3/contents/generations/tasks/:id`。

### 2. E2E 全链路集成测试（`tests/e2e/full-lifecycle.e2e.test.ts`）
启动完整的 HTTP + WebSocket Server（挂载内存 SQLite 与可编程 Mock DeepSeek / VVdance 驱动），模拟真实多端用户旅程：
1. **Step 1（注册与创角）**：创建用户（绑定 TG ID），创建角色“双炽”，绑定人设底图，向家里冰箱放入 `牛奶 x 2瓶`、角色随身放入 `怀表 x 1`。
2. **Step 2（懒加载日程与第一人称感知检验）**：发起第一轮聊天“早上好，你在干嘛呢？手里拿着什么？”，验证服务端自动生成今日弹性日程，且发给 DeepSeek 的 Prompt 中明确包含当前日程、随身物“怀表”和家里冰箱的“牛奶 x 2瓶”，无任何负面禁令。
3. **Step 3（情感即时突变 + 喝牛奶扣库存 + 动态改日程）**：用户发送“我今天休假，别去忙工作了，先把冰箱里的牛奶喝一瓶，下午陪我去游乐园吧！真喜欢你～”。验证：
   - 本轮 `<affect>` 立即触发羁绊增加与害羞 Sticker 下发；
   - 回合后置提取器（`PostTurnExtractor`）自动将冰箱牛奶扣减为 `1 瓶`，并将下午的日程重排为“去游乐园”。
4. **Step 4（触发 VVdance 角色自拍与视频生成）**：用户要求“拍张你现在喝牛奶的自拍和一段小视频给我看看”，验证编排器调用 VVdance Seedream & Seedance，自动将当前穿着、家中场景与人设底图合并提交，并将生成的图片/视频 URL 通过 WebSocket 实时广播给所有在线客户端连接。

### 3. React Native Web 客户端测试与验收规范（Work Package 5）
* **源码模块（`v2/src/client/`）**：
  * `rn-web-runtime.ts`：提供标准 React Native Web 组件原语（`View`, `Text`, `TextInput`, `TouchableOpacity`, `ScrollView`, `Image`, `StyleSheet`）及虚拟节点树/DOM 渲染器，确保同一套 RN 风格组件既能在浏览器中渲染出高颜值类 Telegram 响应式界面，又能在 Node.js 测试环境中进行组件树结构与交互断言。
  * `store.ts`：管理客户端状态（当前用户、角色列表、当前选中角色、消息流、右侧抽屉开关、角色工坊弹窗、共享冰箱库存表单、SSE 实时事件监听）。
  * `App.ts`：使用 `StyleSheet.create` 与 RN 原语实现四大核心视图：
    1. **左侧边栏**：角色切换列表 + 「+ 新建角色（角色工坊）」按钮 + 「一键初始化示例角色」按钮；
    2. **中间类 Telegram 聊天主窗口**：顶部状态栏（地点、当前日程活动、心情与羁绊阶段徽章）、消息气泡流（含 `<affect>` 内心 OS 胶囊、情绪 Sticker 贴纸展示、VVdance 自拍图与视频播放器）、底部消息输入栏与快捷工具按钮（发消息、求自拍、生成视频）；
    3. **右侧实时状态/日程/物品抽屉**：展示三层情感指标与深刻印记、穿戴/手持/随身物品、家里冰箱库存（支持直接添加物品到冰箱）、今日 00:00–24:00 弹性日程时间轴；
    4. **角色工坊（Character Studio）弹窗**：创建角色、配置人设与初始物品、调用 `/api/studio/generate-avatar` 现场通过 VVdance Seedream 抽卡生成角色设定底图。
* **服务端挂载（`v2/src/server/app.ts`）**：
  * `GET /` 返回 React Native Web 宿主页面；
  * `GET /assets/rn-web-app.js` 返回可在浏览器直接运行的客户端脚本；
  * `POST /api/studio/generate-avatar` 调用 `mediaProvider.generateImage` 生成角色人设图；
  * `POST /api/seed-demo` 一键初始化示例用户、角色与冰箱牛奶库存。
* **客户端单元测试与 E2E 验收（`tests/unit/client-rnw.test.ts`）**：
  * 验证 `GET /` 与 `GET /assets/rn-web-app.js` 正常返回 200 及完整 RNW 应用；
  * 验证 `POST /api/seed-demo` 与 `POST /api/studio/generate-avatar` 正常工作；
  * 验证 RNW 组件树（`StyleSheet.create`, `View`, `Text` 等）正确渲染聊天窗口、日程时间轴、随身与冰箱物品列表以及角色工坊。

---

## 五、 验收门禁（Acceptance Gates）

每个工作包完成后，必须执行以下两条命令且全部 `exit code === 0`：
1. **类型检查门禁**：`npx tsc --noEmit -p v2/tsconfig.json` 零报错。
2. **测试门禁**：`node --experimental-strip-types --test v2/tests/**/*.test.ts` 100% Pass（0 fail）。
