import { animate } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fmtPct } from '../model'
import s from './Gauges.module.css'

/** 环形进度（手写 SVG）。value 为填充百分比 0–100，null 表示无数据 */
export function Ring({
  value,
  color,
  size = 88,
  thickness = 7,
  glow = false,
  children,
  className
}: {
  value: number | null
  color: string
  size?: number | string
  thickness?: number
  glow?: boolean
  children?: ReactNode
  className?: string
}) {
  const r = 40 - thickness / 2
  const c = 2 * Math.PI * r
  const v = value == null ? 0 : Math.min(100, Math.max(0, value))
  const ticks = Array.from({ length: 60 }, (_, i) => i)
  return (
    <div
      className={`${s.ring} ${glow ? s.glow : ''} ${className ?? ''}`}
      style={{ width: size, height: size, '--ring-color': color } as CSSProperties}
    >
      <svg viewBox="0 0 100 100">
        <g className={s.ticks}>
          {ticks.map((i) => {
            const a = (i / 60) * Math.PI * 2 - Math.PI / 2
            const major = i % 15 === 0
            const r1 = major ? 44.5 : 46
            const r2 = 48.5
            return (
              <line
                key={i}
                x1={50 + Math.cos(a) * r1}
                y1={50 + Math.sin(a) * r1}
                x2={50 + Math.cos(a) * r2}
                y2={50 + Math.sin(a) * r2}
                className={major ? s.major : undefined}
              />
            )
          })}
        </g>
        <circle cx="50" cy="50" r={r} className={s.track} strokeWidth={thickness} />
        {value != null && (
          <circle
            cx="50"
            cy="50"
            r={r}
            className={s.fill}
            strokeWidth={thickness}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v / 100)}
            transform="rotate(-90 50 50)"
          />
        )}
      </svg>
      {children && <div className={s.center}>{children}</div>}
    </div>
  )
}

/** 细进度条 */
export function Bar({ value, color, height = 4 }: { value: number | null; color: string; height?: number }) {
  return (
    <div className={s.bar} style={{ height, '--bar-color': color } as CSSProperties}>
      {value != null ? (
        <div className={s.barFill} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      ) : (
        <div className={s.barUnknown} />
      )}
    </div>
  )
}

/** 数字滚动变化 */
export function RollingNumber({ value }: { value: number | null }) {
  const [display, setDisplay] = useState<number>(value ?? 0)
  const cur = useRef<number>(value ?? 0)
  useEffect(() => {
    if (value == null) return
    const controls = animate(cur.current, value, {
      duration: 0.9,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        cur.current = v
        setDisplay(v)
      }
    })
    return () => controls.stop()
  }, [value])
  if (value == null) return <>—</>
  return <>{fmtPct(display)}</>
}
