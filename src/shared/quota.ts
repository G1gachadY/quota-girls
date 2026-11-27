/**
 * main 与 renderer 共用的纯逻辑：平台元信息、默认设置、主额度选择、时间格式化。
 * 不得 import 任何 Node / Electron / DOM 模块。
 */
import type {
  AppSettings,
  ArtManifest,
  Balance,
  BalancePoint,
  BalanceStats,
  BuiltinId,
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
  deepseek: { name: 'DeepSeek', en: 'DEEPSEEK', value: true }
}

export function isBuiltin(id: string): id is BuiltinId {
  return (BUILTIN_IDS as string[]).includes(id)
}

/** 全部平台，编号连续 */
export function platformList(
  settings: AppSettings,
  extra?: (id: PlatformId) => Partial<PlatformInfo>
): PlatformInfo[] {
  const hidden = new Set(settings.hidden)
  return BUILTIN_IDS.map((id, i) => ({
    id,
    name: BUILTIN_META[id].name,
    en: BUILTIN_META[id].en,
    kind: id,
    value: BUILTIN_META[id].value,
    no: String(i + 1).padStart(2, '0'),
    hidden: hidden.has(id),
    ...(extra?.(id) ?? {})
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

/** 默认 manifest */
export function defaultManifest(id: PlatformId): ArtManifest {
  return isBuiltin(id) ? DEFAULT_MANIFESTS[id] : DEFAULT_MANIFESTS.deepseek
}

export const DEFAULT_LOW_BALANCE = 2

export const DEFAULT_SETTINGS: AppSettings = {
  refreshMinutes: 5,
  primaryRule: { claude: 'tightest', codex: 'tightest', antigravity: 'tightest' },
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

  const ids = new Set<string>(BUILTIN_IDS)
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

/** [from, to] 区间内余额下降的总和（上升视为充值，不算消耗） */
export function spentBetween(points: BalancePoint[], from: number, to: number): { spent: number; topUps: number } {
  let spent = 0
  let topUps = 0
  for (let i = 1; i < points.length; i++) {
    const cur = points[i]
    if (cur.t <= from || cur.t > to) continue
    const d = points[i - 1].a - cur.a
    if (d > 0) spent += d
    else if (d < 0) topUps -= d
  }
  return { spent, topUps }
}

const DAY = 86400 * 1000

export function balanceStats(points: BalancePoint[], now: number, amount: number | null): BalanceStats {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const today = spentBetween(points, midnight.getTime(), now).spent
  const from = now - 7 * DAY
  const week = spentBetween(points, from, now)
  const first = points.find((p) => p.t >= from)?.t ?? now
  const spanMs = now - Math.max(from, first)
  const spanDays = spanMs / DAY
  // 记录不到半天时日均波动太大，不给数
  const dailyAvg = spanMs >= DAY / 2 ? week.spent / Math.max(spanDays, 1 / 24) : null
  const daysLeft = dailyAvg && dailyAvg > 0 && amount != null ? amount / dailyAvg : null
  return { today, dailyAvg, spanDays, daysLeft, topUps: week.topUps }
}

export function formatDays(d: number | null): string {
  if (d == null || !Number.isFinite(d)) return '—'
  if (d < 1) return `约 ${Math.max(1, Math.round(d * 24))} 小时`
  if (d >= 365) return '一年以上'
  return `约 ${d < 10 ? d.toFixed(1) : Math.round(d)} 天`
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
