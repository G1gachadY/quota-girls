/**
 * main 与 renderer 共用的纯逻辑：平台元信息、默认设置、主额度选择、时间格式化。
 * 不得 import 任何 Node / Electron / DOM 模块。
 */
import type {
  AppSettings,
  ArtManifest,
  PlatformId,
  PlatformSnapshot,
  QuotaWindow
} from '../main/providers/types'

export const PLATFORM_IDS: PlatformId[] = ['claude', 'codex', 'antigravity']

export interface PlatformMeta {
  id: PlatformId
  name: string
  en: string
  no: string
}

export const PLATFORM_META: Record<PlatformId, PlatformMeta> = {
  claude: { id: 'claude', name: 'Claude', en: 'CLAUDE', no: '01' },
  codex: { id: 'codex', name: 'Codex', en: 'CODEX', no: '02' },
  antigravity: { id: 'antigravity', name: 'Antigravity', en: 'ANTIGRAVITY', no: '03' }
}

export const DEFAULT_MANIFESTS: Record<PlatformId, ArtManifest> = {
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
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshMinutes: 5,
  primaryRule: { claude: 'tightest', codex: 'tightest', antigravity: 'tightest' },
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
  return s
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
