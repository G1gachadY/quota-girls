/**
 * 统一数据模型 + main/renderer 共享的类型定义。
 * 注意：本文件必须保持"纯类型"（不 import 任何 Node/Electron 模块），renderer 会 import type 它。
 */

export type PlatformId = 'claude' | 'codex' | 'antigravity'

export interface QuotaWindow {
  /** 'five_hour' / 'seven_day' / 'gemini-5h' … */
  id: string
  /** '5小时' / '本周' / '本周·Opus' / 'Gemini·5小时' */
  label: string
  kind: 'session' | 'weekly' | 'model' | 'other'
  /** 0–100，统一换算成"已用" */
  usedPercent: number | null
  /** ISO 时间 */
  resetsAt: string | null
  /** 无数据为 false，UI 显示"—"，不能当成耗尽 */
  known: boolean
}

export type SnapshotStatus =
  | 'ok'
  | 'stale'
  | 'offline'
  | 'auth_expired'
  | 'not_configured'
  | 'error'
  | 'loading'

export type SourceId = 'oauth' | 'web' | 'api' | 'rpc' | 'local-log' | 'local-ls' | 'none'

export interface PlatformSnapshot {
  platform: PlatformId
  status: SnapshotStatus
  /** 实际使用的数据源 */
  source: SourceId | string
  /** 'Max 5x' / 'Plus' / 'AI Pro' */
  plan?: string
  /** 打码邮箱 a***@gmail.com（设置里关闭打码时为原文） */
  account?: string
  windows: QuotaWindow[]
  /** 已格式化文本 */
  extras?: { credits?: string; extraUsage?: string }
  fetchedAt: string
  /** hint 用中文告诉用户怎么修 */
  error?: { message: string; hint: string }
  /** 额外说明，例如"来自最近一次会话" / "暂无数据" */
  note?: string
}

/** 脱敏后的原始响应，供 probe 与设置页"原始响应"面板使用 */
export interface RawEntry {
  label: string
  at: string
  status?: number
  body: unknown
}

export interface ProviderResult {
  snapshot: PlatformSnapshot
  raw: RawEntry[]
}

// ───────────────────────── 设置 ─────────────────────────

export type ClaudeSourcePref = 'auto' | 'oauth' | 'web'
export type CodexSourcePref = 'auto' | 'api' | 'rpc' | 'local-log'
export type AntigravitySourcePref = 'auto'

export interface SourcePrefs {
  claude: ClaudeSourcePref
  codex: CodexSourcePref
  antigravity: AntigravitySourcePref
}

/** 'tightest' = 最紧张的窗口；其它字符串 = 固定某个窗口 id */
export type PrimaryRule = 'tightest' | string

export interface AppSettings {
  /** 刷新间隔（分钟），最小 2 */
  refreshMinutes: number
  primaryRule: Record<PlatformId, PrimaryRule>
  /** 默认显示"剩余"（像血条） */
  displayMode: 'remaining' | 'used'
  /** 文案风格：游戏化（体力 / 后回满） ↔ 标准（剩余额度 / 后重置） */
  copyStyle: 'game' | 'standard'
  /** 提醒阈值：剩余低于该百分比时通知 */
  alertThreshold: number
  notifyLow: boolean
  notifyReset: boolean
  launchAtLogin: boolean
  /** 关闭按钮 = 最小化到托盘 */
  closeToTray: boolean
  maskEmail: boolean
  sources: SourcePrefs
  miniAlwaysOnTop: boolean
  miniPosition?: { x: number; y: number }
}

// ───────────────────────── 历史 ─────────────────────────

/** t = 毫秒时间戳；u = usedPercent；r = 当时的 resetsAt（毫秒） */
export interface HistoryPoint {
  t: number
  u: number
  r?: number
}

/** windowId → points */
export interface HistorySeries {
  windows: Record<string, { label: string; points: HistoryPoint[] }>
}

// ───────────────────────── 插画 ─────────────────────────

export interface ArtManifest {
  name: string
  title: string
  accent: string
  accent2: string
  cardFocus: string
  heroFocus: string
  avatarFocus: string
  /** 差分图的构图焦点（可选，缺省沿用 cardFocus / heroFocus） */
  cardLowFocus?: string
  cardEmptyFocus?: string
  heroLowFocus?: string
  heroEmptyFocus?: string
}

/** 值为 art:// URL（带 ?v= 缓存破坏参数）；缺失的槽位为 undefined */
export interface ArtFiles {
  card?: string
  hero?: string
  avatar?: string
  /** 体力紧张 / 耗尽差分，竖版（角色卡）与横版（详情页）各自可选 */
  cardLow?: string
  cardEmpty?: string
  heroLow?: string
  heroEmpty?: string
}

export interface PlatformArt {
  manifest: ArtManifest
  files: ArtFiles
}

export type ArtState = Record<PlatformId, PlatformArt>

// ───────────────────────── 等价 API 价值 ─────────────────────────

/** 一次请求的 token 用量，已统一口径：input 只算未命中缓存的输入；output 含思考 / 推理 */
export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  /** Claude 5 分钟缓存写入；OpenAI / Gemini 的缓存写入也记在这里 */
  cacheWrite5m: number
  /** Claude 1 小时缓存写入 */
  cacheWrite1h: number
}

/** 本机记录里的一次模型请求 */
export interface UsageEvent extends UsageTokens {
  /** 毫秒时间戳 */
  t: number
  /** 原始模型 ID */
  model: string
  /** 显示名（Antigravity 记录里自带） */
  modelName?: string
  /** Claude 快速模式（价格 2x） */
  fast?: boolean
  /** Claude inference_geo = us（价格 1.1x） */
  geoUs?: boolean
  /** Claude 服务端网页搜索次数（$10 / 千次） */
  webSearches?: number
}

/** 单价，USD / 百万 tokens */
export interface UnitPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export interface ValueModelRow {
  /** 规范化后的模型 ID */
  model: string
  label: string
  /** 官方价目表里有这个模型 */
  priced: boolean
  requests: number
  tokens: UsageTokens
  /** 各项折算金额（USD）；extra = 网页搜索等按次计费 */
  cost: UsageTokens & { extra: number }
  total: number
  /** 最近一次请求生效的单价（已含快速模式等倍率） */
  unit?: UnitPrice
  /** 例如 "部分请求超过 272K，按长上下文价" */
  notes: string[]
}

export interface ValueRange {
  id: 'session' | 'weekly' | 'month'
  label: string
  from: number
  to: number
  total: number
  requests: number
  /** 没有官方价、未计入总额的 tokens */
  unpricedTokens: number
  models: ValueModelRow[]
}

export interface ValueReport {
  platform: PlatformId
  /** 统计口径，如 "Claude Code 本机会话记录" */
  scope: string
  /** 统计不到的部分 */
  caveat?: string
  ranges: ValueRange[]
  scannedAt: string
  /** 扫描到的本地记录文件数（近 30 天内有改动的） */
  files: number
  /** 30 天内最早一条记录 */
  earliest: number | null
  pricingCheckedAt: string
  error?: string
}

// ───────────────────────── IPC ─────────────────────────

export interface AppState {
  snapshots: Record<PlatformId, PlatformSnapshot>
  settings: AppSettings
  refreshing: PlatformId[]
  nextRefreshAt: Record<PlatformId, string | null>
  claudeWebLoggedIn: boolean
  version: string
}

export interface ActionResult {
  ok: boolean
  message: string
}

export interface QuotaAPI {
  getState(): Promise<AppState>
  onState(cb: (state: AppState) => void): () => void
  refresh(platform?: PlatformId): Promise<void>
  getHistory(platform: PlatformId): Promise<HistorySeries>
  getRaw(platform: PlatformId): Promise<RawEntry[]>
  /** 按官方 API 定价折算本机记录里的用量 */
  getValue(platform: PlatformId): Promise<ValueReport>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>

  getArt(): Promise<ArtState>
  onArt(cb: (art: ArtState) => void): () => void
  reloadArt(): Promise<ArtState>
  openArtFolder(): Promise<void>

  claudeLogin(): Promise<void>
  claudeSetSessionKey(key: string): Promise<ActionResult>
  claudeLogout(): Promise<void>

  win: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximized(cb: (maximized: boolean) => void): () => void
  }
  mini: {
    toggle(): void
    showMain(): void
    dragTo(x: number, y: number): void
    close(): void
  }
}
