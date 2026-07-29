# Telegram 角色对话机器人

启动：

```bash
cd /Volumes/SSB/崩老头/localTest
npm start
```

在 Telegram 中可使用：

- `/start`：保存/更新用户信息并显示用法。
- `/list`：列出可用角色及简介。
- `/newchat <角色名字>`：以指定角色创建新的对话；若已有对话，会被新的对话替换。
- `/export`：将当前对话的可见文本导出为 Markdown 文件；不会包含 system prompt、内部工具调用或工具返回。
- `/end`：结束当前对话并清除这段对话的上下文。
- `/whoami`：显示自己的 Telegram 用户 ID，可用于配置管理员。

开始对话后，直接发送普通文字即可。机器人会将该 Telegram 聊天和用户组合下的全部消息历史保存到本地 `data` 文件，并在 `/end` 前持续带给模型；不同用户不会共用上下文。

## 管理角色

角色数据保存在本地 NeDB 的 `data` 文件中。请在 `.env` 加入管理员白名单后重启机器人：

```dotenv
TG_ADMIN_USER_IDS=123456789,987654321
```

用户 ID 可通过机器人中的 `/whoami` 获取。管理员只能在与机器人的私聊中使用 `/admin`，以免 system prompt 出现在群聊里。

发送 `/admin` 后，按机器人提示输入“新增”“编辑”“删除”“查看”“设定图”或“功能”，即可逐步完成角色的增删改查、上传角色人设图或管理工具开关。新增或编辑角色时，机器人会依次询问名称、简介和 system prompt；发送 `/cancel` 或“取消”会退出管理流程。

已开始的角色对话会保留创建时的 system prompt。管理员修改角色后，用户需要重新发送 `/newchat <角色名字>` 才会使用新设定。

## Function calling 工具

角色模型会在需要时调用工具，而不是依靠模型记忆猜测实时信息：

- 当前时间：默认开启，支持 IANA 时区（例如 `Asia/Shanghai`）。
- 角色图片：支持 Seedream 5.0 Pro 的 T2I 与 I2I；图片会附带由当前角色根据最近对话写出的俏皮配文。角色换装、遇到漂亮场景或自然的自拍/打卡时，会主动拍一张；每条消息最多一张。画面包含角色本人时优先使用该角色已保存的人设图保持外观和 2D 画风，纯风景、物品或食物则不强行让角色入镜。未配置 Seedream 时会改走已有的 NewAPI 图片路径。
- 角色视频：支持 Seedance 2.0 Mini 文生视频；角色会把明确的视频创作需求转成 Function Call，先确认开拍，待后台任务完成后再把 MP4 发送到当前 Telegram 对话。
- 图片编辑（I2I）：在已开启的私聊角色会话中，上传参考图并自然说明想怎么修改；视觉模型会在确有编辑意图时调用 `edit_reference_image`。支持换装、换场景、换背景、改画风和其他局部编辑；工具仅能使用本次消息的图片，原图不会写入本地对话数据库。内置工具会始终显示在模型的工具列表中；开关状态和本轮是否附图决定其能否执行。
- 图片与 sticker 理解：发送普通图片或 sticker 后，机器人会将画面作为一次性视觉输入交给当前角色，并以角色口吻回应。静态 sticker 直接识别；动态或视频 sticker 会优先读取 Telegram 缩略图。原图不持久化，数据库仅保存“用户发送了什么”的文字摘要和角色回复。
- 麦当劳中国 MCP：用户在私聊中通过 `/mcd set <MCP Token>` 配置各自独立的麦当劳账户授权。机器人通过 Streamable HTTP 发现 MCP 工具，并在用户明确询问菜单、门店、优惠券、积分、订单或外送时按需调用。所有 MCP 返回都会按工具类型包装为 Telegram 文本卡片；支付、订单与优惠券链接会显示为安全的内联按钮，而不会直接回显原始 JSON 或裸链接。
- 联网搜索：默认使用免密钥的 DuckDuckGo；可选接入自托管的 SearXNG。

纯文字消息使用 `OPENAI_MODEL`，它必须支持 OpenAI Chat Completions 的 `tools` / `tool_calls` 协议；否则普通对话仍可用，但无法可靠执行这些函数。当前默认模型为 `deepseek-v4-pro`，并通过 `OPENAI_THINKING_ENABLED=false` 在主文本模型请求中传递 `thinking: { type: "disabled" }` 关闭深度思考。图片和 sticker 会自动改用 `OPENAI_VISION_MODEL`；未配置该项时才回退到 `OPENAI_MODEL`。

若模型最终回复命中常见安全拒答特征（包括“你好，我无法给到相关内容”），机器人会将这次完整模型请求与响应追加至 `runtime-logs/model-safety-traces.ndjson`。该文件是仅限本机用户读取的敏感调试日志（权限 `0600`），可能含对话、图片 data URL 和工具结果；排查完成后应妥善清理，切勿提交或外传。

```dotenv
# 仅图片 / sticker 使用的全模态模型；可与 OPENAI_MODEL 使用同一个服务
OPENAI_VISION_MODEL=your_vision_model

# 可选：全模态模型在另一家 OpenAI 兼容服务时填写
OPENAI_VISION_API_KEY=your_vision_api_key
OPENAI_VISION_API_BASE_URL=https://your-vision-provider/v1
```

图片、图片编辑、视频、图片理解和联网搜索默认关闭。管理员在私聊中发送 `/admin`，输入“功能”，再选择“时间”“图片”“图片编辑”（或“换装”）“视频”“看图”或“搜索”，即可查看状态并输入“开启”或“关闭”。管理开关会持久化到数据库。

要启用角色图片，请在 `.env` 配置：

```dotenv
# 推荐：Seedream 5.0 Pro，同时支持 T2I 与 I2I
IMAGE_PROVIDER=seedream
SEEDREAM_API_BASE_URL=https://vvdance.yongmuai.com
SEEDREAM_API_KEY=your_seedream_api_key
SEEDREAM_MODEL=dola-seedream-5-0-pro-260628
# Pro 支持 1K、2K 或满足模型限制的 宽x高；默认 2K
SEEDREAM_IMAGE_SIZE=2K

# 可选兼容路径：仅 IMAGE_PROVIDER=newapi 时使用
NEWAPI_BASE_URL=https://your-newapi-host/v1
NEWAPI_API_KEY=your_newapi_key
# 可选；默认就是 gemini-3.1-flash-image
NEWAPI_IMAGE_MODEL=gemini-3.1-flash-image
# T2I 默认输出约 1080p 的竖图；可按模型能力调整
NEWAPI_IMAGE_SIZE=1080x1920
# I2I 使用 POST /v1/images/edits 的 multipart/form-data 格式
NEWAPI_IMAGE_EDIT_MODEL=your_newapi_image_edit_model
NEWAPI_IMAGE_EDIT_SIZE=1024x1024
```

修改 `.env` 后需要重启机器人；随后通过 `/admin → 功能 → 图片 → 开启` 启用。配置了 `SEEDREAM_API_KEY` 时，机器人默认选择 Seedream；也可以通过 `IMAGE_PROVIDER=seedream` 显式指定。Seedream 请求使用 `POST /api/v3/images/generations`，并读取 `data[0].url` 或 `data[0].b64_json`。

图片编辑（I2I）需要同时通过 `/admin → 功能 → 看图 → 开启` 和 `/admin → 功能 → 图片编辑 → 开启` 启用，且视觉模型必须同时支持图片输入和 Function Calling。`edit_reference_image` 会始终显示在模型工具列表中，但只有本轮上传了参考图、开关已开启且用户明确提出编辑要求时才会执行。用户在私聊中上传参考图，并自然说明“换成黑色风衣”“把背景换成雨夜东京”“改成水彩画风”等意图时，模型才会调用它；单纯看图不会触发编辑。使用 Seedream 时，机器人将 Telegram 参考图转换为 `data:image/...;base64,...` 传给同一个图片生成接口；使用 `IMAGE_PROVIDER=newapi` 时，机器人会按照 NewAPI 的 `POST /v1/images/edits` 文档使用 `multipart/form-data` 上传参考图。该接口文档限制参考图最大 4MB、提示词最大 1000 字符，默认输出尺寸为 `1024x1024`；需要更高分辨率 I2I 时推荐使用 Seedream 2K。请只上传你有权使用的图片；模型会尽量保持未要求改变的主体与画面，但生成结果可能与参考图有差异。

图片理解需要通过 `/admin → 功能 → 看图 → 开启` 启用，且 `OPENAI_VISION_MODEL`（未设置时为 `OPENAI_MODEL`）必须支持 OpenAI Chat Completions 的视觉输入。开启后，在与机器人的私聊中直接发送图片或 sticker 即可；I2I 工具始终会显示在工具列表中，但只有同时开启“图片编辑”、本轮附有图片且用户明确要求修改时才会执行。

## 角色视频（Seedance）

在 `.env` 配置 VVDance 的开发者 API Key（以 Bearer Token 传递）：

```dotenv
SEEDANCE_API_BASE_URL=https://vvdance.ai
SEEDANCE_API_TOKEN=your_vvdance_api_key
SEEDANCE_VIDEO_MODEL=dreamina-seedance-2-0-mini-260615
SEEDANCE_VIDEO_RESOLUTION=480p
# 可选默认值
SEEDANCE_VIDEO_RATIO=16:9
SEEDANCE_VIDEO_DURATION=5
SEEDANCE_VIDEO_GENERATE_AUDIO=true
```

重启后通过 `/admin → 功能 → 视频 → 开启` 启用。用户在角色对话中明确说“生成一段视频：……”即可触发 `generate_character_video`。默认使用 `dreamina-seedance-2-0-mini-260615` 和 480p；模型可以根据用户要求选择 16:9 或 9:16，以及 4 或 5 秒时长。机器人会提交 `POST /api/v3/contents/generations/ark/tasks`，把任务 ID 持久化到本地数据库，在后台按状态轮询；成功后通过 Telegram 主动发送 MP4。重启后仍会恢复未完成任务的轮询。

视频提示词按 Seedance 2.0 工程化规范生成：单一场景会写清主体、连续动作、场景、光影/风格和一种运镜；多事件或多场景会按“镜头1、镜头2……”给出顺序分镜，避免绝对秒数与同镜头叠加运镜。程序会自动追加高清、稳定、无水印与无 Logo 约束；除非用户明确要求字幕、标题或气泡文字，否则也会要求无文字/无字幕。

为保持角色的 2D 画风和外观一致，视频必须先有角色设定图。管理员可直接在私聊中依次发送 `/admin`、`设定图`、角色名称，再上传图片；不需要先开启角色对话。也可以在 `/newchat <角色名>` 后说“生成一张角色设定图并保存”，或上传图片后说“把这张保存为角色设定图”。机器人会把图片写入本地 `role-assets/`，并在数据库中记录当前版本；之后生成该角色的视频时，自动以这张本地图片转换成 `data:` URL，作为 Seedance 的 `reference_image` 角色参考图提交，而非 `first_frame`。因此设定图只约束人物身份、2D 画风与未明确要求改变的外观，不会强制成为视频第一帧。普通用户和普通场景图都不能覆盖这项全局角色资产。

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
