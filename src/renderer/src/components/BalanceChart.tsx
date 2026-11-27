import { useMemo, useState, type MouseEvent } from 'react'
import { formatClock, formatMoney } from '@shared/quota'
import type { BalancePoint } from '../../../main/providers/types'
import s from './BalanceChart.module.css'

const W = 460
const H = 140
const PAD = { l: 44, r: 8, t: 10, b: 20 }
const DAY = 86400 * 1000

/**
 * 余额走势：阶梯线（余额在两次刷新之间保持不变），下方渐变填充；悬停显示时间与余额。
 * 只画选定时间范围内的点（并带上范围开始前的最后一个点，让线从左边缘接上）。
 */
export function BalanceChart({
  points,
  currency,
  range,
  now,
  accent
}: {
  points: BalancePoint[]
  currency: string
  range: '7d' | '30d'
  now: number
  accent: string
}) {
  const [hover, setHover] = useState<BalancePoint | null>(null)
  const from = now - (range === '7d' ? 7 : 30) * DAY

  const view = useMemo(() => {
    const inside = points.filter((p) => p.t >= from && p.t <= now)
    const before = [...points].reverse().find((p) => p.t < from)
    const pts = before ? [{ t: from, a: before.a }, ...inside] : inside
    if (pts.length === 0) return null
    const last = pts[pts.length - 1]
    const all = [...pts, { t: now, a: last.a }]
    let lo = Math.min(...all.map((p) => p.a))
    let hi = Math.max(...all.map((p) => p.a))
    if (hi - lo < 0.01) {
      lo -= 1
      hi += 1
    }
    const span = hi - lo
    lo = Math.max(0, lo - span * 0.1)
    hi = hi + span * 0.1
    const x = (t: number) => PAD.l + ((t - from) / (now - from)) * (W - PAD.l - PAD.r)
    const y = (a: number) => PAD.t + (1 - (a - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
    let d = `M${x(all[0].t).toFixed(1)},${y(all[0].a).toFixed(1)}`
    for (let i = 1; i < all.length; i++) d += ` H${x(all[i].t).toFixed(1)} V${y(all[i].a).toFixed(1)}`
    const area = `${d} V${H - PAD.b} H${x(all[0].t).toFixed(1)} Z`
    const ticks = [hi, (hi + lo) / 2, lo]
    const days = range === '7d' ? 7 : 30
    const xTicks = Array.from({ length: range === '7d' ? 8 : 7 }, (_, i) => from + (i * days * DAY) / (range === '7d' ? 7 : 6))
    return { pts: inside, x, y, d, area, ticks, xTicks }
  }, [points, from, now, range])

  if (!view || view.pts.length < 2) {
    return <div className={s.empty}>记录还不够：每次刷新会记下当时的余额，过一两天就能看到走势和日均消耗。</div>
  }

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = from + ((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * (now - from)
    let best = view.pts[0]
    for (const p of view.pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
    setHover(best)
  }

  return (
    <div className={s.wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.svg} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bal-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {view.ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={view.y(v)} y2={view.y(v)} className={s.grid} />
            <text x={PAD.l - 6} y={view.y(v) + 3} className={s.yLabel}>
              {formatMoney(v, currency)}
            </text>
          </g>
        ))}
        {view.xTicks.map((t) => (
          <text key={t} x={view.x(t)} y={H - 5} className={s.xLabel}>
            {new Date(t).getMonth() + 1}/{new Date(t).getDate()}
          </text>
        ))}
        <path d={view.area} fill="url(#bal-fill)" />
        <path d={view.d} fill="none" stroke={accent} strokeWidth={1.8} strokeLinejoin="round" />
        {hover && (
          <g>
            <line x1={view.x(hover.t)} x2={view.x(hover.t)} y1={PAD.t} y2={H - PAD.b} className={s.cursor} />
            <circle cx={view.x(hover.t)} cy={view.y(hover.a)} r={3.5} fill={accent} />
          </g>
        )}
      </svg>
      {hover && (
        <div className={s.tip}>
          {formatClock(hover.t)} · <b>{formatMoney(hover.a, currency)}</b>
        </div>
      )}
    </div>
  )
}
