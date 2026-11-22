import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClock } from '@shared/quota'
import type { AppSettings, HistorySeries } from '../../../main/providers/types'
import s from './HistoryChart.module.css'

const H = 3600 * 1000
const GAP_BREAK = 40 * 60 * 1000

interface Line {
  id: string
  label: string
  color: string
  primary: boolean
  segments: { t: number; v: number }[][]
}

/** 手写 SVG 折线：24 小时 / 7 天，重置时刻竖虚线，悬停十字线 */
export function HistoryChart({
  history,
  order,
  primaryId,
  accent,
  mode,
  range,
  now
}: {
  history: HistorySeries | null
  order: { id: string; label: string }[]
  primaryId: string | undefined
  accent: string
  mode: AppSettings['displayMode']
  range: '24h' | '7d'
  now: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(420)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver((es) => setW(Math.max(200, Math.round(es[0].contentRect.width))))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const height = 148
  const pad = { l: 30, r: 10, t: 10, b: 22 }
  const span = range === '24h' ? 24 * H : 7 * 24 * H
  // 时间轴取整到分钟，避免每秒重算
  const end = Math.floor(now / 60000) * 60000
  const start = end - span
  const x = (t: number) => pad.l + ((t - start) / span) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / 100) * (height - pad.t - pad.b)

  const palette = ['#9fb3ff', '#f5b544', '#7bd88f', '#ff8fb1', '#c9a7ff']
  const { lines, resets } = useMemo(() => {
    const lines: Line[] = []
    const resets = new Set<number>()
    if (!history) return { lines, resets: [] as number[] }
    const ids = [...order.map((o) => o.id), ...Object.keys(history.windows).filter((id) => !order.some((o) => o.id === id))]
    let pi = 0
    for (const id of ids) {
      const series = history.windows[id]
      if (!series) continue
      const pts = series.points.filter((p) => p.t >= start - 10 * 60000 && p.t <= end + 60000)
      if (pts.length === 0) continue
      const segments: { t: number; v: number }[][] = []
      let cur: { t: number; v: number }[] = []
      let last: number | null = null
      for (const p of pts) {
        if (last != null && p.t - last > GAP_BREAK) {
          if (cur.length) segments.push(cur)
          cur = []
        }
        cur.push({ t: p.t, v: mode === 'used' ? p.u : 100 - p.u })
        last = p.t
        if (id === primaryId && p.r && p.r >= start && p.r <= end) resets.add(Math.round(p.r / 60000) * 60000)
      }
      if (cur.length) segments.push(cur)
      const primary = id === primaryId
      lines.push({
        id,
        label: order.find((o) => o.id === id)?.label ?? series.label,
        color: primary ? accent : palette[pi++ % palette.length],
        primary,
        segments
      })
    }
    lines.sort((a, b) => Number(a.primary) - Number(b.primary))
    return { lines, resets: [...resets] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, order, primaryId, accent, mode, start, end])

  const xTicks = useMemo(() => {
    const ticks: { t: number; label: string }[] = []
    if (range === '24h') {
      const first = Math.ceil(start / (6 * H)) * 6 * H
      for (let t = first; t <= end; t += 6 * H) {
        const d = new Date(t)
        ticks.push({ t, label: `${String(d.getHours()).padStart(2, '0')}:00` })
      }
    } else {
      const d0 = new Date(start)
      d0.setHours(24, 0, 0, 0)
      for (let t = d0.getTime(); t <= end; t += 24 * H) {
        const d = new Date(t)
        ticks.push({ t, label: `${d.getMonth() + 1}/${d.getDate()}` })
      }
    }
    return ticks
  }, [range, start, end])

  const hasData = lines.some((l) => l.segments.some((s) => s.length > 0))

  const path = (seg: { t: number; v: number }[]) =>
    seg.map((p, i) => `${i ? 'L' : 'M'}${x(Math.max(start, p.t)).toFixed(1)},${y(p.v).toFixed(1)}`).join('')

  const hoverInfo = useMemo(() => {
    if (hover == null) return null
    const t = start + ((hover - pad.l) / (w - pad.l - pad.r)) * span
    const vals = lines
      .map((l) => {
        let best: { t: number; v: number } | null = null
        for (const seg of l.segments)
          for (const p of seg) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
        return best && Math.abs(best.t - t) < (range === '24h' ? 20 : 90) * 60000 ? { l, p: best } : null
      })
      .filter(Boolean) as { l: Line; p: { t: number; v: number } }[]
    return { t, vals }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, lines, w, start, span, range])

  return (
    <div className={s.root} ref={box}>
      <svg
        width={w}
        height={height}
        className={s.svg}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = e.clientX - rect.left
          setHover(px >= pad.l && px <= w - pad.r ? px : null)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="hc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={s.grid} />
            <text x={pad.l - 6} y={y(v) + 3} className={s.yLabel} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <text key={tk.t} x={x(tk.t)} y={height - 6} className={s.xLabel} textAnchor="middle">
            {tk.label}
          </text>
        ))}
        {resets.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={pad.t} y2={height - pad.b} className={s.reset} />
            <text x={x(t) + 3} y={pad.t + 8} className={s.resetLabel}>
              重置
            </text>
          </g>
        ))}
        {lines.map((l) =>
          l.segments.map((seg, i) => (
            <g key={`${l.id}-${i}`}>
              {l.primary && seg.length > 1 && (
                <path
                  d={`${path(seg)}L${x(seg[seg.length - 1].t).toFixed(1)},${y(0)}L${x(Math.max(start, seg[0].t)).toFixed(1)},${y(0)}Z`}
                  fill="url(#hc-area)"
                />
              )}
              <path
                d={path(seg)}
                fill="none"
                stroke={l.color}
                strokeWidth={l.primary ? 2 : 1.3}
                strokeOpacity={l.primary ? 1 : 0.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {seg.length === 1 && <circle cx={x(seg[0].t)} cy={y(seg[0].v)} r={2.5} fill={l.color} />}
            </g>
          ))
        )}
        {hoverInfo && hover != null && (
          <g>
            <line x1={hover} x2={hover} y1={pad.t} y2={height - pad.b} className={s.cross} />
            {hoverInfo.vals.map(({ l, p }) => (
              <circle key={l.id} cx={x(p.t)} cy={y(p.v)} r={3} fill={l.color} stroke="#0b0d12" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      {!hasData && <div className={s.empty}>还没有历史数据 · 每次成功刷新都会记录一个点</div>}
      {hoverInfo && hoverInfo.vals.length > 0 && hover != null && (
        <div className={s.tip} style={{ left: Math.min(hover + 10, w - 150) }}>
          <div className={s.tipTime}>{formatClock(hoverInfo.t)}</div>
          {hoverInfo.vals.map(({ l, p }) => (
            <div key={l.id} className={s.tipRow}>
              <i style={{ background: l.color }} />
              <span>{l.label}</span>
              <b>{Math.round(p.v)}%</b>
            </div>
          ))}
        </div>
      )}
      {lines.length > 1 && (
        <div className={s.legend}>
          {[...lines].reverse().map((l) => (
            <span key={l.id}>
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
