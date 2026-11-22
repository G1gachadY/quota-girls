import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { balancePercent, formatMoney } from '@shared/quota'
import { api } from '../api'
import { ArtImage } from '../components/ArtImage'
import { Bar } from '../components/Gauges'
import { IconClose } from '../components/Icons'
import { PlatformIcon } from '../components/PlatformIcon'
import { buildView, displayValue, fmtPct, resetText } from '../model'
import { useData, useNow } from '../state'
import s from './Mini.module.css'

/** 迷你挂件 360×132：可拖动、可置顶；双击打开主窗口 */
export function MiniApp() {
  const { state, art } = useData()
  const now = useNow(1000)
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.screenX - window.screenX, dy: e.screenY - window.screenY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.moved = true
    api.mini.dragTo(e.screenX - d.dx, e.screenY - d.dy)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  if (!state) return <div className={s.mini} />
  const mode = state.settings.displayMode

  return (
    <div
      className={s.mini}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={() => api.mini.showMain()}
      title="双击打开主窗口 · 拖动移动"
    >
      <button className={s.close} onClick={() => api.mini.close()} title="关闭挂件">
        <IconClose />
      </button>
      {state.platforms
        .filter((info) => !info.hidden)
        .slice(0, 8)
        .map((info) => {
        const p = info.id
        const v = buildView(info, state.snapshots[p], state.settings, art, now)
        const bal = v.balance
        const dv = bal
          ? balancePercent(bal) ?? (bal.amount == null || bal.amount > 0 ? 100 : 0)
          : displayValue(v.primary, mode)
        // 有 avatar 图直接用；否则以 avatarFocus 为脸部中心从角色卡裁一块
        const avatarUrl = v.files.avatar ?? v.files.card
        const focus = v.files.avatar ? '50% 50%' : v.manifest.avatarFocus
        const crop = v.files.avatar ? undefined : 0.42
        return (
          <div key={p} className={s.row} style={{ '--accent': v.manifest.accent } as CSSProperties}>
            <div className={s.avatarWrap}>
              <div className={s.avatar}>
                <ArtImage
                  url={avatarUrl}
                  focus={focus}
                  crop={crop}
                  slot="avatar"
                  platform={p}
                  kind={info.kind}
                  accent={v.manifest.accent}
                  letter={v.meta.name[0]}
                />
              </div>
              <span className={s.badge}>
                <PlatformIcon kind={info.kind} name={info.name} size={10} />
              </span>
            </div>
            <span className={s.name} title={v.meta.name}>{v.meta.en}</span>
            <Bar value={dv} color={v.color} height={5} />
            <span className={s.pct} style={{ color: v.color }}>
              {bal ? (balancePercent(bal) != null ? `${fmtPct(balancePercent(bal))}%` : '') : dv == null ? '—' : `${fmtPct(dv)}%`}
            </span>
            <span className={s.cd} style={bal ? { color: v.color } : undefined}>
              {bal
                ? formatMoney(bal.amount ?? bal.used ?? null, bal.currency)
                : v.snap.status === 'offline' && !v.hasData
                  ? '未运行'
                  : resetText(v.primary, now, v.copy).replace(/后(回满|重置)$/, '')}
            </span>
          </div>
        )
      })}
    </div>
  )
}
