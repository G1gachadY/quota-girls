import { motion } from 'motion/react'
import type { WheelEvent } from 'react'
import type { AppSettings, PlatformId } from '../../../main/providers/types'
import type { PlatformView } from '../model'
import { CharacterCard } from './CharacterCard'
import s from './Overview.module.css'

export function Overview({
  views,
  settings,
  now,
  guides,
  refreshing,
  inert,
  onOpen,
  onSettings,
  onRecheck,
  registerRef
}: {
  views: PlatformView[]
  settings: AppSettings
  now: number
  guides: boolean
  refreshing: PlatformId[]
  inert: boolean
  onOpen: (p: PlatformId) => void
  onSettings: (p: PlatformId) => void
  onRecheck: (p: PlatformId) => void
  registerRef: (p: PlatformId, el: HTMLDivElement | null) => void
}) {
  // 平台多时横向滚动：竖向滚轮转成横向
  const onWheel = (e: WheelEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    el.scrollLeft += e.deltaY
  }
  return (
    <main
      className={`${s.overview} ${views.length > 3 ? s.many : ''}`}
      aria-hidden={inert}
      style={inert ? { pointerEvents: 'none' } : undefined}
      onWheel={onWheel}
    >
      {views.map((v, i) => (
        <motion.div
          key={v.id}
          className={s.slot}
          initial={{ y: 70, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.08 + Math.min(i, 6) * 0.08, type: 'spring', stiffness: 210, damping: 26 }}
        >
          <CharacterCard
            ref={(el) => registerRef(v.id, el)}
            view={v}
            settings={settings}
            now={now}
            guides={guides}
            refreshing={refreshing.includes(v.id)}
            onOpen={() => onOpen(v.id)}
            onSettings={() => onSettings(v.id)}
            onRecheck={() => onRecheck(v.id)}
          />
        </motion.div>
      ))}
    </main>
  )
}
