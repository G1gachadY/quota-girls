import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { formatAgo, formatClock, levelOf, remainingOf } from '@shared/quota'
import type { AppSettings, PlatformId } from '../../../main/providers/types'
import { ArtImage } from '../components/ArtImage'
import { Bar, Ring, RollingNumber } from '../components/Gauges'
import { HistoryChart } from '../components/HistoryChart'
import { IconAlert } from '../components/Icons'
import { PlatformIcon } from '../components/PlatformIcon'
import { SafeZones } from '../components/SafeZones'
import { ValuePanel } from '../components/ValuePanel'
import {
  SOURCE_LABELS,
  displayValue,
  fmtPct,
  levelColor,
  moodOf,
  pickArt,
  resetText,
  statusText,
  type PlatformView
} from '../model'
import { useHistory, useValue } from '../state'
import s from './Detail.module.css'

export function Detail({
  view: v,
  settings,
  now,
  guides,
  refreshing,
  onRecheck
}: {
  view: PlatformView
  settings: AppSettings
  now: number
  guides: boolean
  refreshing: boolean
  onRecheck: (p: PlatformId) => void
}) {
  const [range, setRange] = useState<'24h' | '7d'>('24h')
  const history = useHistory(v.id, v.snap.fetchedAt)
  const apiValue = useValue(v.id, v.snap.fetchedAt)
  const [valueRange, setValueRange] = useState<'session' | 'weekly' | 'month'>('weekly')
  const mode = settings.displayMode
  const value = displayValue(v.primary, mode)
  const st = statusText(v, now)
  const order = useMemo(() => v.windows.map((w) => ({ id: w.id, label: w.label })), [v.windows])
  const style = { '--accent': v.manifest.accent, '--accent2': v.manifest.accent2 } as CSSProperties
  // 差分：横版优先，没有就把竖版靠右整幅显示；都没有时原图加滤镜
  const mood = moodOf(v.level)
  const art = pickArt(v.files, v.manifest, 'hero', mood)
  const artMod = v.disconnected
    ? s.dim
    : art.variant
      ? undefined
      : mood === 'empty'
        ? s.artEmpty
        : mood === 'low'
          ? s.artLow
          : undefined

  return (
    <div className={s.root} style={style}>
      {/* 背景：交叉淡化 400ms，角色从右侧 40px 滑入（切换平台或差分时） */}
      <AnimatePresence initial={false}>
        <motion.div
          key={`${v.id}|${art.url ?? ''}`}
          className={s.bg}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <motion.div
            className={s.bgInner}
            initial={{ x: 40 }}
            animate={{ x: 0 }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <ArtImage
              url={art.url}
              focus={art.focus}
              layout={art.layout}
              slot="hero"
              platform={v.id}
              accent={v.manifest.accent}
              letter={v.meta.name[0]}
              className={artMod}
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>
      <div className={s.shade} />
      {guides && <SafeZones kind="hero" />}

      <aside className={s.vertical}>
        <span className={s.vNo}>
          NO.{v.meta.no} · {v.meta.en}
        </span>
        <span className={s.vName}>{v.manifest.name}</span>
        <span className={s.vTitle}>{v.manifest.title}</span>
      </aside>

      <motion.section
        key={`panel-${v.id}`}
        className={`${s.panel} glass hud-corners`}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <header className={s.head}>
          <div className="deco">NO.{v.meta.no} · CHARACTER STATUS</div>
          <h1 className={s.h1}>
            <span className={s.h1Icon}>
              <PlatformIcon id={v.id} size={24} />
            </span>
            {v.meta.en}
            {v.snap.plan && <span className={s.plan}>{v.snap.plan}</span>}
          </h1>
          <div className={s.account}>{v.snap.account ?? '—'}</div>
        </header>

        <div className={s.hero}>
          <Ring value={value} color={v.color} size={156} thickness={6} glow={v.level === 'low'}>
            <div className={s.ringNum} style={{ color: v.color }}>
              <RollingNumber value={value} />
              {value != null && <small>%</small>}
            </div>
            <div className={s.ringLabel}>{mode === 'used' ? v.copy.usedLabel : v.copy.stamina}</div>
          </Ring>
          <div className={s.heroInfo}>
            <div className="deco">{mode === 'used' ? 'USED' : v.copy.staminaEn} · {v.primary?.label ?? '—'}</div>
            <div className={s.cdBig}>{resetText(v.primary, now, v.copy)}</div>
            {v.primary?.resetsAt && <div className={s.resetAt}>RESET AT {formatClock(Date.parse(v.primary.resetsAt))}</div>}
            {v.level === 'empty' && <div className={s.emptyTag}>{v.copy.exhausted}</div>}
          </div>
        </div>

        {v.snap.error && v.snap.status !== 'ok' && (
          <div className={s.alert}>
            <IconAlert className={s.alertIcon} />
            <div>
              <div className={s.alertMsg}>{v.snap.error.message}</div>
              <div className={s.alertHint}>{v.snap.error.hint}</div>
            </div>
            <button className={s.btn} onClick={() => onRecheck(v.id)} disabled={refreshing}>
              {refreshing ? '检查中…' : '重新检查'}
            </button>
          </div>
        )}

        <Section title="全部窗口" en="ALL WINDOWS" />
        <ul className={s.windows}>
          {v.windows.length === 0 && <li className={s.muted}>{v.snap.note ?? '暂无数据'}</li>}
          {v.windows.map((w) => {
            const dv = displayValue(w, mode)
            const lv = levelOf(remainingOf(w))
            return (
              <li key={w.id} className={s.winRow}>
                <span className={s.winLabel}>
                  {w.label}
                  {w.id === v.primary?.id && <i className={s.primaryTag}>主</i>}
                </span>
                <Bar value={dv} color={levelColor(lv, v.manifest.accent)} height={5} />
                <span className={s.winPct} style={{ color: levelColor(lv, v.manifest.accent) }}>
                  {dv == null ? '—' : `${fmtPct(dv)}%`}
                </span>
                <span className={s.winReset}>{resetText(w, now, v.copy)}</span>
              </li>
            )
          })}
        </ul>

        <Section
          title="等价 API 价值"
          en="API VALUE"
          right={
            <div className={s.seg}>
              {(
                [
                  ['session', '5H'],
                  ['weekly', '本周'],
                  ['month', '30天']
                ] as const
              ).map(([id, text]) => (
                <button key={id} className={valueRange === id ? s.segOn : ''} onClick={() => setValueRange(id)}>
                  {text}
                </button>
              ))}
            </div>
          }
        />
        <ValuePanel report={apiValue} rangeId={valueRange} platform={v.id} />

        <Section
          title={range === '24h' ? '近 24 小时' : '近 7 天'}
          en="HISTORY"
          right={
            <div className={s.seg}>
              <button className={range === '24h' ? s.segOn : ''} onClick={() => setRange('24h')}>
                24H
              </button>
              <button className={range === '7d' ? s.segOn : ''} onClick={() => setRange('7d')}>
                7D
              </button>
            </div>
          }
        />
        <HistoryChart
          history={history}
          order={order}
          primaryId={v.primary?.id}
          accent={v.manifest.accent}
          mode={mode}
          range={range}
          now={now}
        />

        {(v.snap.extras?.credits || v.snap.extras?.extraUsage) && (
          <>
            <Section title="额外额度 / 余额" en="EXTRAS" />
            <div className={s.extras}>
              {v.snap.extras?.extraUsage && (
                <div>
                  <span>额外用量</span>
                  <b>{v.snap.extras.extraUsage}</b>
                </div>
              )}
              {v.snap.extras?.credits && (
                <div>
                  <span>Credits</span>
                  <b>{v.snap.extras.credits}</b>
                </div>
              )}
            </div>
          </>
        )}

        <footer className={s.foot}>
          <span className={s.status}>
            <i className={s.dot} style={{ background: st.dot }} />
            {st.text}
          </span>
          <span>
            数据源 {SOURCE_LABELS[v.snap.source] ?? v.snap.source} · {formatAgo(v.snap.fetchedAt, now)}
          </span>
        </footer>
      </motion.section>
    </div>
  )
}

function Section({ title, en, right }: { title: string; en: string; right?: ReactNode }) {
  return (
    <div className={s.section}>
      <span className={s.sTitle}>{title}</span>
      <span className="deco">{en}</span>
      <span className={s.sLine} />
      {right}
    </div>
  )
}
