import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PLATFORM_IDS, PLATFORM_META } from '@shared/quota'
import type { PlatformId } from '../../main/providers/types'
import { api } from './api'
import { IconBack } from './components/Icons'
import { PlatformIcon } from './components/PlatformIcon'
import { Brand, TitleBar } from './components/TitleBar'
import { buildView } from './model'
import { useData, useNow } from './state'
import { Detail } from './views/Detail'
import { Overview } from './views/Overview'
import { SettingsDrawer } from './views/Settings'
import s from './App.module.css'

type Rect = { top: number; left: number; right: number; bottom: number } | null

/** 卡片矩形 → clip-path（共享元素过渡：卡片展开为全屏） */
const clipFrom = (r: Rect) =>
  r
    ? `inset(${r.top}px ${window.innerWidth - r.right}px ${window.innerHeight - r.bottom}px ${r.left}px round 18px)`
    : 'inset(0px 0px 0px 0px round 0px)'
const FULL = 'inset(0px 0px 0px 0px round 0px)'

export function App() {
  const { state, art } = useData()
  const now = useNow(1000)
  const [detail, setDetail] = useState<PlatformId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsFocus, setSettingsFocus] = useState<PlatformId | null>(null)
  const [guides, setGuides] = useState(false)
  const cardRefs = useRef<Partial<Record<PlatformId, HTMLDivElement | null>>>({})

  const rectOf = useCallback((p: PlatformId | null): Rect => {
    const el = p ? cardRefs.current[p] : null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        setGuides((g) => !g)
      } else if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false)
        else if (detail) setDetail(null)
      } else if (detail && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const i = PLATFORM_IDS.indexOf(detail)
        const n = (i + (e.key === 'ArrowRight' ? 1 : PLATFORM_IDS.length - 1)) % PLATFORM_IDS.length
        setDetail(PLATFORM_IDS[n])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, detail])

  if (!state) return <div className={s.boot} />

  const views = PLATFORM_IDS.map((p) => buildView(p, state.snapshots[p], state.settings, art, now))
  const refreshingAny = state.refreshing.length > 0
  const openSettings = (p: PlatformId | null) => {
    setSettingsFocus(p)
    setSettingsOpen(true)
  }
  const recheck = (p: PlatformId) => void api.refresh(p)

  const detailView = detail ? views.find((v) => v.id === detail)! : null

  return (
    <div className={s.app}>
      <Overview
        views={views}
        settings={state.settings}
        now={now}
        guides={guides}
        refreshing={state.refreshing}
        inert={!!detail}
        onOpen={setDetail}
        onSettings={openSettings}
        onRecheck={recheck}
        registerRef={(p, el) => (cardRefs.current[p] = el)}
      />

      <AnimatePresence custom={rectOf(detail)}>
        {detailView && (
          <motion.div
            key="detail"
            className={s.detailLayer}
            custom={rectOf(detail)}
            variants={{
              from: (r: Rect) => ({ clipPath: clipFrom(r), opacity: 0.6 }),
              in: { clipPath: FULL, opacity: 1 },
              out: (r: Rect) => ({ clipPath: clipFrom(r), opacity: 0 })
            }}
            initial="from"
            animate="in"
            exit="out"
            transition={{ duration: 0.55, ease: [0.25, 0.9, 0.25, 1] }}
          >
            <Detail
              view={detailView}
              settings={state.settings}
              now={now}
              guides={guides}
              refreshing={state.refreshing.includes(detailView.id)}
              onRecheck={recheck}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <TitleBar
        transparent={!!detail}
        refreshing={refreshingAny}
        onRefresh={() => void api.refresh(detail ?? undefined)}
        onSettings={() => openSettings(detail)}
        left={
          detail ? (
            <div className={s.nav}>
              <button className={s.back} onClick={() => setDetail(null)}>
                <IconBack /> 返回
              </button>
              <div className={s.tabs}>
                {PLATFORM_IDS.map((p) => (
                  <button
                    key={p}
                    className={p === detail ? s.tabOn : ''}
                    style={{ '--accent': art[p].manifest.accent } as CSSProperties}
                    onClick={() => setDetail(p)}
                  >
                    <PlatformIcon id={p} size={14} />
                    {PLATFORM_META[p].name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Brand />
          )
        }
      />

      <AnimatePresence>
        {settingsOpen && (
          <SettingsDrawer key="settings" state={state} art={art} focus={settingsFocus} onClose={() => setSettingsOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {guides && (
          <motion.div
            className={s.guideTip}
            initial={{ opacity: 0, y: 8, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 8, x: '-50%' }}
          >
            安全区参考线 · F2 关闭
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
