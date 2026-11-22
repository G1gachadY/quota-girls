import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { BUILTIN_IDS, DEFAULT_MANIFESTS } from '@shared/quota'
import type { AppState, ArtState, HistorySeries, PlatformId, ValueReport } from '../../main/providers/types'
import { api } from './api'

interface Data {
  state: AppState | null
  art: ArtState
}

const emptyArt = (): ArtState => {
  const a = {} as ArtState
  for (const p of BUILTIN_IDS) a[p] = { manifest: DEFAULT_MANIFESTS[p], files: {} }
  return a
}

const Ctx = createContext<Data>({ state: null, art: emptyArt() })

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [art, setArt] = useState<ArtState>(emptyArt)

  useEffect(() => {
    let alive = true
    api.getState().then((s) => alive && setState(s))
    api.getArt().then((a) => alive && setArt(a))
    const offState = api.onState((s) => setState(s))
    const offArt = api.onArt((a) => setArt(a))
    return () => {
      alive = false
      offState()
      offArt()
    }
  }, [])

  return <Ctx.Provider value={{ state, art }}>{children}</Ctx.Provider>
}

export function useData(): Data {
  return useContext(Ctx)
}

/** 每 intervalMs 毫秒更新一次的当前时间（倒计时用） */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** 某平台的历史；快照更新时重新拉取 */
export function useHistory(platform: PlatformId, version: string | undefined): HistorySeries | null {
  const [h, setH] = useState<HistorySeries | null>(null)
  useEffect(() => {
    let alive = true
    api.getHistory(platform).then((r) => alive && setH(r))
    return () => {
      alive = false
    }
  }, [platform, version])
  return h
}

/** 等价 API 价值：打开详情页和每次刷新快照后重新取（main 里增量扫描，20 秒内复用） */
export function useValue(platform: PlatformId, version: string | undefined): ValueReport | null {
  const [v, setV] = useState<ValueReport | null>(null)
  useEffect(() => {
    let alive = true
    setV((old) => (old?.platform === platform ? old : null))
    api
      .getValue(platform)
      .then((r) => alive && setV(r))
      .catch(() => alive && setV(null))
    return () => {
      alive = false
    }
  }, [platform, version])
  return v
}
