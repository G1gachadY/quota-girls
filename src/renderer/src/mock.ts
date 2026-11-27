/**
 * 假数据 API：仅在没有 window.quota（浏览器预览）时使用。
 * URL 参数 ?scenario=default | states | low | tight | empty | loading 切换演示状态。
 * 插画取自开发服务器的 /__art/（项目 art/ 目录）。
 */
import { DEEPSEEK_PRICING_CHECKED_AT, PRICING_CHECKED_AT, aggregateValue, valueRanges } from '@shared/pricing'
import { BUILTIN_IDS, DEFAULT_MANIFESTS, DEFAULT_SETTINGS, balanceStats, isBuiltin, normalizeSettings, platformList } from '@shared/quota'
import type {
  AppSettings,
  AppState,
  ArtState,
  HistorySeries,
  PlatformId,
  PlatformSnapshot,
  QuotaAPI,
  QuotaWindow,
  BalancePoint,
  UsageEvent,
  ValueReport
} from '../../main/providers/types'

const H = 3600 * 1000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const win = (
  id: string,
  label: string,
  kind: QuotaWindow['kind'],
  used: number | null,
  resetIn: number | null
): QuotaWindow => ({ id, label, kind, usedPercent: used, resetsAt: resetIn == null ? null : iso(resetIn), known: used != null })

function scenario(): string {
  try {
    return new URLSearchParams(location.search).get('scenario') ?? 'default'
  } catch {
    return 'default'
  }
}

function quotaSnapshots(): Record<PlatformId, PlatformSnapshot> {
  const now = new Date().toISOString()
  const sc = scenario()
  const claude: PlatformSnapshot = {
    platform: 'claude',
    status: 'ok',
    source: 'oauth',
    plan: 'Max 5x',
    account: 'a***@gmail.com',
    fetchedAt: new Date(Date.now() - 3 * 60000).toISOString(),
    windows: [
      win('five_hour', '5小时', 'session', 28, 2.22 * H),
      win('seven_day', '本周', 'weekly', 42, 3.4 * 24 * H),
      win('seven_day_opus', '本周·Opus', 'model', 15, 3.4 * 24 * H)
    ],
    extras: { extraUsage: '本月 $3.20 / $50.00' }
  }
  const codex: PlatformSnapshot = {
    platform: 'codex',
    status: 'ok',
    source: 'api',
    plan: 'Plus',
    account: 'u***@example.com',
    fetchedAt: new Date(Date.now() - 3 * 60000).toISOString(),
    windows: [win('five_hour', '5小时', 'session', 20, 1.1 * H), win('weekly', '本周', 'weekly', 65, 4 * 24 * H)]
  }
  const antigravity: PlatformSnapshot = {
    platform: 'antigravity',
    status: 'offline',
    source: 'local-ls',
    plan: 'AI Pro',
    account: 'u***@example.com',
    fetchedAt: new Date(Date.now() - 2 * H).toISOString(),
    windows: [
      win('gemini-5h', 'Gemini·5小时', 'session', 10, 1.08 * H),
      win('3p-5h', 'Claude/GPT·5小时', 'session', 60, 1.08 * H),
      win('gemini-weekly', 'Gemini·本周', 'weekly', 22, 6 * 24 * H),
      win('3p-weekly', 'Claude/GPT·本周', 'weekly', 35, 6 * 24 * H)
    ],
    error: { message: 'Antigravity 未运行', hint: '打开 Antigravity 后自动读取' }
  }
  if (sc === 'states') {
    return {
      claude: { ...claude, status: 'auth_expired', error: { message: 'OAuth token 已过期', hint: '打开一次 Claude Code（终端运行 claude）即可自动续期' } },
      codex: { ...codex, windows: [win('five_hour', '5小时', 'session', 100, 0.6 * H), win('weekly', '本周', 'weekly', 81, 4 * 24 * H)] },
      antigravity: {
        platform: 'antigravity',
        status: 'not_configured',
        source: 'none',
        windows: [],
        fetchedAt: now,
        error: { message: '未找到', hint: '打开 Antigravity 后自动读取' }
      }
    }
  }
  if (sc === 'low') {
    return {
      claude: { ...claude, windows: [win('five_hour', '5小时', 'session', 86, 0.7 * H), win('seven_day', '本周', 'weekly', 55, 3 * 24 * H)] },
      codex: { ...codex, windows: [win('five_hour', '5小时', 'session', 62, 2 * H), win('weekly', '本周', 'weekly', 40, 4 * 24 * H)] },
      antigravity: { ...antigravity, status: 'ok', fetchedAt: now }
    }
  }
  // 三位同时紧张 / 同时耗尽：检查差分插画
  if (sc === 'tight' || sc === 'empty') {
    const u = (low: number) => (sc === 'empty' ? 100 : low)
    return {
      claude: { ...claude, windows: [win('five_hour', '5小时', 'session', u(86), 0.7 * H), win('seven_day', '本周', 'weekly', 55, 3 * 24 * H)] },
      codex: { ...codex, windows: [win('five_hour', '5小时', 'session', u(91), 0.4 * H), win('weekly', '本周', 'weekly', 70, 4 * 24 * H)] },
      antigravity: {
        ...antigravity,
        status: 'ok',
        fetchedAt: now,
        windows: [
          win('gemini-5h', 'Gemini·5小时', 'session', u(88), 1.08 * H),
          win('3p-5h', 'Claude/GPT·5小时', 'session', 60, 1.08 * H),
          win('gemini-weekly', 'Gemini·本周', 'weekly', 40, 6 * 24 * H)
        ]
      }
    }
  }
  if (sc === 'loading') {
    const l = (p: PlatformId): PlatformSnapshot => ({ platform: p, status: 'loading', source: 'none', windows: [], fetchedAt: now })
    return { claude: l('claude'), codex: l('codex'), antigravity: l('antigravity') }
  }
  return { claude, codex, antigravity }
}

/** 假余额历史：14 天，每小时一个点，白天消耗多，第 9 天充值 50 元，最后落在当前余额 */
function fakeBalance(current: number): BalancePoint[] {
  const out: BalancePoint[] = []
  const now = Date.now()
  let a = current
  for (let i = 0; i <= 14 * 24; i++) {
    const t = now - i * H
    out.push({ t, a: Math.round(a * 100) / 100 })
    const hour = new Date(t).getHours()
    a += hour >= 9 && hour < 23 ? 0.12 + ((i * 7) % 5) * 0.04 : 0.01
    if (i === 5 * 24) a -= 50
  }
  return out.reverse()
}

function snapshots(): Record<PlatformId, PlatformSnapshot> {
  const sc = scenario()
  const at = new Date(Date.now() - 2 * 60000).toISOString()
  // tight = 低于提醒线，empty = 用完
  const k = sc === 'empty' ? 0 : sc === 'tight' ? 0.02 : 1
  const bal = (platform: PlatformId, source: string, balance: PlatformSnapshot['balance']): PlatformSnapshot => ({
    platform,
    status: 'ok',
    source,
    windows: [],
    fetchedAt: at,
    balance
  })
  const quota = quotaSnapshots()
  if (sc === 'loading') {
    const l = (p: PlatformId): PlatformSnapshot => ({ platform: p, status: 'loading', source: 'none', windows: [], fetchedAt: at })
    return { ...quota, deepseek: l('deepseek') }
  }
  return {
    ...quota,
    deepseek:
      sc === 'states'
        ? {
            platform: 'deepseek',
            status: 'not_configured',
            source: 'none',
            windows: [],
            fetchedAt: at,
            error: { message: '没有找到 DeepSeek 的 API Key', hint: '在设置里填 Key，或在 CC Switch 里配置 DeepSeek 供应商' }
          }
        : bal('deepseek', 'cc-switch', {
            amount: 86.42 * k,
            currency: 'CNY',
            stats: balanceStats(fakeBalance(86.42 * k), Date.now(), 86.42 * k),
            parts: [
              { label: '充值', amount: 80 * k },
              { label: '赠送', amount: 6.42 * k }
            ]
          })
  }
}

function fakeHistory(s: PlatformSnapshot): HistorySeries {
  const out: HistorySeries = { windows: {} }
  const now = Date.now()
  for (const w of s.windows) {
    if (!w.known || w.usedPercent == null) continue
    const period = w.kind === 'session' ? 5 * H : 7 * 24 * H
    const points = []
    const end = w.resetsAt ? Date.parse(w.resetsAt) : now + period
    for (let t = now - 7 * 24 * H; t <= now; t += 5 * 60000) {
      // 每个周期内从 0 单调上升，周期结束时归零
      const phase = ((t - (end - period)) % period + period) % period
      const cycleStart = t - phase
      const growth = Math.pow(phase / period, 0.8) * (w.usedPercent / Math.max(0.05, (now - (end - period)) / period))
      const noise = Math.sin(t / 1.7e6) * 2
      const u = Math.max(0, Math.min(100, growth + noise))
      // 模拟夜间不使用：保留空洞
      const hour = new Date(t).getHours()
      if (hour >= 2 && hour < 7) continue
      points.push({ t, u: Math.round(u * 10) / 10, r: cycleStart + period })
    }
    out.windows[w.id] = { label: w.label, points }
  }
  return out
}

/** 假的本机用量记录：30 天，夜里不用，按权重挑模型 */
function fakeUsage(p: PlatformId): UsageEvent[] {
  let seed = p.length * 7919 + 17
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  type Mix = { model: string; name?: string; w: number; input: number; output: number; read: number; write: number; long?: boolean }
  const mix: Record<PlatformId, Mix[]> = {
    claude: [
      { model: 'claude-opus-5-5', w: 0.8, input: 3, output: 1500, read: 380_000, write: 7_000, long: true },
      { model: 'claude-fable-5-2', w: 0.2, input: 3, output: 1400, read: 390_000, write: 11_000, long: true }
    ],
    codex: [
      { model: 'gpt-6.1-sol', w: 0.6, input: 8_000, output: 950, read: 170_000, write: 0 },
      { model: 'gpt-6-astra', w: 0.3, input: 6_500, output: 850, read: 130_000, write: 0 },
      { model: 'codex-auto-review', w: 0.1, input: 7_000, output: 130, read: 36_000, write: 0 }
    ],
    antigravity: [
      { model: 'gemini-4-argon-trial', name: 'Gemini 4 Argon (High)', w: 0.4, input: 16_000, output: 420, read: 0, write: 0 },
      { model: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen (Medium)', w: 0.6, input: 5_000, output: 360, read: 20_000, write: 0 }
    ],
    deepseek: [
      { model: 'deepseek-v4-pro', w: 0.35, input: 3_000, output: 1200, read: 60_000, write: 0 },
      { model: 'deepseek-flash', w: 0.65, input: 2_500, output: 900, read: 40_000, write: 0 }
    ]
  }
  const out: UsageEvent[] = []
  const now = Date.now()
  const step = p === 'antigravity' ? 90 : 18
  for (let t = now - 30 * 24 * H; t < now; t += (step * 0.3 + rnd() * step) * 60_000) {
    const hour = new Date(t).getHours()
    if (hour >= 1 && hour < 9) continue
    let r = rnd()
    const m = mix[p].find((x) => (r -= x.w) <= 0) ?? mix[p][0]
    const k = 0.4 + rnd() * 1.2
    out.push({
      t,
      model: m.model,
      modelName: m.name,
      input: Math.round(m.input * k),
      output: Math.round(m.output * k),
      cacheRead: Math.round(m.read * k),
      cacheWrite5m: m.long ? 0 : Math.round(m.write * k),
      cacheWrite1h: m.long ? Math.round(m.write * k) : 0
    })
  }
  return out
}

const SCOPES: Record<PlatformId, Pick<ValueReport, 'scope' | 'caveat'>> = {
  claude: { scope: 'Claude Code 本机会话记录', caveat: 'Claude 桌面版 / 网页版 / 手机端的对话不在本机留记录，无法计入；实际消耗的订阅额度会比这里多。' },
  codex: { scope: 'Codex CLI / IDE 插件本机会话记录', caveat: 'Codex 云端任务和 ChatGPT 网页对话不在本机留记录，无法计入。' },
  antigravity: { scope: 'Antigravity 本机对话记录', caveat: '只统计这台电脑上的 Antigravity 对话。' },
  deepseek: {
    scope: 'Claude Code / Codex 本机记录里走 DeepSeek 的请求',
    caveat: 'Cherry Studio、网页版等其它客户端的用量不在本机记录里，以余额变化为准。'
  }
}

export function createMockApi(): QuotaAPI {
  let settings: AppSettings = normalizeSettings({ ...DEFAULT_SETTINGS })
  const snaps = snapshots()
  const listeners = new Set<(s: AppState) => void>()
  const state = (): AppState => ({
    platforms: platformList(settings, (id) => ({
      keySource: id === 'deepseek' ? 'cc-switch' : isBuiltin(id) ? undefined : 'manual'
    })),
    snapshots: snaps,
    settings,
    refreshing: [],
    nextRefreshAt: {},
    claudeWebLoggedIn: false,
    version: 'mock'
  })
  const emit = () => listeners.forEach((l) => l(state()))
  // 开发服务器在 /__art/ 下提供项目 art/ 里的插画（见 electron.vite.config.ts）；取不到就用占位图
  const art = async (): Promise<ArtState> => {
    try {
      const r = await fetch('/__art/state.json', { cache: 'no-store' })
      if (r.ok) return (await r.json()) as ArtState
    } catch {
      /* 占位图 */
    }
    const a = {} as ArtState
    for (const p of BUILTIN_IDS) a[p] = { manifest: DEFAULT_MANIFESTS[p], files: {} }
    return a
  }
  return {
    getState: async () => state(),
    onState: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    refresh: async () => {
      for (const p of Object.keys(snaps)) snaps[p] = { ...snaps[p], fetchedAt: new Date().toISOString() }
      emit()
    },
    getHistory: async (p) => fakeHistory(snaps[p]),
    getBalanceHistory: async (p) => ({ currency: 'CNY', points: snaps[p]?.balance ? fakeBalance(snaps[p].balance!.amount ?? 0) : [] }),
    getRaw: async (p) => [{ label: '假数据（浏览器预览）', at: new Date().toISOString(), body: snaps[p] }],
    getValue: async (p) => {
      if (p !== 'claude' && p !== 'codex' && p !== 'antigravity' && p !== 'deepseek') return null
      const events = scenario() === 'loading' ? [] : fakeUsage(p)
      return {
        platform: p,
        ...SCOPES[p],
        ranges: valueRanges(snaps[p], Date.now()).map((r) => aggregateValue(events, r, [], p === 'deepseek' ? 'CNY' : 'USD')),
        scannedAt: new Date().toISOString(),
        files: 12,
        earliest: events[0]?.t ?? null,
        pricingCheckedAt: p === 'deepseek' ? DEEPSEEK_PRICING_CHECKED_AT : PRICING_CHECKED_AT
      }
    },
    setSettings: async (patch) => {
      settings = normalizeSettings({ ...settings, ...patch })
      emit()
      return settings
    },
    getArt: art,
    onArt: () => () => {},
    reloadArt: art,
    openArtFolder: async () => {},
    claudeLogin: async () => {},
    claudeSetSessionKey: async () => ({ ok: false, message: '浏览器预览模式不可用' }),
    claudeLogout: async () => {},
    setPlatformKey: async () => ({ ok: false, message: '浏览器预览模式不可用' }),
    win: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      isMaximized: async () => false,
      onMaximized: () => () => {}
    },
    mini: { toggle: () => {}, showMain: () => {}, dragTo: () => {}, close: () => {} }
  }
}
