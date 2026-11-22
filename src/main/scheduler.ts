/**
 * 定时调度：默认 5 分钟（最小 2 分钟）；429/5xx 指数退避（最长 30 分钟）；
 * 任一平台出错不影响其它平台；失败时保留上次快照并标 stale。
 */
import { isBuiltin } from '../shared/quota'
import { claudeWebDeps } from './claude-web'
import { fetchAntigravity } from './providers/antigravity'
import { fetchCustom, fetchDeepSeek } from './providers/balance'
import { fetchClaude } from './providers/claude'
import { fetchCodex } from './providers/codex'
import type { PlatformId, PlatformSnapshot, ProviderResult, RawEntry } from './providers/types'
import type { Store } from './store'
import { ProviderError, errorText, nowIso } from './util'

const MAX_BACKOFF = 30 * 60 * 1000
const OFFLINE_RECHECK = 2 * 60 * 1000
const MANUAL_MIN_GAP = 15 * 1000

type Listener = (p: PlatformId, prev: PlatformSnapshot | undefined, next: PlatformSnapshot) => void

export class Scheduler {
  snapshots = {} as Record<PlatformId, PlatformSnapshot>
  raw = {} as Record<PlatformId, RawEntry[]>
  nextAt = {} as Record<PlatformId, number>
  private failures = {} as Record<PlatformId, number>
  private lastRun = {} as Record<PlatformId, number>
  private inflight = new Map<PlatformId, Promise<void>>()
  private timer: NodeJS.Timeout | null = null
  private listeners: Listener[] = []
  private changeListeners: (() => void)[] = []

  /** @param ids 当前要刷新的平台（不含隐藏的），每次调用都按最新设置计算 */
  constructor(
    private store: Store,
    private ids: () => PlatformId[]
  ) {
    this.sync()
  }

  /** 平台增删 / 隐藏后调用：补上新平台的状态，清掉已删除的，新平台立即刷新 */
  sync(): void {
    const want = new Set(this.ids())
    for (const p of want) {
      if (this.snapshots[p]) continue
      const cached = this.store.cache.data[p]
      // 启动时先显示上次快照（标 loading 之外的 stale），首次刷新后替换
      this.snapshots[p] = cached
        ? { ...cached, status: cached.status === 'ok' ? 'stale' : cached.status }
        : { platform: p, status: 'loading', source: 'none', windows: [], fetchedAt: nowIso() }
      this.raw[p] = []
      this.nextAt[p] = 0
      this.failures[p] = 0
      this.lastRun[p] = 0
    }
    for (const p of Object.keys(this.snapshots)) {
      if (want.has(p)) continue
      delete this.snapshots[p]
      delete this.raw[p]
      delete this.nextAt[p]
      delete this.failures[p]
      delete this.lastRun[p]
    }
    if (this.timer) void this.tick()
  }

  onSnapshot(l: Listener): void {
    this.listeners.push(l)
  }

  /** 任意状态变化（含 refreshing 列表） */
  onChange(l: () => void): void {
    this.changeListeners.push(l)
  }

  private emitChange(): void {
    for (const l of this.changeListeners) l()
  }

  get refreshing(): PlatformId[] {
    return [...this.inflight.keys()]
  }

  start(): void {
    if (this.timer) return
    void this.refreshAll(false)
    // 每 20 秒检查一次谁到期；窗口隐藏时照常运行（用于通知）
    this.timer = setInterval(() => void this.tick(), 20 * 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    for (const p of this.ids()) if (now >= (this.nextAt[p] ?? 0)) void this.refresh(p, false)
  }

  async refreshAll(manual = true): Promise<void> {
    await Promise.all(this.ids().map((p) => this.refresh(p, manual)))
  }

  /** 设置变化（例如刷新间隔）后重新排期 */
  reschedule(): void {
    const interval = this.store.settings.data.refreshMinutes * 60 * 1000
    const now = Date.now()
    for (const p of this.ids()) {
      if (this.failures[p] === 0) this.nextAt[p] = Math.min(this.nextAt[p], now + interval)
    }
  }

  refresh(p: PlatformId, manual: boolean): Promise<void> {
    if (!this.snapshots[p]) return Promise.resolve()
    const existing = this.inflight.get(p)
    if (existing) return existing
    // 手动刷新也保留一个很短的最小间隔，避免连点打爆接口
    if (manual && Date.now() - this.lastRun[p] < MANUAL_MIN_GAP) return Promise.resolve()
    const job = this.run(p).finally(() => {
      this.inflight.delete(p)
      this.emitChange()
    })
    this.inflight.set(p, job)
    this.emitChange()
    return job
  }

  /** 等进行中的那次结束后再查一次（例如刚改了 Key / 配置，进行中的那次用的还是旧的） */
  async refreshFresh(p: PlatformId): Promise<void> {
    const existing = this.inflight.get(p)
    if (existing) await existing
    return this.refresh(p, false)
  }

  private async fetchOne(p: PlatformId): Promise<ProviderResult> {
    const settings = this.store.settings.data
    if (p === 'claude') return fetchClaude(settings, claudeWebDeps)
    if (p === 'codex') return fetchCodex(settings)
    if (p === 'antigravity') return fetchAntigravity(settings)
    if (p === 'deepseek') return fetchDeepSeek(settings)
    const custom = isBuiltin(p) ? undefined : settings.customPlatforms.find((c) => c.id === p)
    if (!custom) throw new ProviderError('平台已被删除', 'config', '')
    return fetchCustom(custom, settings)
  }

  private async run(p: PlatformId): Promise<void> {
    this.lastRun[p] = Date.now()
    const interval = this.store.settings.data.refreshMinutes * 60 * 1000
    const prev = this.snapshots[p]
    const lastGood = this.store.cache.data[p]
    let next: PlatformSnapshot
    let retryable = false
    try {
      const r = await this.fetchOne(p)
      this.raw[p] = r.raw
      next = r.snapshot
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null
      retryable = pe?.kind === 'rate' || pe?.kind === 'server'
      this.raw[p] = [...(pe?.raw ?? []), { label: '错误', at: nowIso(), body: errorText(e) }]
      next = {
        platform: p,
        status: 'error',
        source: prev?.source ?? 'none',
        windows: [],
        fetchedAt: nowIso(),
        error: { message: errorText(e), hint: pe?.hint || '稍后自动重试' }
      }
    }

    const now = Date.now()
    if (next.status === 'ok') {
      this.store.setCache(next)
      this.store.addHistory(next)
      this.failures[p] = 0
      this.nextAt[p] = now + interval
    } else if (next.status === 'stale' && hasData(next)) {
      // 例如 Codex 本地会话日志：数据是旧的，但可以显示
      if (!lastGood || Date.parse(lastGood.fetchedAt) < Date.parse(next.fetchedAt)) this.store.setCache(next)
      this.failures[p] = 0
      this.nextAt[p] = now + interval
    } else {
      // 失败：保留上次快照
      if (lastGood && hasData(lastGood) && next.status !== 'not_configured') {
        next = {
          ...lastGood,
          status: next.status === 'error' ? 'stale' : next.status,
          error: next.error,
          note: next.status === 'offline' ? undefined : lastGood.note
        }
      }
      if (retryable) {
        this.failures[p] += 1
        this.nextAt[p] = now + Math.min(MAX_BACKOFF, interval * 2 ** this.failures[p])
      } else if (next.status === 'offline') {
        this.nextAt[p] = now + Math.min(interval, OFFLINE_RECHECK)
      } else {
        this.nextAt[p] = now + interval
      }
    }

    // 刷新期间平台被删除 / 隐藏：丢弃结果
    if (!this.snapshots[p]) return
    this.snapshots[p] = next
    for (const l of this.listeners) l(p, prev, next)
  }
}

/** 有可显示的数据：额度窗口或余额 */
function hasData(s: PlatformSnapshot): boolean {
  return s.windows.length > 0 || !!s.balance
}
