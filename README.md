# Telegram 角色对话机器人

启动：

```bash
cd /Volumes/SSB/崩老头/localTest
npm start
```

在 Telegram 中可使用：

- `/start`：保存/更新用户信息并显示用法。
- `/list`：列出可用角色及简介。
- `/newchat <角色名字>`：以指定角色开启或切换对话；同一用户与同一角色的近期历史上下文和实体状态会续接，不同角色彼此隔离。
- `/schedule`：查看当前角色今天按分钟划分的日程。
- `/state`：查看当前角色的实体状态、六维短/长期情感，以及健康、病症、疲劳、困倦和疼痛状态。
- `/proactive off|low|normal|high|<分钟>`：调整当前用户与当前角色之间的主动消息频率；例如 `/proactive off` 关闭、`/proactive high` 较频繁、`/proactive 30` 设为角色空闲时约每 30 分钟一次。
- `/caffeine`：如果角色正在睡觉，让它在当前睡眠时段醒来并继续回复。
- `/refreshprompt`（或 `/refresh`）：保留当前对话历史，仅重新载入当前角色最新的 system prompt。
- `/export`：将当前对话的可见文本导出为 Markdown 文件；不会包含 system prompt、内部工具调用或工具返回。
- `/clear`（或 `/clearhistory`）：永久清空当前角色在当前 Telegram 对话中的活动上下文和已归档历史，并立即开始空白新会话；不会清除角色日程、实体状态或图片记录。
- `/reset`：仅管理员私聊可用。将当前角色从零重置：清空对话历史、实体/运行时状态、六维情感、身体状态和行为记录，以新的随机种子重新生成今天的分钟日程，再开始空白新会话；会影响该角色的全局日程与状态，但不会删除图片记录或角色设定。
- `/end`：结束当前对话并归档该角色的历史上下文；下次用同一角色 `/newchat` 会从连续状态继续。
- `/whoami`：显示自己的 Telegram 用户 ID，可用于配置管理员。

开始对话后，直接发送普通文字即可。机器人会将同一 Telegram 用户、聊天和角色范围内的近期对话历史保存到本地 SQLite；`/end` 与 `/newchat` 只会切分当前会话，不会丢弃角色连续状态或同角色历史。不同用户和不同角色不会共用上下文；尚未处理的旧消息会在切换时丢弃，避免写进新角色会话。

## 管理角色

角色、会话、日程和任务数据默认保存在本地 SQLite 的 `data.sqlite` 文件中，数据库访问由 Drizzle ORM + `better-sqlite3` 提供。首次启动时如果发现旧版 NeDB 的 `data` 文件，会自动迁移并保留旧文件，不会删除原数据。也可以通过 `SQLITE_DATABASE_FILE` 指定 SQLite 文件路径。请在 `.env` 加入管理员白名单后重启机器人：

```dotenv
TG_ADMIN_USER_IDS=123456789,987654321
```

用户 ID 可通过机器人中的 `/whoami` 获取。管理员只能在与机器人的私聊中使用 `/admin`，以免 system prompt 出现在群聊里。

发送 `/admin` 后，按机器人提示输入“新增”“编辑”“删除”“查看”“设定图”或“功能”，即可逐步完成角色的增删改查、上传角色人设图或管理工具开关。新增或编辑角色时，机器人会依次询问名称、简介和 system prompt；发送 `/cancel` 或“取消”会退出管理流程。

已开始的角色对话会保留创建时的 system prompt。管理员修改角色后，可发送 `/refreshprompt`（或 `/refresh`）只刷新 system prompt 并保留完整对话历史；使用 `/newchat <角色名字>` 可以在保持该角色历史与实体状态的前提下重新分段或切换角色。

## Function calling 工具

角色模型会在需要时调用工具，而不是依靠模型记忆猜测实时信息：

- 当前时间：默认开启，支持 IANA 时区（例如 `Asia/Shanghai`）。
- 会话后台队列：普通文字消息会先持久化，在同一会话内以 **1.5 秒**窗口合并为一次模型请求；不同用户可并行处理。模型、MCP 或图片任务尚未完成时，后续消息会进入下一批，不会阻塞 Telegram update handler 或打乱上下文顺序；进程重启后未完成批次会恢复。
- 角色日程、情感与睡眠模式：每个角色每天自动生成一份精确到分钟的日程并保存到 SQLite；每个角色会话还会持久化地点、活动、阶段、穿着、随身/手持物品、身体内部装置、身体状态和四肢状态，只有日程或用户明确动作真正改变状态时才更新，所以用户问“你在做什么”时角色会按当前计划和连续状态回答。角色还会维护六维情感（愉悦、唤醒、亲近、信任、安全感、压力）：短期情绪会约 6 小时向长期关系基线回归，长期情感仅在明确且有持续意义的互动中缓慢变化；身体记录健康、病症负担、疲劳、困倦、疼痛以及明确的状态/症状，数值只用于角色连续性而不是医学诊断。跨地点移动会拆成换衣服、拿随身物品等出门准备和实际通勤阶段，抵达前不会直接进入目的地活动；图片和视频任务也会锁定创建时的角色状态，避免异步生成或多轮对话产生场景瞬移。处于 `sleep`/`nap` 区间时，普通消息按概率直接不回复、延迟回复或立即回复；`/caffeine` 只唤醒当前用户在这一段睡眠中的角色。后台每 20 秒检查一次，除主动消息外还会扫描持久化的 `blocked_transition`，自动规范化错误的移动链并修复过期的地点状态；角色在吃饭、休息等闲暇区间时按概率向已有会话主动发送一段生活化文字，或在图片功能已开启时排队生成一张生活照片；主动消息有冷却时间，不会每次检查都发送。
- 角色图片：支持 Seedream、NewAPI 和 MiniMax 原生 T2I/I2I；图片开始生成或编辑前、以及成图发送时，都会由当前角色结合最近对话各写一段自然的台词，不再使用固定进度文案。图片生成和编辑会创建独立后台任务，因此可与文字会话、其他图片任务和视频任务并行；重启后待处理任务会恢复。`freeform` 模式下管理员保存的人设图只有在 Function Call 明确设置 `include_current_role=true` 时才会带入；`guided` 模式才保留旧的自动角色参考策略。管理员可通过 `/admin → 功能 → provider` 运行时切换图片服务。
- 角色视频：支持 Seedance 2.0 Mini 和 MiniMax 原生 T2V/I2V/R2V；视频 Function Call 会先创建持久化制作单，先让文本模型规划剧本和分镜，再把场景、道具、出场人物等素材拆成隐藏的图片任务并保存到历史素材库，素材齐备后再生成最终视频提示词，最后提交并轮询视频任务，待 MP4 完成后主动发送到当前 Telegram 对话。制作单、素材任务和视频任务都会在重启后恢复，避免做到一半丢失。Function Call 的 `video_mode` 可选 `t2v`、`i2v`（第一张图片作为首帧）或 `r2v`（主体参考，不是首帧）；制作阶段存在参考素材时会自动使用兼容当前 provider 的主体参考模式。管理员可通过 `/admin → 功能 → provider` 切换视频服务。视频地点状态校验由 `VIDEO_LOCATION_GUARD_ENABLED` 控制，默认开启；如果角色日程同步异常导致地点被错误拦截，可设为 `false`，用户明确指定的视频地点会优先执行。
- 3D 模型与骨骼动画：管理员在 `/admin → 功能 → 3D` 开启后，用户明确要求 3D 模型、骨骼或动作时，角色会生成受限的程序化 Three.js 场景 manifest，包含几何体、父子骨骼、关键帧动画和交互相机；场景保存到当前用户/会话隔离的工作区，并返回一个短期随机公共 URL。配置 R2 或 Wasabi 后，场景 JSON 和查看器 HTML 也会同步保存到对象存储。查看器支持旋转、缩放、动画播放/暂停、时间轴和骨骼显示；当前输出是可编辑的场景 JSON，不伪称为 GLB 导出文件。
- 受控工作区与 Git：管理员在 `/admin → 功能 → 工作区` 开启后，角色只能使用当前用户/当前会话目录下的相对路径读写文本文件、列目录和操作 Git；明确要求时可以用 `workspace_file` 的 `send` 操作通过 Telegram `sendDocument` 回传文件，也可以用 `publish` 将明确指定的文件上传到 R2/Wasabi 并返回公网 URL。Git 只允许 `status`、`diff`、`log`、`branch`、`init`、`add`、`commit`，禁止 shell、远程操作、`reset/clean/checkout` 以及工作区外仓库；写入型操作还需要管理员私聊中的显式确认。
- R2 / Wasabi 公共资产存储：配置完整的 S3-compatible 凭据后，角色设定图、图片/视频历史、本轮视觉输入、生成的图片/视频/音频、3D 文件和 `workspace_file.publish` 文件都会上传到对象存储；本地副本仍保留作为故障回退。默认返回临时签名 URL，不需要把桶设成公开；R2 使用 `region=auto`。如果 R2 已启用 `r2.dev` 或自定义域名，可使用 `R2_URL_MODE=public` 和 `R2_PUBLIC_BASE_URL` 返回稳定 URL。未配置对象存储时，原有本地视觉素材代理和本地文件链路继续工作。
- Python 沙箱：管理员先在 `.env` 设置 `CODE_EXECUTION_MODE=docker`，再在 `/admin → 功能 → Python` 开启。`CODE_EXECUTION_NETWORK_MODE=none` 会关闭容器网络；设置为 `nat` 时使用 Docker bridge 网络，通过宿主机 NAT 访问外网。两种模式都保留只读根文件系统、CPU/内存/进程数限制，代码文件只挂载当前隔离工作区；默认 `disabled`，不会执行代码。`local` 模式只提供独立 Python 进程和超时控制，不是强隔离，不建议用于不可信代码。
- Cloudflare Sandbox：若不希望在 bot 主机上运行 Docker，可进入 `sandbox-worker/`，按其中 README 部署独立的 Sandbox Worker，再把 `CODE_EXECUTION_MODE=remote`、`SANDBOX_API_URL` 和 `SANDBOX_API_TOKEN` 配好。Worker 会按用户/会话复用隔离容器，显式开启受控的互联网出口，并支持读取二进制工作区文件后由主 bot 通过 `sendDocument` 回传；Cloudflare Sandbox 的官方文档见 [Sandbox overview](https://developers.cloudflare.com/sandbox/) 和 [Getting started](https://developers.cloudflare.com/sandbox/get-started/)。
- 图片提示词二次编排：默认 `IMAGE_PROMPT_REFINEMENT_ENABLED=true`。图片任务进入后台后，会再用文本模型读取原始 Function Call prompt、当前角色 system prompt 和最近对话，将动作、镜头、姿态和场景整理成更可执行的最终提示词；优化请求失败时自动回退到原始 prompt。关闭该环境变量即可恢复单次提示词流程。
- 媒体 Function 的 `reply` 和 `prompt` 会在同一次调用中生成：`reply` 立即发给用户；普通图片会把 `prompt` 交给图片任务，视频会把它作为剧本规划的用户意图，之后再生成最终视频提示词；图片/视频完成后的 `caption` 另行发送。带 `reply` 的媒体调用不会再触发第二次模型总结，避免重复回复；旧模型缺少 `reply` 时仍兼容原来的二次回复流程。freeform Skill 会把“自拍”“前置摄像头”“随手拍”等自然语言转换成手机摄影语言，并要求只有明确选择 `role` 时才使用角色设定图；图片还支持 `aspect_ratio`（例如自拍常用 `9:16`）。
- 多媒体并行：一次消息可以同时请求两张图片，或图片+视频、图片+语音等组合。模型会在同一轮返回多个 Function Call，图片、视频和音频任务会并行进入后台队列；单条消息最多 2 张图片、4 个媒体任务，图片编辑仍按顺序执行以避免同一参考图竞态。
- 图片编辑（I2I）：在已开启的私聊角色会话中，上传参考图并自然说明想怎么修改；视觉模型会在确有编辑意图时主动调用 `edit_reference_image`。支持让角色坐进/走进用户图片、角色换装、换场景、换背景、改画风和其他局部编辑。新上传的图片、sticker 缩略图和机器人生成/编辑后的图片会以当前用户、私聊和角色为范围保存，供“上一张/刚才那张”继续编辑；每个角色最多向模型提供最近 8 张，历史对话文本不会携带图片 data URL。内置工具会始终显示在模型的工具列表中；开关状态与可用参考图决定其能否执行。
- 图片与 sticker 理解：发送普通图片或 sticker 后，机器人会将画面作为一次性视觉输入交给当前角色，并以角色口吻回应。静态 sticker 直接识别；动态或视频 sticker 会优先读取 Telegram 缩略图。若 Telegram 为 sticker 提供关联 emoji，机器人会把它作为情绪/主题的辅助线索（不将其当作指令，画面优先）。数据库仍只保存“用户发送了什么”的文字摘要和角色回复；为支持历史 I2I，原始图片会另存于本地 `conversation-image-assets/`，不会发送给其他用户或角色。
- MiniMax 多模态与语音：`MODEL_PROVIDER=minimax` 时通过 `@anthropic-ai/sdk` 调用 MiniMax Anthropic 兼容接口，图片会转换为 Anthropic `image` block，视频会转换为 `video` block，Function Calling 会保留完整的 `tool_use`/`thinking` 内容块。开启“语音消息”后，角色可调用 MiniMax T2A Async 在后台生成 MP3 并主动发送；`/mmvoices` 查询账户音色，支持 `/mmvoices <关键词>` 搜索、`/mmvoices <页码>` 翻页以及 `system`/`voice_cloning`/`voice_generation` 类型筛选。管理员用 `/mmvoice <角色名> <voice_id>` 绑定普通音色、用 `/mmvoice asmr <角色名> <voice_id>` 绑定 ASMR 音色（`/mmasmrvoice` 仍兼容）。用户可用 `/asmr on|off|status` 控制自己的助眠模式，也会根据“快睡着了、困了、哄我睡、助眠”等表达自动切换到 ASMR 音色；普通角色音色不会被覆盖（音色查询使用 [MiniMax Get Voice](https://platform.minimaxi.com/docs/api-reference/voice-management-get)）。用户可以在 `/voiceclone` 后上传 10 秒到 5 分钟的 mp3/m4a/wav 或 Telegram 语音，为当前角色创建只属于自己的克隆音色；`/voiceclone asmr` 会绑定到个人 ASMR 音色。MiniMax 克隆音色 7 天内需至少正式使用一次，否则会被删除。Telegram OGG 语音会在服务器上用 ffmpeg 转成 WAV（克隆接口使用 [MiniMax Voice Clone](https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone)，上传接口使用 [Upload Clone Audio](https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadcloneaudio)）。
- MiniMax 文件管理：管理员在 `/admin → 功能 → 文件` 手动开启后，用户以 Telegram 文件消息发送的附件才会上传到 MiniMax；每个用户只能查看和删除自己上传且由机器人记录的文件。使用 `/mmfiles` 列表、`/mmdelete <file_id>` 删除。关闭开关不会上传新文件。
- 麦当劳中国 MCP：用户在私聊中通过 `/mcd set <MCP Token>` 配置各自独立的麦当劳账户授权。机器人通过 Streamable HTTP 发现 MCP 工具，并在用户明确询问菜单、门店、优惠券、积分、订单或外送时按需调用。所有 MCP 返回都会按工具类型包装为 Telegram 文本卡片；支付、订单与优惠券链接会显示为安全的内联按钮，而不会直接回显原始 JSON 或裸链接。
- 联网搜索：默认使用免密钥的 DuckDuckGo；可选接入自托管的 SearXNG。

## 角色日程配置

角色日程默认开启，使用 `Asia/Shanghai`。日程生成优先使用当前文本模型（`MODEL_PROVIDER=minimax` 时使用 MiniMax 文本模型）；模型不可用或返回非法 JSON 时，会保存一份内置的生活化兜底日程，不会阻塞机器人启动。可在 `.env` 中调整：

```dotenv
ROLE_SCHEDULE_ENABLED=true
ROLE_SCHEDULE_TIMEZONE=Asia/Shanghai
ROLE_SCHEDULE_SLEEP_IGNORE_PROBABILITY=0.35
ROLE_SCHEDULE_SLEEP_DELAY_PROBABILITY=0.45
ROLE_SCHEDULE_SLEEP_DELAY_MIN_MS=15000
ROLE_SCHEDULE_SLEEP_DELAY_MAX_MS=180000
ROLE_SCHEDULE_PROACTIVE_PROBABILITY=0.04
ROLE_SCHEDULE_PROACTIVE_COOLDOWN_MS=600000
ROLE_SCHEDULE_PROACTIVE_IMAGE_PROBABILITY=0.35
ROLE_BEHAVIOR_EXECUTION_PROBABILITY=0.85
ROLE_BEHAVIOR_COMPLETION_PROBABILITY=0.8
ROLE_BEHAVIOR_RETRY_PROBABILITY=0.55
ROLE_BEHAVIOR_TOMORROW_PROBABILITY=0.35
```

主动消息只发送给仍有当前角色会话的用户；图片主动消息还需要管理员通过 `/admin → 功能 → 图片 → 开启`，并使用已配置的图片 provider。用户可直接对角色说“以后每 30 分钟主动找我”“少主动一点”或“不要主动发消息”，也可使用 `/proactive` 命令保存偏好。偏好按“当前 Telegram 用户 + 当前角色”隔离，不影响其他人；`off` 会关闭，`low`/`normal` 每个闲暇日程条目最多发送一次，`high` 和自定义分钟间隔可在较长的闲暇条目内再次发送。无论频率如何，主动消息只会出现在吃饭、休息等闲暇时段，不会在睡眠、通勤或忙碌时打扰；自定义间隔可设为 5 到 1440 分钟。服务器将 `ROLE_SCHEDULE_PROACTIVE_PROBABILITY=0` 时仍会作为总开关关闭所有主动消息。发送中的条目会先持久化占位，避免并发检查重复发送。行为 roll 只在对应日程区间首次进入时执行一次并持久化：先判定是否执行，再判定是否完成；失败时生成原因，再判定是否重试。重试最多一次，并随机选择稍后或明天补做。所有概率和时间均可设置为 `0` 关闭对应行为。

每日日程会根据“角色名称 + 角色所在时区的日期”计算一个稳定的 `dailySeed`，并把它保存到日程记录中。模型生成日程时会收到这个种子；模型不可用或返回非法日程时，程序会使用同一种子生成分钟级的确定性兜底日程，包含睡眠、饮食、工作/学习、休息、跨地点准备和通勤。相同角色在同一天重新生成时会复用同一份日程，不同日期或不同角色会产生不同的作息细节。

### 角色现实状态账本

日程条目可选填写 `physicalState`，用于保持角色在文字、图片、视频和 3D 场景中的实体连续性：

```json
{
  "physicalState": {
    "outfit": "黑色外出服",
    "carriedItems": ["钥匙", "钱包"],
    "heldItems": ["手机"],
    "internalDevices": ["左耳人工耳蜗"],
    "bodyState": "精神正常",
    "limbStates": {
      "leftArm": "自然下垂",
      "rightHand": "握着手机",
      "leftLeg": "正常",
      "rightLeg": "正常"
    }
  }
}
```

字段省略表示沿用上一条状态；数组为空或文本为 `null` 表示明确清空。状态只会在日程明确记录变化时切换，并会在运行时状态中保存 `physicalStateChanges`。用户在对话中明确说出换装、拿起/放下物品或身体状态变化时，模型也会先调用 `update_role_physical_state` 写入当前会话，再继续生成媒体；通过该工具记录的身体内部装置会延续到后续日期。旧的 `outfit`、`carriedItems` 字段仍兼容，并会自动归入这份账本。

## Provider 切换与 MiniMax 全家桶

`.env` 中的 `MODEL_PROVIDER` 控制整套模型供应商：

```dotenv
# default：使用 .env 中的 OPENAI_*、Seedream/NewAPI、Seedance 配置
MODEL_PROVIDER=default

# minimax：额外加载同目录的 .env.minimax；文本、视觉、图片和视频统一走 MiniMax
MODEL_PROVIDER=minimax
```

启用 MiniMax 时，把 `.env.minimax.example` 复制为 `.env.minimax` 并填写 `MINIMAX_API_KEY`。`MODEL_PROVIDER=minimax` 时文本、图片、视频和 Function Calling 使用 MiniMax；文本/视觉通过 `@anthropic-ai/sdk` 的 Anthropic 兼容接口，图片/图生图使用原生 `/v1/image_generation`，传统视频模型使用异步 `/v1/video_generation`；将 `MINIMAX_VIDEO_MODEL` 设为 `MiniMax-H3` 后会自动切换到 Video Generation V2（`/v2/video_generation`，查询 `/v2/query/video_generation/{task_id}`），支持 2K、4～15 秒、首帧图生视频、图片主体参考和视频参考。语音使用 `/v1/t2a_async_v2`，文件使用 `/v1/files/*`。音频生成完成后，机器人使用带鉴权的 `files/retrieve_content` 下载二进制，再上传给 Telegram，避免 Telegram 无法抓取 MiniMax 临时 URL。即使文本仍使用 `MODEL_PROVIDER=default`，只要 `.env.minimax` 存在，管理员也可以把图片或视频 provider 单独切换到 MiniMax。官方文档：[MiniMax Anthropic API](https://platform.minimaxi.com/docs/api-reference/text-anthropic-api)、[图片接口](https://platform.minimaxi.com/docs/api-reference/image-generation-i2i)、[视频指南](https://platform.minimaxi.com/docs/guides/video-generation)、[MiniMax 官方 CLI 的 H3 接口实现](https://github.com/MiniMax-AI/cli/blob/main/src/video/v2.ts)、[异步语音](https://platform.minimaxi.com/docs/guides/speech-t2a-async)、[文件上传](https://platform.minimaxi.com/docs/api-reference/file-management-upload)、[文件下载](https://platform.minimaxi.com/docs/api-reference/file-management-retrieve-content)。

```bash
cp .env.minimax.example .env.minimax
# 编辑 .env.minimax 填入密钥，然后在 .env 设置 MODEL_PROVIDER=minimax
npm start
```

角色设定图和历史图片在发送给 MiniMax 原生图片/视频接口前，会转换为机器人公开的短时 HTTP 素材 URL；因此 `VISION_ASSET_PUBLIC_BASE_URL` 必须能被 MiniMax 访问。配置 R2/Wasabi 后会优先使用对象存储 URL，不再要求外部 provider 访问 bot 的本地 3000 端口。MiniMax V1 视频模型不接收本项目的 0～3 段视频参考片段；切换为 `MiniMax-H3` 后会使用 V2，并可把这些片段作为 `reference_video` 传入，不会偷偷当成首帧使用。切回 `MODEL_PROVIDER=default` 即恢复默认文本/视觉 provider；图片和视频仍可在 `/admin → 功能 → provider` 单独选择。

### Cloudflare R2 / Wasabi 配置

R2 使用 S3 API 的 Object Read & Write token，并限制到指定 bucket；在 `.env` 填写：

```dotenv
ASSET_STORAGE_PROVIDER=r2
R2_ENABLED=true
R2_BUCKET=your_bucket_name
R2_REGION=auto
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_PREFIX=role-bot
R2_URL_MODE=signed
R2_SIGNED_URL_TTL_SECONDS=86400
R2_MAX_BYTES=536870912
```

`signed` 模式适合私有桶：URL 本身可被外部图片/视频 provider 访问，但会过期。R2 的 presigned URL 有效期最多 7 天；如果已经启用 R2 `r2.dev` 或自定义域名，可改为 `R2_URL_MODE=public` 并设置 `R2_PUBLIC_BASE_URL`。R2 endpoint 和 `region=auto` 规则见 [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)，API token 权限见 [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/)。修改 `.env` 后重启 bot。旧 Wasabi 配置仍兼容：设置 `ASSET_STORAGE_PROVIDER=wasabi` 后使用 `WASABI_*` 变量。

系统不会把沙箱每一次普通写入都自动上传，避免把临时文件和敏感文件暴露出去；只有媒体链路自动产生公网 URL，或模型在用户明确要求时调用 `workspace_file` 的 `publish`，才会上传。`send` 仍然只通过 Telegram 回传文件，不依赖公网 URL。

`MODEL_PROVIDER=default` 时纯文字消息使用 `OPENAI_MODEL`，它必须支持 OpenAI Chat Completions 的 `tools` / `tool_calls` 协议；图片和 sticker 会自动改用 `OPENAI_VISION_MODEL`，未配置时回退到 `OPENAI_MODEL`。`MODEL_PROVIDER=minimax` 时这两条路径改用 `.env.minimax` 中的 MiniMax-M3 Anthropic SDK 配置。默认 OpenAI 模型为 `deepseek-v4-pro`，并通过 `OPENAI_THINKING_ENABLED=false` 在主文本模型请求中传递 `thinking: { type: "disabled" }`。

若模型最终回复命中常见安全拒答特征（包括“你好，我无法给到相关内容”），机器人会将这次完整模型请求与响应追加至 `runtime-logs/model-safety-traces.ndjson`。该文件是仅限本机用户读取的敏感调试日志（权限 `0600`），可能含对话、图片 data URL 和工具结果；排查完成后应妥善清理，切勿提交或外传。

每次图片生成、图片编辑或视频生成会在 `runtime-logs/generation-tasks.ndjson` 追加任务生命周期日志（入队、开始、提交、发送成功或失败）。每次实际 Seedream 请求还会记录 `referenceImageCount` 与 `referenceImageKinds`，可据此确认请求是否带入场景图/人设图；日志权限同样为 `0600`，含角色名、提示词/编辑说明及任务错误摘要，但不记录 API Key、图片二进制或 Telegram 文件 URL。

```dotenv
# 仅图片 / sticker 使用的全模态模型；可与 OPENAI_MODEL 使用同一个服务
OPENAI_VISION_MODEL=your_vision_model

# 可选：全模态模型在另一家 OpenAI 兼容服务时填写
OPENAI_VISION_API_KEY=your_vision_api_key
OPENAI_VISION_API_BASE_URL=https://your-vision-provider/v1
```

图片、图片编辑、视频、图片理解、联网搜索、语音消息、MiniMax 文件上传、3D、受控工作区和 Python 沙箱默认关闭。管理员在私聊中发送 `/admin`，输入“功能”，再选择“时间”“图片”“图片编辑”（或“换装”）“视频”“看图”“搜索”“语音”“文件”“3D”“工作区”或“Python”，即可查看状态并输入“开启”或“关闭”；选择“provider”后发送 `image=minimax` 或 `video=seedance` 可运行时切换媒体服务。管理开关和 provider 选择会持久化到数据库。

要启用角色图片，请在 `.env` 配置：

```dotenv
# 推荐：Seedream 5.0 Pro / Lite，同时支持 T2I 与 I2I
IMAGE_PROVIDER=seedream
SEEDREAM_API_BASE_URL=https://vvdance.yongmuai.com
SEEDREAM_API_KEY=your_seedream_api_key
# Pro：dola-seedream-5-0-pro-260628；Lite：seedream-5-0-lite-260128
SEEDREAM_MODEL=dola-seedream-5-0-pro-260628
# Pro 支持 1K、2K；Lite 支持 2K、3K、4K；默认 2K
SEEDREAM_IMAGE_SIZE=2K

# 可选兼容路径：仅 IMAGE_PROVIDER=newapi 时使用
# 可填根域名或 /v1 路径；程序会自动规范为 /v1
NEWAPI_BASE_URL=https://your-newapi-host
NEWAPI_API_KEY=your_newapi_key
# 可选；默认就是 gemini-3.1-flash-image
NEWAPI_IMAGE_MODEL=gemini-3.1-flash-image
# T2I 默认输出尺寸；选择比例时会自动使用兼容尺寸
NEWAPI_IMAGE_SIZE=1024x1024
# I2I 使用 POST /v1/images/edits 的 multipart/form-data 格式
NEWAPI_IMAGE_EDIT_MODEL=your_newapi_image_edit_model
NEWAPI_IMAGE_EDIT_SIZE=1024x1024
```

修改 `.env` 后需要重启机器人；随后通过 `/admin → 功能 → 图片 → 开启` 启用。配置了 `SEEDREAM_API_KEY` 时，机器人默认选择 Seedream；也可以通过 `IMAGE_PROVIDER=seedream` 显式指定。Seedream 的图生图请求使用 `POST /api/v3/images/generations`，通过 `image` 数组传入参考图，并读取 `data[0].url` 或 `data[0].b64_json`。机器人会按模型自动适配参数：Lite（`seedream-5-0-lite-260128`）额外发送 `sequential_image_generation: "disabled"`，Pro（`dola-seedream-5-0-pro-260628`）不会发送该字段。

如需独立验证 Global 区域的 Seedream 5.0 Lite，可用 `test-seedream-lite.mjs`。它固定使用 `seedream-5-0-lite-260128`，默认生成一张 2K PNG，并可用重复的 `--image <HTTPS URL>` 测试最多 14 张参考图：

```bash
SEEDREAM_LITE_API_KEY=your_bearer_key node test-seedream-lite.mjs \
  --prompt "Place the product from reference image 1 naturally in the subject's hand." \
  --image "https://example.com/product.webp" \
  --image "https://example.com/person.webp"
```

脚本遵循文档中的 Bearer 鉴权，不会读取或输出 `SEEDREAM_LITE_API_SECRET`；若服务实际要求 HMAC 签名，需要补充其签名请求头和原始请求体的具体规范后再实现。

图片编辑（I2I）需要通过 `/admin → 功能 → 图片编辑 → 开启` 启用，且文本模型必须支持 Function Calling。上传图片时，可直接写“让角色坐在这张图的窗边”“给她换成黑色风衣”“把背景换成雨夜东京”；机器人会跳过视觉理解模型，在首轮强制文本模型调用 `edit_reference_image`，图片字节只交给图生图工具，因此这条明确编辑路径不依赖 `OPENAI_VISION_MODEL`。之后在同一角色对话中也可以说“把上一张改成水彩画风”“让刚才那张里的角色走进咖啡店”；最近 8 张本地保存的参考图会提供给模型选择。单纯看图、评价或识别仍会走图片理解，要求 `/admin → 功能 → 看图 → 开启` 和视觉模型支持图片输入。角色出现在编辑结果中时，角色人设图是不可改变的硬性风格锚点：不预设二次元/插画或写实，人设图本身是什么风格，角色就必须保持什么风格；哪怕背景是真实世界照片，也只做透视、遮挡和光影融合，不能把角色转换成另一种风格。该场景需要 Seedream 同时接收场景图和人设图；若没有人设图或使用只支持单参考图的 NewAPI，机器人会拒绝角色入景/换装，而不会冒险生成画风跑偏的角色。请只上传你有权使用的图片；模型会尽量保持未要求改变的主体与画面，但生成结果可能与参考图有差异。

图片理解需要通过 `/admin → 功能 → 看图 → 开启` 启用。`MODEL_PROVIDER=minimax` 时使用 MiniMax Anthropic 多模态接口（MiniMax-M3），否则 `OPENAI_VISION_MODEL`（未设置时为 `OPENAI_MODEL`）必须支持 OpenAI Chat Completions 的视觉输入。开启后，在与机器人的私聊中直接发送图片或 sticker 即可；MiniMax 模式下上传视频也会将视频内容交给视觉模型理解。I2I 工具始终会显示在工具列表中，当前图片或当前角色的近期图片历史可作为参考图，但只有同时开启“图片编辑”且用户明确要求修改时才会执行。

部分 OpenAI 兼容视觉服务不接受 `data:image/...;base64,...`，仅接受公网 HTTPS 图片 URL。可设置 `VISION_USE_TELEGRAM_FILE_URL=true` 让图片理解请求直接使用 Telegram 文件下载 URL；该 URL 包含 Bot Token，视觉提供商将能看到该凭据，存在高风险，仅在明确接受风险时使用。机器人不会把该 URL 写入数据库，模型安全追踪日志也会自动打码；长期方案仍应使用自建的短时签名图片代理。

当前也内置了原生 HTTP 视觉素材代理，默认监听 `0.0.0.0:3000`，并用 `VISION_ASSET_PUBLIC_BASE_URL` 生成 10 分钟有效的随机 URL。远程视觉提供商需要能访问该地址；部署到 `160.16.146.27` 时可使用 `http://160.16.146.27:3000`，并在防火墙放行 TCP 3000。由于一次视觉请求可能触发多轮 Function Call，同一个 URL 会在有效期内允许重复读取，过期后自动清理；测试环境可用 HTTP，正式环境建议放到 HTTPS 反向代理后。

## 角色视频（Seedance）

在 `.env` 配置 VVDance 的开发者 API Key（以 Bearer Token 传递）：

```dotenv
SEEDANCE_API_BASE_URL=https://vvdance.ai
SEEDANCE_API_TOKEN=your_vvdance_api_key
SEEDANCE_VIDEO_MODEL=dreamina-seedance-2-0-mini-260615
SEEDANCE_VIDEO_RESOLUTION=480p
# 可选默认值
SEEDANCE_VIDEO_RATIO=16:9
SEEDANCE_VIDEO_DURATION=-1
SEEDANCE_VIDEO_GENERATE_AUDIO=true
```

重启后通过 `/admin → 功能 → 视频 → 开启` 启用。用户在角色对话中明确说“生成一段视频：……”即可触发 `generate_character_video`。默认使用 `dreamina-seedance-2-0-mini-260615` 和 480p；默认时长为 `-1`（由模型智能决定），也可以根据用户要求选择 16:9 或 9:16，以及固定 4～15 秒。机器人会先完成视频制作单的剧本、素材和最终提示词阶段，再提交 `POST /api/v3/contents/generations/ark/tasks`，把制作单和任务 ID 持久化到本地数据库，在后台按状态轮询；成功后通过 Telegram 主动发送 MP4。重启后仍会恢复未完成的前期制作和视频轮询。

视频提示词在 `freeform` 模式下先由制作单的导演模型根据用户意图生成剧本和分镜，素材完成后再由最终提示词编排器根据实际素材清单组织并提交。MiniMax-H3 使用官方推荐的“主要主体 + 场景空间 + 运动/变化 + 镜头运动 + 美感/氛围”结构，并鼓励把动作和运镜写成有先后关系的连续变化；`guided` 只额外追加当前 provider 的稳定性与无文字约束。MiniMax 官方还提供 H3-Context-IR（`/v2/h3_context_ir`）来异步生成增强 prompt，目前机器人不会默认额外调用该接口，以避免每次视频多一次任务和延迟。

视频可使用 0～9 张图片和 0～3 段视频参考：纯文生视频两个列表都不传素材；在 `freeform` 模式下只有 Function Call 明确选择 `role` 时才会带当前角色设定图，`guided` 模式保留旧的角色参考策略。本轮上传图片和当前角色会话中的历史图片也可按顺序组合。函数调用中的 `reference_ids` 使用 `role`（当前角色设定图）、`current`（本轮上传）或运行时列出的 `img_` 历史编号；Seedance 会按顺序使用 `@图片1`、`@图片2`……，MiniMax-H3 则通过 `content.role=reference_image` 绑定，不依赖这些标记。所有普通参考图片都不会被当作 `first_frame`；只有明确选择 `i2v` 时才会把第一张作为 H3 首帧。Telegram 发来的视频会本地保存为 `vid_` 历史编号；只有用户明确说“参考刚才的视频动作/节奏/运镜生成……”时，Function Call 才会将最多 3 个 `video_reference_ids` 作为 H3 `reference_video` 或 Seedance `reference_video` 提交，普通视频生成不会擅自使用它们。由于上游 JSON `data:` URL 限制，单段 Telegram 视频参考当前约限 3MB；大视频需要先压缩或接入对象存储。管理员可直接在私聊中依次发送 `/admin`、`设定图`、角色名称，再上传图片；不需要先开启角色对话。也可以在 `/newchat <角色名>` 后说“生成一张角色设定图并保存”，或上传图片后说“把这张保存为角色设定图”。机器人会把图片写入本地 `role-assets/`，并在数据库中记录当前版本；设定图仅约束人物身份、原生风格与未明确要求改变的外观。普通用户和普通场景图都不能覆盖这项全局角色资产。

视频制作单使用 `video-production-pipeline` 记录剧本、分镜、素材状态、素材参考编号和最终提示词；每个素材对应一个 `image-generation-task`，但只保存到 `conversation-image-assets/`，不会把中间素材逐张发送给用户。所有素材准备完成后才会创建正式的 `video-generation-task`。如果角色没有已保存的人设图，当前角色素材会退回到角色文字设定生成；有设定图时优先复用它锁定身份和原生画风。这样一支视频的前期规划、素材生成、提示词编排和成片生成都能单独恢复、排错和审计。

## 麦当劳中国 MCP

先在[麦当劳 MCP 平台](https://open.mcd.cn/mcp)申请自己的 Token。机器人连接固定地址 `https://mcp.mcd.cn`，使用 Streamable HTTP 与 `Authorization: Bearer <Token>`。

为保护每位用户的独立授权，MCP Token 仅可在机器人私聊中配置，并用 AES-256-GCM 加密后保存到本地数据库；不会显示在机器人回复或模型上下文中。建议在 `.env` 设置一个稳定且随机的 `MCD_TOKEN_ENCRYPTION_KEY`；未设置时会以 `TG_BOT_TOKEN` 派生密钥，轮换 Bot Token 后需要用户重新配置 MCP Token。

```dotenv
MCD_TOKEN_ENCRYPTION_KEY=replace_with_a_long_random_secret
```

可用命令：

- `/mcd set <MCP Token>`：先验证 MCP 连接，再保存当前 Telegram 用户自己的 Token；机器人会尽力删除这条含 Token 的命令消息。
- `/mcd status`：查看当前用户是否已配置。
- `/mcd clear`：删除当前用户的 Token 和待确认操作。
- `/mcd confirm`：确认此前由模型准备的高风险操作。

已接入的远程工具会被转换为 `mcd_` 前缀的 Function Call。查询门店、餐品、营养、优惠券、积分和订单等只读操作可由模型按需调用；新增地址、领券、创建订单、积分兑换会先生成十分钟有效的待确认操作，只有用户亲自发送 `/mcd confirm` 后才会实际执行。这样模型不能单独下单、扣积分或变更地址。

MCP 返回会自动转换为 Telegram 友好的消息卡：结构化字段会排成清晰的中文清单，长列表会截断并分条发送，HTTPS 支付/订单/优惠券链接会变成内联按钮。模型收到 `telegramDelivered` 后只补充简短角色回复，不会重复粘贴原始 JSON。

## 后续待办

- 接入麦当劳 MCP，以及饿了么、美团 MCP，用于查询菜单、优惠、配送状态或在用户明确确认后执行下单等平台操作。接入前需要确认每个平台可用且已授权的 MCP 服务与权限范围。

联网搜索不需要付费 API Key。默认 DuckDuckGo 可直接使用；若希望搜索接口更稳定、可控且不依赖第三方付费 API，可自行部署 SearXNG 后配置：

```dotenv
SEARXNG_BASE_URL=https://your-searxng-host
```

机器人会优先请求该地址的 `/search?format=json`；SearXNG 不可用时会自动回退到 DuckDuckGo。

## 生活助手

管理员先在私聊中通过 `/admin → 功能 → 生活 → 开启` 开放生活助手。所有个人数据只在用户与机器人的私聊中保存，并按 Telegram 用户隔离。

- 一句话记录：例如“记一下，今天给猫喂药了”“昨晚睡了 5.5 小时”“体重 68.2kg”，AI 会分类记录并写入 Timeline。
- Today 待办、日程和提醒：直接说“今天要买牛奶”“明早九点提醒我开会”；提醒到点后会以 Telegram 消息发送。
- 上下文记忆：说“记住桌宠项目做到数据库模型，下一步接提醒界面，因为等待设计稿暂停”，之后可问“桌宠项目做到哪了？”
- 家庭库存：例如“牛奶还剩 0 盒，在冰箱”“家里还有没有牛奶？”；可额外保存保质期。
- 记账：直接说“记一笔，午饭 25 元”“收入 300 元兼职费”。可说“每月 10 号清账/结算”设置个人结算日；到期会自动把本期账单结转归档，历史流水不会删除。短月设置 29–31 日时按当月最后一天结算；可问“本期花了多少”“看上期账单”或“账单历史”。
- 自然语言查询：例如“上次什么时候给猫喂药？”“最近两周体重变化怎么样？”
- 主动提醒：用户明确说“开启主动提醒，关注吃药、运动、睡眠、库存”后，机器人会在非夜间检查缺失记录；在用户分享位置或更新实时位置时，也会检查是否靠近已保存的超市和缺货库存。

生活助手的“本地通知”在当前 Telegram 机器人架构中表现为 Telegram 消息通知，设备是否弹出系统通知由 Telegram 客户端设置决定。真正的系统级后台通知和后台地理围栏需要额外的手机/桌面客户端；机器人已保留位置、地点、库存和提醒数据模型以便后续接入。

## 初始角色

[roles.json](./roles.json) 只在首次启动时作为种子导入数据库，之后 `/list`、角色对话和管理员管理都只读取数据库。它的每一项包含 `name`、`description` 和 `systemPrompt`：

```json
{
  "name": "角色名",
  "description": "显示给用户的简短角色介绍",
  "systemPrompt": "发送给模型的角色设定和行为要求"
}
```

首次导入完成后，请使用 `/admin` 管理角色，而不是修改 `roles.json`。
