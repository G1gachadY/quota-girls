# 额度娘 Quota Girls

Windows 桌面程序，用二次元"角色编成"界面同时显示多个 AI 平台的剩余额度：

| 角色 | 平台 | 显示什么 |
| --- | --- | --- |
| NO.01 | **Claude** | 订阅额度（桌面版 / 网页 / Claude Code 共用一份） |
| NO.02 | **Codex** | ChatGPT 订阅额度 |
| NO.03 | **Antigravity** | Google 订阅额度（Gemini 组 / Claude 与 GPT 组 / 单模型限额） |
| NO.04 | **DeepSeek** | 按量付费的账户余额（Key 自动从 CC Switch 读取） |
| NO.05… | **第三方平台** | 设置里自己添加：中转站（New API / One API）、OpenRouter、Kimi、硅基流动、自定义 JSON 接口 |

订阅额度 = 角色"体力"，重置 = "体力回满"；按量付费平台显示余额，低于提醒线时变红并通知。平台超过 3 个时总览页可以横向滚动（滚轮即可），不用的平台可以在设置里隐藏。

> ⚠️ 三个平台的数据接口都是**非官方内部接口**，随时可能改字段或失效。程序对字段缺失做了宽容处理（不会崩溃，只会显示"—"或报错提示），出问题时先运行 `npm run probe` 看原始响应。

---

## 快速开始

需要 Node.js ≥ 20.19，Windows 10/11 x64。

```powershell
npm install
npm run dev        # 开发模式（热更新）
npm run probe      # 在本机实际请求三个平台，打印脱敏后的原始响应与解析结果
npm run typecheck  # 类型检查
npm run dist       # 打包 NSIS 安装包 → release/QuotaGirls-Setup-<版本>.exe
```

如果 `npm install` 之后 `node_modules/electron/dist/electron.exe` 不存在（Electron 的下载脚本没跑或下载失败），手动补一次：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'; node node_modules/electron/install.js
```

`npm run probe` 可以只测一个平台或强制某个数据源：

```powershell
npm run probe -- codex
npm run probe -- codex rpc
npm run probe -- claude web
npm run probe -- deepseek       # DeepSeek 余额（自定义平台用它的 id，如 x-abc123）
npm run probe -- value          # 打印 Claude / Codex / Antigravity 本机用量按官方 API 定价折算的结果
```

开发时如果已安装的正式版正在运行，开发版会因为单实例锁直接退出。设置 `QG_USER_DATA` 用独立的数据目录即可同时运行：

```powershell
$env:QG_USER_DATA = "$env:TEMP\qg-dev"; npm run dev
```

在普通浏览器里打开 `npm run dev` 打印的 renderer 地址（http://localhost:5173）会用**假数据**渲染界面，方便调样式；加 `?scenario=states` / `?scenario=low` / `?scenario=tight` / `?scenario=empty` / `?scenario=loading` 可以看各种状态，`#mini` 是迷你挂件。预览里还有两个演示用的第三方平台（我的中转站、Kimi），只在浏览器预览里出现。插画取自项目 `art/`（开发服务器在 `/__art/` 下提供，仅开发时存在）。

---

## 分阶段验证

| 阶段 | 内容 | 怎么验证 |
| --- | --- | --- |
| 1 | 脚手架、无边框窗口、自绘标题栏、总览页三张卡 | `npm run dev`：1280×800 无边框窗口，标题栏可拖动、双击最大化，— □ × 可用；三张卡依次从下方滑入（间隔 80ms），悬停上浮 + 插画放大 + 强调色描边 |
| 2 | art:// 协议、manifest、占位图、F2 参考线 | 卡片显示 CSS 占位图（强调色斜向渐变 + 斜线纹理 + 巨大首字母 + 虚线安全区说明）。按 **F2** 显示标题区 / 角色区 / 脸部中心 / 数据面板区。往 `art/claude/` 放一张 `card.png`，保存后几秒内自动替换（无需重启） |
| 3 | probe、三个 provider、定时刷新、IPC | `npm run probe` 打印三个平台的原始响应与 `PlatformSnapshot`；`npm run dev` 后卡片显示真实数据，⟳ 立即刷新；Antigravity 未打开时显示"未运行"，打开后约 2 分钟内自动读到 |
| 4 | 详情页、历史折线、过渡动画 | 点击卡片：卡片展开为全屏（clip-path 共享元素过渡）；左侧面板 + 右侧 hero 插画；顶栏切换平台时背景交叉淡化、角色从右侧滑入、数字滚动；折线可切 24H / 7D（数据随刷新逐步积累），重置时刻为竖虚线；Esc 返回，←/→ 切平台 |
| 5 | 设置、Claude 内嵌登录、托盘、通知、迷你挂件 | ⚙ 打开右侧抽屉；"登录 claude.ai"弹出登录窗口，登录成功后自动关闭并刷新；托盘图标悬停显示三平台剩余%，右键菜单可开挂件 / 刷新 / 退出；把提醒阈值调到高于当前剩余即可触发一次通知；标题栏第一个按钮开关迷你挂件（拖动移动，双击回主窗口） |
| 6 | electron-builder 打包 | `npm run dist` 生成 `release/QuotaGirls-Setup-0.1.0.exe`，安装后开始菜单出现"额度娘 Quota Girls" |

---

## 数据源原理

所有凭据读取、网络请求、进程探测都在 **main 进程**完成；renderer 只能拿到脱敏后的数字快照（`window.quota` 由 preload 通过 contextBridge 暴露，`contextIsolation` + `sandbox` 全开），永远拿不到 token / cookie。

### Claude（按顺序自动选择，设置里可指定）

**A. OAuth（首选，需要本机用 claude.ai 账号登录过 Claude Code）**
- 只读 `~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken / expiresAt / subscriptionType / rateLimitTier`（设置了 `CLAUDE_CONFIG_DIR` 时读那里），邮箱从 `~/.claude.json` 的 `oauthAccount.emailAddress` 读。
- `GET https://api.anthropic.com/api/oauth/usage`，头 `Authorization: Bearer …`、`anthropic-beta: oauth-2025-04-20`。
- 每个窗口 `{ utilization: 0–100, resets_at }`：`five_hour`、`seven_day`、`seven_day_opus`、`seven_day_sonnet`、`seven_day_oauth_apps`、`seven_day_cowork`，其它 `seven_day_*` 也当周窗口显示；`extra_usage` 显示在"额外额度"。
- token 过期 / 401 → `auth_expired`，提示"打开一次 Claude Code（终端运行 claude）即可自动续期"。**程序绝不刷新 token**（刷新会让 Claude Code 掉登录）。

**B. 内嵌网页登录（没装 Claude Code，或 Claude Code 用的是 API Key / 第三方中转时）**
- 设置 → "登录 claude.ai"：打开独立分区 `persist:claude-web` 的登录窗口；拿到 `sessionKey` cookie 后自动关闭。
- 取数：同分区的**隐藏窗口**加载 `https://claude.ai`，在页面内 `fetch('/api/organizations')` → 取 capabilities 含 `chat` 的组织 → `fetch('/api/organizations/{uuid}/usage')`（结构同 A）+ 可选 `/api/account`。走真实浏览器环境以通过 Cloudflare，取完立即销毁窗口。
- Google 账号可能拒绝在内嵌窗口里登录 → 用邮箱验证码登录，或用 C。

**C. 手动 sessionKey** — 设置里粘贴 `sk-ant-…`，写入 B 分区的 cookie（`https://claude.ai`、secure、httpOnly），之后走 B。

### Codex（ChatGPT 订阅）

**A. API（首选）** — 只读 `~/.codex/auth.json`（有 `CODEX_HOME` 则读 `$CODEX_HOME/auth.json`）的 `tokens.access_token / account_id`，`id_token` 解码出邮箱和 `chatgpt_plan_type`。`GET https://chatgpt.com/backend-api/wham/usage`（`Authorization`、`ChatGPT-Account-Id`、`User-Agent: codex-cli`）。解析 `rate_limit.primary_window / secondary_window`（`used_percent`、`limit_window_seconds`、`reset_at`）、`code_review_rate_limit`、`additional_rate_limits[]`、`credits`。只有 API Key → `not_configured`（"API Key 计费模式没有订阅额度"）；401 → `auth_expired`（"运行一次 codex 重新登录"）。**不刷新、不改写 auth.json。**

**B. CLI RPC（A 失败时）** — 启动 `codex -s read-only -a never app-server`（经 shell 解析 `codex.cmd`），stdio 逐行 JSON-RPC：`initialize` → `initialized` → `account/rateLimits/read`（+ `account/read` 取邮箱）。实测响应为 `rateLimits.primary/secondary { usedPercent, windowDurationMins, resetsAt(Unix 秒) }` 与 `rateLimitsByLimitId`。15 秒超时后结束整个进程树。

**C. 本地会话日志（离线兜底）** — 扫描 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，取最后一条带 `rate_limits` 的 `token_count` 事件，标 `stale`，界面注明"来自最近一次会话"。已过重置时间的窗口推断为已回满。

### Antigravity（只走本地，绝不使用 Google OAuth）

只有 Antigravity（IDE 或桌面 App）运行时才有数据；未运行时显示上次快照并标"未运行 · x 小时前"。

1. PowerShell `Get-CimInstance Win32_Process` 找 `language_server*` 进程，只保留命令行含 `antigravity` 的。
2. 取 CSRF token 与端口：
   - 旧版：命令行里的 `--csrf_token`、`--extension_server_port`、`--extension_server_csrf_token`；端口用 `Get-NetTCPConnection`（失败退回 `netstat -ano`），逐个 POST `GetUnleashData` 探测，第一个 200 的为目标。
   - **新版（2.x "hub" 模式，本机实测 2.34.0）**：命令行里没有 csrf（改为 `--read_host_bridge_token_from_stdin`）。language server 会写发现文件 `~/.gemini/antigravity/daemon/hub_<port>.json`：`{ pid, httpsPort, httpPort, csrfToken }`，按 pid 匹配正在运行的进程后使用（Antigravity 自带的 sidecar SDK 用的也是这个 token）。
3. 头 `Content-Type: application/json`、`Connect-Protocol-Version: 1`、`X-Codeium-Csrf-Token`，体 `{"metadata":{"ideName":"antigravity",…}}`，依次：
   - `RetrieveUserQuotaSummary` → `response.groups[].buckets[] { bucketId, displayName, window: "5h"|"weekly", remainingFraction, resetTime }`。**窗口 id 直接用 bucketId**（`gemini-5h`、`3p-weekly`、`gemini-argon-wtu-weekly`…）。主组为 "Gemini Models"（→ Gemini）和 "Claude and GPT models"（→ Claude/GPT）；其它组（如 "Gemini 4 Argon" 单模型周限额）kind 记为 `model`。
   - `GetUserStatus` → 邮箱、套餐（`planStatus.planInfo.planName`，"Pro" 显示为 "AI Pro"）；summary 拿不到时用 `cascadeModelConfigData.clientModelConfigs[].quotaInfo` 按模型组取最低剩余。
   - HTTPS 都失败时改用 HTTP 端口（新版为 `httpPort`，旧版为 `extension_server_port` + `extension_server_csrf_token`）。
4. `usedPercent = (1 - remainingFraction) × 100`；`resetTime` 先按 ISO 解析，失败按 Unix 秒。

### DeepSeek（余额）

`GET https://api.deepseek.com/user/balance`（`Authorization: Bearer <key>`）→ `balance_infos[] { currency, total_balance, granted_balance, topped_up_balance }`，优先显示人民币那一项，明细显示充值 / 赠送。`is_available: false` 时提示余额不足。

Key 按顺序找：设置里手动填的 → 环境变量 `DEEPSEEK_API_KEY` → **CC Switch**（`~/.cc-switch/cc-switch.db`，只读）。CC Switch 里只认"成对"的字段：Claude / Gemini 供应商的 `env.ANTHROPIC_BASE_URL`（或 `GOOGLE_GEMINI_BASE_URL`）指向 `api.deepseek.com` 时，取同一份配置里的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`（或 `GEMINI_API_KEY`）。Codex 供应商的配置里地址和 Key 对应关系不明确（还可能含 ChatGPT 登录的 refresh_token），一律不读。

### 第三方平台（设置 → 平台连接 → 添加第三方平台）

| 类型 | 查询 | 需要填 |
| --- | --- | --- |
| 中转站（API Key） | New API / One API 等的 OpenAI 兼容账单接口：`/v1/dashboard/billing/subscription`（额度 `hard_limit_usd`）+ `/v1/dashboard/billing/usage`（已用 `total_usage`，美分） | 地址、令牌 sk-… |
| New API 账户 | `/api/user/self`（头 `New-Api-User`），整个账户的 `quota` / `used_quota`，按 500000 = $1 换算 | 地址、用户 ID、系统访问令牌 |
| OpenRouter | `/api/v1/credits`（失败退回 `/api/v1/key` 的额度上限） | Key |
| Kimi 开放平台 | `api.moonshot.cn/v1/users/me/balance`（现金 / 代金券） | Key |
| 硅基流动 | `api.siliconflow.cn/v1/user/info`（充值 / 赠送） | Key |
| DeepSeek（另一个账号） | 同上面的 DeepSeek | Key |
| 自定义 JSON 接口 | GET 你填的地址，按字段路径取剩余（和总额），如 `data.balance`、`data.items[0].remain` | 地址、字段路径、单位、Key（可空，以 Bearer 发送） |

中转站 / JSON 地址只接受 `https://`（本机的可以用 `http://localhost`）。令牌不限额度时卡片显示已用量。

### 网络

自签名证书**只对 127.0.0.1 放行**（Node https，`rejectUnauthorized: false` 只用在本地请求上）；官方域名走 Electron `net.fetch`（Chromium 网络栈，**自动跟随 Windows 系统代理**，正常校验证书），并且代码里有白名单：订阅平台的 token 只会发往 `api.anthropic.com`、`claude.ai`、`chatgpt.com` 或 `127.0.0.1`；DeepSeek 的 Key 只发往 `api.deepseek.com`；第三方平台的 Key 只发往这个平台自己的域名（官方类型固定为官方域名，中转站 / JSON 为你填的地址），请求禁止重定向。

---

## 等价 API 价值

详情页的"等价 API 价值"一栏：把这台电脑上记录到的用量，按各家**官方 API 标准价**折算成美元，看订阅帮你省下了多少。可切换 **本 5 小时周期 / 本周周期 / 近 30 天**（周期按额度窗口的重置时间对齐；没有窗口数据时退化为近 5 小时 / 近 7 天）。点开某个模型能看到明细：输入、输出、缓存写入、缓存读取各多少 tokens × 单价 = 多少钱。

**用量从哪来**（只读，增量扫描：只读文件新增的部分，30 天内没改过的文件不碰）：

| 平台 | 本机记录 | 统计不到的 |
| --- | --- | --- |
| Claude | `~/.claude/projects/**/*.jsonl`（Claude Code 会话，含子代理；也认 `CLAUDE_CONFIG_DIR`）。每条消息的 `message.usage`，按 `message.id + requestId` 去重 | Claude 桌面版 / 网页版 / 手机端对话不留本地记录 |
| Codex | `~/.codex/sessions`、`archived_sessions` 下的 `rollout-*.jsonl`（也认 `CODEX_HOME`）。新版用每次请求一条的 `token_usage_record`（按 `response_id` 去重），旧版退回 `token_count` 事件 | Codex 云端任务、ChatGPT 网页对话 |
| Antigravity | `~/.gemini/antigravity/conversations/*.db`（SQLite，Electron 自带的 `node:sqlite` 只读打开）。`gen_metadata` 里每次生成的模型、输入 / 输出 / 缓存 tokens，时间取自 `steps` 表 | 其他电脑上的对话 |

**怎么折算**：

- 价目表在 `src/shared/pricing.ts`，2026-11-22 按官方页面核对：[Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)、[OpenAI](https://developers.openai.com/api/docs/pricing)、[Google Gemini API](https://ai.google.dev/gemini-api/docs/pricing)。用标准价（非 Batch），不含订阅折扣与税费。
- Claude：缓存写入分 5 分钟（1.25× 输入价）和 1 小时（2× 输入价）；缓存读取按官方表（Opus 5.5 / Sonnet 5.5 为 0.05×，Fable 5.2 / 5.1 为 0.025×，其余 0.1×）；快速模式全部单价 ×2；`inference_geo: us` ×1.1；网页搜索 $10 / 千次；Haiku 5.5 单次提示超过 10 万 tokens 用高价档。
- OpenAI：`input_tokens` 里包含缓存命中的部分，拆开后分别按输入价和缓存价算；单次输入超过 272K 按长上下文价。
- Gemini：输出价含思考 tokens；Gemini 4 Argon / Carbon 在 2026-12-01、Gemini 3.8 / 3.6 Flash 在 2027-01-01 涨价，按请求发生时生效的价格算。
- 明细里的单价是该模型**最近一次请求**生效的单价；金额是逐次请求按当时价格累加的。
- 价目表里没有的模型（例如 `codex-auto-review`）显示"无公开定价"，token 照常列出，不计入总额。

**补充或覆盖价格**：新建 `%APPDATA%\QuotaGirls\pricing.json`（USD / 百万 tokens，`match` 是匹配模型 ID 的正则，写在这里的条目优先于内置价目表，保存后下次打开详情页生效）：

```json
{
  "models": [
    { "match": "codex-auto-review", "label": "Codex Auto Review", "input": 2, "output": 10, "cacheRead": 0.1, "cacheWrite": 2.5 }
  ]
}
```

---

## 安全与隐私

- 只读原则：不刷新、不改写、不复制任何平台的凭据文件；不调用任何"消耗 / 兑换"类接口。
- 原始响应面板、probe 输出、日志里的 token / cookie / 邮箱 / UUID 一律打码。界面上的邮箱默认打码（设置可关）。
- IPC 只接受来自本程序页面的调用；应用窗口禁止导航到外部页面、默认拒绝一切权限请求。
- 等价 API 价值只**读**本机用量记录（Claude Code / Codex 的 JSONL 会话记录、Antigravity 的对话数据库，SQLite 只读打开），只提取模型名、时间和 token 数，不保存也不传出对话内容；价目表内置在程序里，不联网。
- DeepSeek 和第三方平台的 Key 用 Electron `safeStorage`（Windows DPAPI，绑定当前 Windows 账户）加密后存在 `%APPDATA%\QuotaGirls\secrets.json`，只在后台进程里解密使用，界面只知道"有没有 Key、从哪来"。删除平台时一并删除它的 Key。
- 无任何遥测。数据保存在 `%APPDATA%\QuotaGirls\`：`settings.json`、`history.json`（7 天，5 分钟一个点）、`snapshots.json`（上次快照）、`notified.json`（通知去重）。网页登录的 cookie 在同目录 `Partitions\claude-web`，设置里"退出网页登录"会清除。

---

## 换插画

插画放在 `art/<platform>/`（platform = `claude` | `codex` | `antigravity` | `deepseek`；第三方平台的目录名是它的 id，如 `x-abc123`，占位图上会写出完整路径）。项目里已经放好前三位角色的整套插画（常态 + 体力紧张 + 体力耗尽，webp 格式）；DeepSeek 和第三方平台暂时是带官方图标（或首字母）的占位图。余额平台的"紧张 / 耗尽"按余额判断：低于提醒线（或剩余不到总额 20%）为紧张，用完为耗尽。

| 文件 | 尺寸 | 必需 | 用途 |
| --- | --- | --- | --- |
| `card.png` | 1024×1536（2:3） | ✔ | 总览页角色卡 |
| `hero.png` | 1536×1024（3:2） | ✔ | 详情页全屏背景 |
| `avatar.png` | 1024×1024 | | 迷你挂件头像；缺失时以 `avatarFocus` 为脸部中心从 card 裁一块 |
| `card-low.png` / `hero-low.png` | 竖版 / 横版 | | 体力紧张（主额度剩余 <20%）差分 |
| `card-empty.png` / `hero-empty.png` | 竖版 / 横版 | | 体力耗尽差分 |
| `manifest.json` | | | `name`、`title`、`accent`、`accent2`、`cardFocus`、`heroFocus`、`avatarFocus`，可选 `cardLowFocus`、`cardEmptyFocus`、`heroLowFocus`、`heroEmptyFocus` |

也支持 `.webp / .jpg / .jpeg`（同一目录里同名多种格式时 png > webp > jpg）。`*Focus` 就是 CSS `object-position`（例如 `"50% 22%"`），换图后只改 manifest 调位置，不改代码。

**差分怎么选**（只画一种方向也行，另一处会自动借用）：

| 状态 | 角色卡用 | 详情页用 |
| --- | --- | --- |
| 常态 | `card` → 没有就用 `hero` 按焦点裁成竖版 | `hero` → 没有就把 `card` 整幅靠右显示，背后用同图虚化铺满 |
| 体力紧张 | `card-low` → `hero-low`（裁） → 常态图 + 偏暗暖色滤镜 + 红色暗角 | `hero-low` → `card-low`（靠右整幅） → 常态图 + 滤镜 |
| 体力耗尽 | `card-empty` → `hero-empty`（裁） → 常态图 + 灰度 | `hero-empty` → `card-empty`（靠右整幅） → 常态图 + 灰度 |

横版图裁进角色卡时只有横向焦点起作用（例如 `"heroLowFocus": "88% 30%"` 把画面右侧的角色移进卡里）。有耗尽差分时，"体力耗尽"印章缩小放在数据面板上方右侧，不挡角色的脸；没有差分时仍是居中大印章。

浏览器预览（`npm run dev` 后在浏览器打开 http://localhost:5173）也会读项目 `art/` 里的插画；`?scenario=tight` / `?scenario=empty` 让三位同时处于紧张 / 耗尽状态，方便检查差分构图。

**构图安全区**（界面严格按此布局，按 F2 可叠加参考线检查）：
- `card.png`：顶部 0–10% 为标题区（叠暗色渐变）；10–58% 为角色脸与上半身，脸部中心约在高度 22–30%；58–100% 被数据玻璃面板覆盖。
- `hero.png`：左侧 0–45% 为数据面板区（这里只放虚化环境）；右侧 45–100% 为角色，脸部中心约 x=68%、y=30%；顶部 0–8% 为顶栏。

**放哪里：**
- 开发时：项目根目录 `art/`。
- 安装版：设置 →"打开插画文件夹"（`%APPDATA%\QuotaGirls\art\`）。这里的文件**逐个**优先于安装包内置的版本，缺的自动回退。
- 文件夹被监听，保存后自动刷新；也可以点"重新载入插画"。无需重启。

---

## 平台官方图标

卡片标题、详情页标题、顶栏平台切换、设置、迷你挂件（头像右下角徽章）、占位图水印、托盘菜单和 Windows 通知都使用各平台的官方图标。素材取自本机已安装的官方发行包：

| 平台 | 来源 | 项目里的文件 |
| --- | --- | --- |
| Claude | Anthropic「Claude Code」VS Code 扩展 `resources/claude-logo.svg` / `.png` | `src/renderer/src/assets/platforms/claude.svg`、`resources/platforms/claude.png` |
| Codex | OpenAI「Codex」VS Code 扩展 `webview/assets/codex-app-ga-logo-*.png`；大图水印用 `codex-home-hero-dark-still-*.png`（黑底转为透明） | `codex.png`、`codex-large.png`、`resources/platforms/codex.png` |
| Antigravity | Antigravity 桌面 App `app.asar` 里的 `icon.png`；界面内去掉白色圆角底板只保留拱形标志，通知 / 托盘用原图 | `antigravity.png`、`resources/platforms/antigravity.png` |
| DeepSeek | DeepSeek 官方 GitHub 组织 deepseek-ai 的头像（460px）；界面内白底转透明，通知 / 托盘用原图 | `deepseek.png`、`resources/platforms/deepseek.png` |
| OpenRouter / Kimi / 硅基流动 | 各自官方 GitHub 组织（OpenRouterTeam / MoonshotAI / siliconflow）的头像；硅基流动白底转透明 | `openrouter.jpg`、`moonshot.jpg`、`siliconflow.png` |

中转站、New API、自定义 JSON 接口没有统一的官方图标，显示名称首字母。

图标商标归各自所有者，这里仅用于标识对应平台。要换图标直接替换上述文件（界面内的放 `src/renderer/src/assets/platforms/`，通知 / 托盘的放 `resources/platforms/`，PNG 建议 ≥128px）。

---

## 打包

```powershell
npm run dist
```

- 先做类型检查和 `electron-vite build`，再由 `scripts/dist.mjs` 调用 electron-builder 生成 `release/QuotaGirls-Setup-<版本>.exe`（NSIS，可选安装目录，创建桌面与开始菜单快捷方式）。
- 默认用 npmmirror 镜像下载 Electron 与 NSIS 等构建工具；要用官方源可先设置 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 环境变量覆盖。
- 没有代码签名证书，安装时 Windows SmartScreen 可能提示"未知发布者"，点"仍要运行"。
- 改图标：替换 `build/icon.png`（≥256×256）与 `resources/` 下的托盘图标，或改 `scripts/gen-icons.mjs` 后运行 `npm run icons`。

---

## 实现中的取舍（不确定处选了最简单可行的方案）

- **项目位置**：工作目录里已有别的 H5 项目，为不覆盖它，本项目建在子目录 `quota-girls/`。
- **probe 在 Electron 里运行**：`scripts/probe.ts` 作为额外的 main 入口打包，用 `electron out/main/probe.js` 运行，这样和应用走同一套网络栈（系统代理、证书校验），Claude 网页数据源也能测。
- **Antigravity 新版发现文件**：规格里的命令行参数在 2.x hub 模式下已经不存在，所以加了读 `~/.gemini/antigravity/daemon/hub_*.json` 的路径（只读、只发往 127.0.0.1）。旧版命令行方式仍保留。
- **Antigravity 缺 `remainingFraction`**：按规格标 `known: false`（显示"—"）。注意 protobuf JSON 会省略值为 0 的字段，所以真正耗尽时也可能表现为缺字段。
- **Antigravity"全部 100% 且无法确认"**：定义为"所有已知窗口都是 0% 已用，并且都没有重置时间"，此时全部标为未知并显示"暂无数据"。实测满额时也带 `resetTime`，所以正常满额会照常显示。
- **Claude `extra_usage` 单位**：按美分格式化成美元（`$x.xx`），未实测（本机 Claude Code 没有 claude.ai OAuth 登录），以 probe 为准。
- **重置时间已过**：界面立即把该窗口视为已回满（倒计时显示"已回满"），不用等下一次刷新。
- **回满通知**：只在重置前剩余 ≤50% 的窗口回满时提醒，避免每 5 小时都打扰；低额度提醒按"窗口 + 重置周期"去重，重启后不会重复。
- **主额度**：默认"最紧张的窗口"，也就是 known 窗口里已用最高的（Antigravity 的单模型周限额也参与比较）；设置里每个平台可固定某个窗口。
- **迷你挂件拖动**：用 JS 指针事件 + IPC 移动窗口（而不是 `-webkit-app-region: drag`），这样双击事件才能到达页面，用于"双击打开主窗口"。挂件是透明窗口 + 半透明深色背景（Electron 透明窗口里 backdrop-filter 无法模糊桌面）。
- **开机自启**：只在安装版里生效（开发模式注册的会是 electron.exe）；自启时带 `--hidden` 只进托盘。
- **关闭按钮**：默认"最小化到托盘"；关闭此项后点 × 会退出程序。
- **刷新**：默认 5 分钟（最小 2 分钟）；429/5xx 退避为 间隔×2ⁿ，最长 30 分钟；Antigravity 未运行时每 2 分钟复查一次；手动刷新同一平台 15 秒内只生效一次。窗口隐藏时照常刷新。
- **等价 API 价值的统计窗口**：只看近 30 天（再往前的记录不扫描，保证打开详情页时快）；同一平台 20 秒内重复打开不重新扫描。实测本机 Claude Code 108 MB 记录首次扫描约 0.3 秒，Codex 574 MB 约 0.7 秒，之后只读新增部分。
- **Codex 恢复的会话**：恢复后累计用量从旧值继续，所以不能用累计值，改用逐次请求的记录；在第一条 `turn_context` 之前出现的请求，记到之后第一次出现的模型上。
- **新增平台的范围**：DeepSeek 做成内置平台（本机 CC Switch 里配置了它）；阿里云百炼 Token Plan 没有用套餐 Key 查剩余 Credits 的公开接口（官方 CLI 要阿里云 AccessKey，套餐条款也禁止把套餐 Key 用在自动化脚本里），所以没做；Gemini CLI 查额度要用 Google OAuth，和"不碰 Google OAuth"的原则冲突，也没做。其它平台用"第三方平台"自己添加。
- **DeepSeek 没有等价 API 价值**：它本来就是按量付费，余额就是真实花费；而且开发时访问不到 DeepSeek 文档核对最新价格，不在没核实的价格上折算。
- **等价 API 价值只算走订阅的请求**：用 CC Switch 把 Claude Code / Codex 切到 DeepSeek、百炼等第三方时，本机记录里会出现别家的模型；Claude 只算 `claude-*` 模型，Codex 排除 DeepSeek / Qwen / GLM / Kimi 等第三方模型。
- **余额平台没有历史曲线**：历史只记录额度窗口的百分比；余额平台的详情页显示余额明细。
- **Codex 主题色**：按规格 `accent` = 冷白 #E8EAED、`accent2` = 薄荷绿 #10A37F；想让环形进度变绿可在 manifest 里互换。

---

## 目录结构

```
src/main/index.ts              窗口、托盘、IPC、通知接线
src/main/scheduler.ts          定时调度、退避、失败保留上次快照
src/main/notify.ts             Windows 通知（低额度 / 回满）
src/main/providers/types.ts    统一数据模型（main / renderer 共享）
src/main/providers/claude.ts   Claude：OAuth / 网页 / sessionKey
src/main/providers/codex.ts    Codex：API / CLI RPC / 本地日志
src/main/providers/antigravity.ts  Antigravity：本地 language server
src/main/claude-web.ts         Claude 内嵌登录窗口与隐藏取数窗口
src/main/net.ts                网络层（域名白名单、仅 127.0.0.1 放行自签名）
src/main/store.ts              设置 + 历史 + 快照缓存（JSON）
src/main/art.ts                art:// 协议、目录监听
src/main/art-scan.ts           插画槽位扫描与 manifest 解析（main 与开发服务器共用）
src/main/providers/balance.ts  DeepSeek 与第三方平台的余额查询
src/main/providers/cc-switch.ts 只读 CC Switch 配置，按域名找成对的 Key
src/main/secrets.ts            用户填写的 Key（safeStorage 加密）
src/main/util.ts               脱敏、打码、宽容取值
src/main/usage/                本机用量记录扫描（Claude Code / Codex / Antigravity）与等价 API 价值汇总
src/shared/quota.ts            共享纯逻辑：平台注册表、第三方平台类型、主额度选择、余额、倒计时格式、文案
src/shared/pricing.ts          官方 API 价目表与折算逻辑
src/preload/index.ts           contextBridge 暴露 window.quota
src/renderer/                  React 界面（总览 / 详情 / 设置 / 迷你挂件）
art/                           插画槽位与 manifest
scripts/probe.ts               原始响应探测
scripts/dist.mjs               打包脚本（镜像设置）
scripts/gen-icons.mjs          生成应用与托盘图标
```
