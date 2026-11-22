/**
 * 设置 + 历史 + 最近快照缓存 + 通知去重记录。JSON 文件，存 app.getPath('userData')。
 */
import fs from 'node:fs'
import path from 'node:path'
import { normalizeSettings } from '../shared/quota'
import type { AppSettings, HistoryPoint, HistorySeries, PlatformId, PlatformSnapshot } from './providers/types'

class JsonFile<T> {
  data: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    private file: string,
    fallback: () => T,
    normalize: (raw: unknown) => T = (r) => r as T
  ) {
    let loaded: T
    try {
      loaded = normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch {
      loaded = fallback()
    }
    this.data = loaded
  }

  saveSoon(delay = 1500): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), delay)
  }

  saveNow(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[store] 写入失败', path.basename(this.file), (e as Error).message)
    }
  }
}

type HistoryFile = Partial<Record<PlatformId, Record<string, { label: string; points: HistoryPoint[] }>>>

const KEEP_MS = 7 * 86400 * 1000
const BUCKET_MS = 5 * 60 * 1000

export class Store {
  settings: JsonFile<AppSettings>
  history: JsonFile<HistoryFile>
  cache: JsonFile<Partial<Record<PlatformId, PlatformSnapshot>>>
  notified: JsonFile<Record<string, number>>

  constructor(public dir: string) {
    this.settings = new JsonFile(path.join(dir, 'settings.json'), () => normalizeSettings({}), (r) =>
      normalizeSettings(r as Partial<AppSettings>)
    )
    this.history = new JsonFile<HistoryFile>(path.join(dir, 'history.json'), () => ({}))
    this.cache = new JsonFile(path.join(dir, 'snapshots.json'), () => ({}))
    this.notified = new JsonFile<Record<string, number>>(path.join(dir, 'notified.json'), () => ({}))
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const cur = this.settings.data
    this.settings.data = normalizeSettings({
      ...cur,
      ...patch,
      primaryRule: { ...cur.primaryRule, ...(patch.primaryRule ?? {}) },
      sources: { ...cur.sources, ...(patch.sources ?? {}) }
    })
    this.settings.saveSoon(200)
    return this.settings.data
  }

  /** 每次成功刷新写入各窗口 usedPercent：保留 7 天，5 分钟去重（同一 5 分钟桶内覆盖） */
  addHistory(s: PlatformSnapshot): void {
    const now = Date.parse(s.fetchedAt) || Date.now()
    const plat = (this.history.data[s.platform] ??= {})
    for (const w of s.windows) {
      if (!w.known || w.usedPercent == null) continue
      const series = (plat[w.id] ??= { label: w.label, points: [] })
      series.label = w.label
      const r = w.resetsAt ? Date.parse(w.resetsAt) : undefined
      const pt: HistoryPoint = { t: now, u: Math.round(w.usedPercent * 10) / 10, ...(r ? { r } : {}) }
      const last = series.points[series.points.length - 1]
      if (last && Math.floor(last.t / BUCKET_MS) === Math.floor(now / BUCKET_MS)) series.points[series.points.length - 1] = pt
      else series.points.push(pt)
    }
    const cutoff = Date.now() - KEEP_MS
    for (const p of Object.keys(this.history.data) as PlatformId[]) {
      const windows = this.history.data[p]!
      for (const id of Object.keys(windows)) {
        windows[id].points = windows[id].points.filter((pt) => pt.t >= cutoff)
        if (windows[id].points.length === 0) delete windows[id]
      }
    }
    this.history.saveSoon()
  }

  getHistory(platform: PlatformId): HistorySeries {
    return { windows: this.history.data[platform] ?? {} }
  }

  setCache(s: PlatformSnapshot): void {
    this.cache.data[s.platform] = s
    this.cache.saveSoon()
  }

  /** 删除平台后清掉它的快照缓存和历史 */
  forget(platform: PlatformId): void {
    if (platform in this.cache.data) {
      delete this.cache.data[platform]
      this.cache.saveSoon()
    }
    if (platform in this.history.data) {
      delete this.history.data[platform]
      this.history.saveSoon()
    }
  }

  /** 每个窗口每个周期只提醒一次 */
  markNotified(key: string): boolean {
    if (this.notified.data[key]) return false
    this.notified.data[key] = Date.now()
    const cutoff = Date.now() - 10 * 86400 * 1000
    for (const [k, t] of Object.entries(this.notified.data)) if (t < cutoff) delete this.notified.data[k]
    this.notified.saveSoon()
    return true
  }

  flush(): void {
    this.settings.saveNow()
    this.history.saveNow()
    this.cache.saveNow()
    this.notified.saveNow()
  }
}
