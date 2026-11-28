/** 视图模型：把快照 + 设置 + 插画合成每张卡需要的显示数据 */
import {
  balanceLevel,
  balancePercent,
  copyFor,
  defaultManifest,
  lowBalanceOf,
  effectiveWindow,
  formatAgo,
  formatCountdown,
  levelOf,
  pickPrimary,
  remainingOf,
  type Copy,
  type Level
} from '@shared/quota'
import type {
  AppSettings,
  ArtFiles,
  ArtManifest,
  ArtState,
  Balance,
  PlatformId,
  PlatformInfo,
  PlatformSnapshot,
  QuotaWindow
} from '../../main/providers/types'

export type EffWindow = QuotaWindow & { inferredReset?: boolean }

export interface PlatformView {
  id: PlatformId
  /** 平台信息（名字、编号、类型、Key 来源…） */
  info: PlatformInfo
  meta: { id: PlatformId; name: string; en: string; no: string }
  snap: PlatformSnapshot
  manifest: ArtManifest
  files: ArtFiles
  primary: EffWindow | null
  windows: EffWindow[]
  others: EffWindow[]
  remaining: number | null
  level: Level
  color: string
  /** 有可显示的数据（包括缓存） */
  hasData: boolean
  /** 未连接（无数据源） */
  disconnected: boolean
  copy: Copy
  /** 按量付费平台的余额（没有额度窗口时显示它） */
  balance?: Balance
  /** 余额提醒线 */
  lowBalance: number
}

export const LEVEL_COLORS = { warn: '#F5B544', low: '#FF5A5F', empty: '#FF5A5F', unknown: 'rgba(233,236,242,0.38)' }

export function levelColor(level: Level, accent: string): string {
  return level === 'good' ? accent : LEVEL_COLORS[level]
}

export function buildView(
  info: PlatformInfo,
  snapIn: PlatformSnapshot | undefined,
  settings: AppSettings,
  art: ArtState,
  now: number
): PlatformView {
  const id = info.id
  const snap: PlatformSnapshot = snapIn ?? { platform: id, status: 'loading', source: 'none', windows: [], fetchedAt: new Date(now).toISOString() }
  const { manifest, files } = art[id] ?? { manifest: defaultManifest(id), files: {} }
  const windows = snap.windows.map((w) => effectiveWindow(w, now))
  const primary = pickPrimary(snap, settings.primaryRule[id], now)
  // 余额平台没有额度窗口：知道总额时按 剩余/总额，否则只按金额判断紧张程度
  const balance = windows.length === 0 ? snap.balance : undefined
  const lowBalance = lowBalanceOf(settings, id)
  const remaining = balance ? balancePercent(balance) : remainingOf(primary)
  const level = balance ? balanceLevel(balance, lowBalance) : levelOf(remaining)
  const hasData = windows.some((w) => w.known) || !!balance
  return {
    id,
    info,
    meta: { id, name: info.name, en: info.en, no: info.no },
    snap,
    balance,
    lowBalance,
    manifest,
    files,
    primary,
    windows,
    others: windows.filter((w) => w.id !== primary?.id),
    remaining,
    level,
    color: levelColor(level, manifest.accent),
    hasData,
    disconnected: !hasData && (snap.status === 'not_configured' || snap.status === 'offline' || snap.status === 'error'),
    copy: copyFor(settings.copyStyle)
  }
}

// ───────────────────────── 插画选择 ─────────────────────────

/** 角色状态：决定用哪张差分 */
export type Mood = 'normal' | 'low' | 'empty'

export function moodOf(level: Level): Mood {
  return level === 'empty' ? 'empty' : level === 'low' ? 'low' : 'normal'
}

export interface ArtPick {
  url?: string
  focus: string
  /** cover：铺满裁切；side：竖版图放进横版槽位——整幅靠右显示，背后用同图虚化铺满 */
  layout: 'cover' | 'side'
  /** 用的是该状态的专属差分（不再叠加 CSS 滤镜） */
  variant: boolean
}

/**
 * 按槽位和状态挑图。每种状态先找同方向的图，再借另一方向的：
 *   角色卡  card-<状态> → hero-<状态>（按焦点裁成竖版）
 *   详情页  hero-<状态> → card-<状态>（竖版靠右整幅显示）
 * 该状态没有差分时回退到常态图，由调用方叠加滤镜。
 */
export function pickArt(files: ArtFiles, m: ArtManifest, slot: 'card' | 'hero', mood: Mood): ArtPick {
  const sets = {
    normal: { card: files.card, hero: files.hero, cardFocus: m.cardFocus, heroFocus: m.heroFocus },
    low: {
      card: files.cardLow,
      hero: files.heroLow,
      cardFocus: m.cardLowFocus ?? m.cardFocus,
      heroFocus: m.heroLowFocus ?? m.heroFocus
    },
    empty: {
      card: files.cardEmpty,
      hero: files.heroEmpty,
      cardFocus: m.cardEmptyFocus ?? m.cardFocus,
      heroFocus: m.heroEmptyFocus ?? m.heroFocus
    }
  }
  const find = (md: Mood): Omit<ArtPick, 'variant'> | null => {
    const x = sets[md]
    if (slot === 'card') {
      if (x.card) return { url: x.card, focus: x.cardFocus, layout: 'cover' }
      if (x.hero) return { url: x.hero, focus: x.heroFocus, layout: 'cover' }
    } else {
      if (x.hero) return { url: x.hero, focus: x.heroFocus, layout: 'cover' }
      if (x.card) return { url: x.card, focus: x.cardFocus, layout: 'side' }
    }
    return null
  }
  if (mood !== 'normal') {
    const hit = find(mood)
    if (hit) return { ...hit, variant: true }
  }
  const base = find('normal') ?? { focus: slot === 'card' ? m.cardFocus : m.heroFocus, layout: 'cover' as const }
  return { ...base, variant: false }
}

/** 显示值：剩余或已用 */
export function displayValue(w: QuotaWindow | null | undefined, mode: AppSettings['displayMode']): number | null {
  const r = remainingOf(w)
  if (r == null) return null
  return mode === 'used' ? 100 - r : r
}

export function fmtPct(v: number | null): string {
  if (v == null) return '—'
  if (v > 0 && v < 1) return '<1'
  return String(Math.round(v))
}

/** "2时13分后回满" / "已回满" / "—" */
export function resetText(w: EffWindow | null | undefined, now: number, copy: Copy): string {
  if (!w || !w.known) return '—'
  if (w.inferredReset) return copy.resetDone
  if (!w.resetsAt) return (w.usedPercent ?? 0) <= 0 ? (copy.stamina === '体力' ? '体力满格' : '未使用') : '—'
  const ms = Date.parse(w.resetsAt) - now
  return `${formatCountdown(ms)}${copy.resetSuffix}`
}

export function statusText(v: PlatformView, now: number): { text: string; dot: string; pulse?: boolean } {
  const s = v.snap
  const ago = formatAgo(s.fetchedAt, now)
  switch (s.status) {
    case 'ok':
      return { text: s.note ? `${ago} · ${s.note}` : ago, dot: 'var(--green)' }
    case 'stale':
      return { text: `${ago} · ${s.note ?? '数据可能已过期'}`, dot: 'var(--amber)' }
    case 'offline':
      return {
        text: s.error?.message === '代理未开启' ? '代理未开启 · 暂停更新' : v.hasData ? `未运行 · ${ago}` : '未运行',
        dot: 'rgba(233,236,242,0.35)'
      }
    case 'auth_expired':
      return { text: v.hasData ? `登录已过期 · ${ago}` : '登录已过期', dot: 'var(--red)' }
    case 'error':
      return { text: `更新失败 · ${ago}`, dot: 'var(--red)' }
    case 'not_configured':
      return { text: '未连接', dot: 'rgba(233,236,242,0.35)' }
    case 'loading':
    default:
      return { text: '读取中…', dot: v.manifest.accent, pulse: true }
  }
}

export const SOURCE_LABELS: Record<string, string> = {
  oauth: 'OAuth',
  web: '网页登录',
  api: 'API',
  rpc: 'CLI RPC',
  'local-log': '本地会话日志',
  'local-ls': '本地 Language Server',
  'cc-switch': '余额接口 · Key 来自 CC Switch',
  manual: '余额接口 · 手动填写的 Key',
  env: '余额接口 · 环境变量 Key',
  none: '—'
}
