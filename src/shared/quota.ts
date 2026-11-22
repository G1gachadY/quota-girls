/**
 * main 与 renderer 共用的纯逻辑：平台元信息、默认设置、主额度选择、时间格式化。
 * 不得 import 任何 Node / Electron / DOM 模块。
 */
import type {
  AppSettings,
  ArtManifest,
  Balance,
  BuiltinId,
  CustomKind,
  CustomPlatform,
  PlatformId,
  PlatformInfo,
  PlatformSnapshot,
  QuotaWindow
} from '../main/providers/types'

// ───────────────────────── 平台注册表 ─────────────────────────

export const BUILTIN_IDS: BuiltinId[] = ['claude', 'codex', 'antigravity', 'deepseek']

export const BUILTIN_META: Record<BuiltinId, { name: string; en: string; value: boolean }> = {
  claude: { name: 'Claude', en: 'CLAUDE', value: true },
  codex: { name: 'Codex', en: 'CODEX', value: true },
  antigravity: { name: 'Antigravity', en: 'ANTIGRAVITY', value: true },
  deepseek: { name: 'DeepSeek', en: 'DEEPSEEK', value: false }
}

export function isBuiltin(id: string): id is BuiltinId {
  return (BUILTIN_IDS as string[]).includes(id)
}

export interface CustomKindInfo {
  label: string
  /** 用户要填的地址；null = 固定用官方地址 */
  url: null | { label: string; placeholder: string }
  /** 官方地址的域名（固定地址的类型） */
  host?: string
  needsUserId?: boolean
  needsPaths?: boolean
  keyLabel: string
  accent: string
  hint: string
}

/** 自定义第三方平台的类型 */
export const CUSTOM_KINDS: Record<CustomKind, CustomKindInfo> = {
  'openai-billing': {
    label: '中转站（API Key）',
    url: { label: '中转站地址', placeholder: 'https://api.example.com' },
    keyLabel: 'API Key（sk-…）',
    accent: '#7C8BFF',
    hint: '适用于 New API / One API 等中转站：用令牌的 /v1/dashboard/billing 接口查额度和已用量'
  },
  newapi: {
    label: 'New API 账户',
    url: { label: '站点地址', placeholder: 'https://api.example.com' },
    needsUserId: true,
    keyLabel: '系统访问令牌（个人设置 → 安全设置）',
    accent: '#22C1A0',
    hint: '查整个账户的余额：/api/user/self，需要系统访问令牌和用户 ID（按 500000 = $1 换算）'
  },
  openrouter: {
    label: 'OpenRouter',
    url: null,
    host: 'openrouter.ai',
    keyLabel: 'API Key（sk-or-…）',
    accent: '#9CE14B',
    hint: '官方接口 /api/v1/credits（失败时退回 /api/v1/key 的额度上限）'
  },
  moonshot: {
    label: 'Kimi 开放平台',
    url: null,
    host: 'api.moonshot.cn',
    keyLabel: 'API Key',
    accent: '#E6E8EC',
    hint: '官方接口 /v1/users/me/balance（人民币）'
  },
  siliconflow: {
    label: '硅基流动',
    url: null,
    host: 'api.siliconflow.cn',
    keyLabel: 'API Key',
    accent: '#7C3AED',
    hint: '官方接口 /v1/user/info（人民币）'
  },
  deepseek: {
    label: 'DeepSeek（另一个账号）',
    url: null,
    host: 'api.deepseek.com',
    keyLabel: 'API Key',
    accent: '#4D6BFE',
    hint: '官方接口 /user/balance；内置的 DeepSeek 卡片会自动读 CC Switch，这里用于第二个账号'
  },
  json: {
    label: '自定义 JSON 接口',
    url: { label: '查询地址（完整 URL）', placeholder: 'https://api.example.com/v1/balance' },
    needsPaths: true,
    keyLabel: 'Key（以 Bearer 方式发送，可留空）',
    accent: '#F5B544',
    hint: 'GET 这个地址，按字段路径取剩余（和总额）；Key 只会发往这个地址的域名'
  }
}

export const CUSTOM_ID_RE = /^x-[a-z0-9]{4,24}$/
const COLOR_RE = /^#[0-9a-f]{6}$/i
const PATH_RE = /^[A-Za-z0-9_$.[\]-]{1,120}$/

/** 自定义地址只接受 https，或者本机的 http（localhost / 127.0.0.1） */
export function normalizeCustomUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
    if (u.username || u.password) return null
    return u.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function normalizeCustom(x: unknown): CustomPlatform | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const id = typeof o.id === 'string' && CUSTOM_ID_RE.test(o.id) ? o.id : null
  const kind = typeof o.kind === 'string' && o.kind in CUSTOM_KINDS ? (o.kind as CustomKind) : null
  if (!id || !kind) return null
  const info = CUSTOM_KINDS[kind]
  const baseUrl = info.url ? normalizeCustomUrl(o.baseUrl) : ''
  if (info.url && !baseUrl) return null
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const path = (v: unknown) => (typeof v === 'string' && PATH_RE.test(v.trim()) ? v.trim() : undefined)
  if (info.needsPaths && !path(o.remainingPath)) return null
  return {
    id,
    kind,
    name: str(o.name, 24) || info.label,
    baseUrl: baseUrl ?? '',
    userId: info.needsUserId ? str(o.userId, 40) || undefined : undefined,
    remainingPath: info.needsPaths ? path(o.remainingPath) : undefined,
    totalPath: info.needsPaths ? path(o.totalPath) : undefined,
    unit: info.needsPaths ? str(o.unit, 8) || undefined : undefined,
    accent: typeof o.accent === 'string' && COLOR_RE.test(o.accent) ? o.accent : info.accent
  }
}

export function newCustomId(): string {
  return 'x-' + Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

/** 全部平台（内置在前，自定义按添加顺序），编号连续 */
export function platformList(
  settings: AppSettings,
  extra?: (id: PlatformId) => Partial<PlatformInfo>
): PlatformInfo[] {
  const hidden = new Set(settings.hidden)
  const base: Omit<PlatformInfo, 'no' | 'hidden'>[] = [
    ...BUILTIN_IDS.map((id) => ({
      id,
      name: BUILTIN_META[id].name,
      en: BUILTIN_META[id].en,
      builtin: true,
      kind: id,
      value: BUILTIN_META[id].value
    })),
    ...settings.customPlatforms.map((c) => ({
      id: c.id,
      name: c.name,
      en: c.name,
      builtin: false,
      kind: c.kind,
      value: false
    }))
  ]
  return base.map((p, i) => ({
    ...p,
    no: String(i + 1).padStart(2, '0'),
    hidden: hidden.has(p.id),
    ...(extra?.(p.id) ?? {})
  }))
}

export const DEFAULT_MANIFESTS: Record<BuiltinId, ArtManifest> = {
  claude: {
    name: '克劳蒂亚',
    title: '陶土与书卷的执笔者',
    accent: '#D97757',
    accent2: '#F3E6D3',
    cardFocus: '50% 22%',
    heroFocus: '70% 30%',
    avatarFocus: '50% 18%'
  },
  codex: {
    name: '柯黛克丝',
    title: '终端深处的冷静黑客',
    accent: '#E8EAED',
    accent2: '#10A37F',
    cardFocus: '50% 22%',
    heroFocus: '70% 30%',
    avatarFocus: '50% 18%'
  },
  antigravity: {
    name: '安缇·格拉维',
    title: '失重星海的漂流者',
    accent: '#4285F4',
    accent2: '#FBBC05',
    cardFocus: '50% 22%',
    heroFocus: '70% 30%',
    avatarFocus: '50% 18%'
  },
  deepseek: {
    name: '迪普希珂',
    title: '深海鲸歌的寻径者',
    accent: '#4D6BFE',
    accent2: '#A9B8FF',
    cardFocus: '50% 22%',
    heroFocus: '70% 30%',
    avatarFocus: '50% 18%'
  }
}

/** 默认 manifest：内置平台用上面的；自定义平台用它的名字和颜色 */
export function defaultManifest(id: PlatformId, settings?: AppSettings): ArtManifest {
  if (isBuiltin(id)) return DEFAULT_MANIFESTS[id]
  const c = settings?.customPlatforms.find((x) => x.id === id)
  const accent = c?.accent ?? '#7C8BFF'
  return {
    name: c?.name ?? '第三方平台',
    title: c ? CUSTOM_KINDS[c.kind].label : '自定义平台',
    accent,
    accent2: accent,
    cardFocus: '50% 22%',
    heroFocus: '70% 30%',
    avatarFocus: '50% 18%'
  }
}

export const DEFAULT_LOW_BALANCE = 5

export const DEFAULT_SETTINGS: AppSettings = {
  refreshMinutes: 5,
  primaryRule: { claude: 'tightest', codex: 'tightest', antigravity: 'tightest' },
  customPlatforms: [],
  hidden: [],
  lowBalance: {},
  displayMode: 'remaining',
  copyStyle: 'game',
  alertThreshold: 20,
  notifyLow: true,
  notifyReset: true,
  launchAtLogin: false,
  closeToTray: true,
  maskEmail: true,
  sources: { claude: 'auto', codex: 'auto', antigravity: 'auto' },
  miniAlwaysOnTop: true
}

export const MIN_REFRESH_MINUTES = 2

export function normalizeSettings(input: Partial<AppSettings> | undefined): AppSettings {
  const s: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(input ?? {}),
    primaryRule: { ...DEFAULT_SETTINGS.primaryRule, ...(input?.primaryRule ?? {}) },
    sources: { ...DEFAULT_SETTINGS.sources, ...(input?.sources ?? {}) }
  }
  const mins = Number(s.refreshMinutes)
  s.refreshMinutes = Number.isFinite(mins) ? Math.min(120, Math.max(MIN_REFRESH_MINUTES, Math.round(mins))) : 5
  const th = Number(s.alertThreshold)
  s.alertThreshold = Number.isFinite(th) ? Math.min(90, Math.max(1, Math.round(th))) : 20
  if (s.displayMode !== 'used') s.displayMode = 'remaining'
  if (s.copyStyle !== 'standard') s.copyStyle = 'game'

  const seen = new Set<string>()
  const customs: CustomPlatform[] = []
  for (const raw of Array.isArray(input?.customPlatforms) ? input.customPlatforms : []) {
    const c = normalizeCustom(raw)
    if (c && !seen.has(c.id) && customs.length < 24) {
      seen.add(c.id)
      customs.push(c)
    }
  }
  s.customPlatforms = customs
  const ids = new Set<string>([...BUILTIN_IDS, ...customs.map((c) => c.id)])
  s.hidden = (Array.isArray(input?.hidden) ? input.hidden : []).filter(
    (x): x is string => typeof x === 'string' && ids.has(x)
  )
  const lb: Record<string, number> = {}
  for (const [k, v] of Object.entries(input?.lowBalance ?? {})) {
    const n = Number(v)
    if (ids.has(k) && Number.isFinite(n) && n >= 0) lb[k] = Math.min(1e7, n)
  }
  s.lowBalance = lb
  return s
}

export function lowBalanceOf(settings: AppSettings, id: PlatformId): number {
  return settings.lowBalance[id] ?? DEFAULT_LOW_BALANCE
}

// ───────────────────────── 余额 ─────────────────────────

/** 知道总额时：剩余 / 总额 的百分比 */
export function balancePercent(b: Balance | undefined): number | null {
  if (!b || b.amount == null || !b.total || b.total <= 0) return null
  return clamp((b.amount / b.total) * 100, 0, 100)
}

export function balanceLevel(b: Balance, low: number): Level {
  if (b.amount == null) return 'good'
  if (b.amount <= 0) return 'empty'
  if (low > 0 && b.amount < low) return 'low'
  const pct = balancePercent(b)
  if (pct != null && pct < 20) return 'low'
  return 'good'
}

const CURRENCY_SIGN: Record<string, string> = { CNY: '¥', RMB: '¥', USD: '$' }

export function formatMoney(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = CURRENCY_SIGN[currency.toUpperCase()]
  const abs = Math.abs(v)
  const num = abs >= 10000 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2)
  const text = sign ? `${sign}${num}` : `${num}${currency ? ' ' + currency : ''}`
  return v < 0 ? `-${text}` : text
}

// ───────────────────────── 额度逻辑 ─────────────────────────

/** 若 resetsAt 已过，窗口必然已重置：推断为 0% 已用（"体力回满"）。 */
export function effectiveWindow(w: QuotaWindow, now: number): QuotaWindow & { inferredReset?: boolean } {
  if (w.known && w.resetsAt) {
    const t = Date.parse(w.resetsAt)
    if (Number.isFinite(t) && t <= now) {
      return { ...w, usedPercent: 0, resetsAt: null, inferredReset: true }
    }
  }
  return w
}

export function knownWindows(s: PlatformSnapshot | undefined, now = Date.now()): QuotaWindow[] {
  if (!s) return []
  return s.windows.map((w) => effectiveWindow(w, now)).filter((w) => w.known && w.usedPercent != null)
}

/** 主额度：设置里固定的窗口（存在且 known 时），否则 known 窗口里 usedPercent 最高的那个。 */
export function pickPrimary(
  s: PlatformSnapshot | undefined,
  rule: string | undefined,
  now = Date.now()
): QuotaWindow | null {
  if (!s) return null
  const all = s.windows.map((w) => effectiveWindow(w, now))
  if (rule && rule !== 'tightest') {
    const fixed = all.find((w) => w.id === rule && w.known && w.usedPercent != null)
    if (fixed) return fixed
  }
  const known = all.filter((w) => w.known && w.usedPercent != null)
  if (known.length === 0) return all[0] ?? null
  return known.reduce((a, b) => ((b.usedPercent ?? 0) > (a.usedPercent ?? 0) ? b : a))
}

export function remainingOf(w: QuotaWindow | null | undefined): number | null {
  if (!w || !w.known || w.usedPercent == null) return null
  return clamp(100 - w.usedPercent, 0, 100)
}

export type Level = 'good' | 'warn' | 'low' | 'empty' | 'unknown'

export function levelOf(remaining: number | null): Level {
  if (remaining == null) return 'unknown'
  if (remaining <= 0.5) return 'empty'
  if (remaining < 20) return 'low'
  if (remaining < 50) return 'warn'
  return 'good'
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// ───────────────────────── 时间格式化 ─────────────────────────

/** >24h "x天x时"；否则 "x时x分"；<1h "x分x秒" */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0分0秒'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (totalSec >= 86400) return `${d}天${h}时`
  if (totalSec >= 3600) return `${h}时${m}分`
  return `${m}分${s}秒`
}

export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}小时前`
  return `${Math.floor(h / 24)}天前`
}

export function formatClock(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 人性化时长：18000 → '5小时'，604800 → '本周'，其它 → 'x天' / 'x小时' / 'x分钟' */
export function windowLabelFromSeconds(sec: number | null | undefined): { label: string; kind: QuotaWindow['kind'] } {
  if (!sec || !Number.isFinite(sec)) return { label: '额度', kind: 'other' }
  if (Math.abs(sec - 18000) < 60) return { label: '5小时', kind: 'session' }
  if (Math.abs(sec - 604800) < 3600) return { label: '本周', kind: 'weekly' }
  if (sec % 86400 === 0) return { label: `${sec / 86400}天`, kind: sec >= 604800 ? 'weekly' : 'other' }
  if (sec % 3600 === 0) return { label: `${sec / 3600}小时`, kind: 'session' }
  if (sec >= 3600) return { label: `${(sec / 3600).toFixed(1)}小时`, kind: 'session' }
  return { label: `${Math.round(sec / 60)}分钟`, kind: 'session' }
}

// ───────────────────────── 文案 ─────────────────────────

export interface Copy {
  stamina: string
  staminaEn: string
  resetSuffix: string
  resetDone: string
  exhausted: string
  usedLabel: string
  char: (name: string) => string
}

export function copyFor(style: AppSettings['copyStyle']): Copy {
  return style === 'standard'
    ? {
        stamina: '剩余额度',
        staminaEn: 'REMAINING',
        resetSuffix: '后重置',
        resetDone: '已重置',
        exhausted: '额度耗尽',
        usedLabel: '已用额度',
        char: (n) => n
      }
    : {
        stamina: '体力',
        staminaEn: 'STAMINA',
        resetSuffix: '后回满',
        resetDone: '已回满',
        exhausted: '体力耗尽',
        usedLabel: '已消耗',
        char: (n) => `${n} 酱`
      }
}
