import { forwardRef, type CSSProperties } from 'react'
import type { AppSettings } from '../../../main/providers/types'
import { ArtImage } from '../components/ArtImage'
import { Bar, Ring, RollingNumber } from '../components/Gauges'
import { IconAlert } from '../components/Icons'
import { PlatformIcon } from '../components/PlatformIcon'
import { SafeZones } from '../components/SafeZones'
import { displayValue, fmtPct, levelColor, moodOf, pickArt, resetText, statusText, type PlatformView } from '../model'
import { levelOf, remainingOf } from '@shared/quota'
import s from './Card.module.css'

interface Props {
  view: PlatformView
  settings: AppSettings
  now: number
  guides: boolean
  onOpen: () => void
  onSettings: () => void
  onRecheck: () => void
  refreshing: boolean
}

export const CharacterCard = forwardRef<HTMLDivElement, Props>(function CharacterCard(
  { view: v, settings, now, guides, onOpen, onSettings, onRecheck, refreshing },
  ref
) {
  const mode = settings.displayMode
  const value = displayValue(v.primary, mode)
  const st = statusText(v, now)
  const loading = v.snap.status === 'loading' && !v.hasData
  const showAlert =
    (v.snap.status === 'auth_expired' || v.snap.status === 'error' || v.snap.status === 'not_configured') &&
    !!v.snap.error
  const alertToSettings = v.snap.status === 'not_configured'
  const dim = v.snap.status === 'offline' || v.snap.status === 'not_configured' || (v.disconnected && !loading)
  // 'Claude/GPT·5小时' → 环中心显示 '5小时'，组名放到 STAMINA 旁
  const labelParts = (v.primary?.label ?? '—').split('·')
  const winPart = labelParts.length > 1 ? labelParts.slice(1).join('·') : labelParts[0]
  const groupPart = labelParts.length > 1 ? labelParts[0] : null

  // 差分立绘：<20% 换紧张差分，耗尽换耗尽差分（竖版优先，没有就裁横版）；都没有时用 CSS 滤镜
  const mood = moodOf(v.level)
  const art = pickArt(v.files, v.manifest, 'card', mood)
  const artMod = art.variant ? '' : mood === 'empty' ? s.artEmpty : mood === 'low' ? s.artLow : ''

  const style = {
    '--accent': v.manifest.accent,
    '--accent2': v.manifest.accent2,
    '--state': v.color
  } as CSSProperties

  return (
    <div
      ref={ref}
      className={`${s.card} ${dim ? s.dim : ''} ${v.level === 'low' || v.level === 'empty' ? s.isLow : ''}`}
      style={style}
      onClick={() => (v.disconnected ? onSettings() : onOpen())}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className={`${s.art} ${artMod}`}>
        <ArtImage
          url={art.url}
          focus={art.focus}
          slot="card"
          platform={v.id}
          accent={v.manifest.accent}
          letter={v.meta.name[0]}
        />
      </div>
      {mood === 'low' && !art.variant && <div className={s.lowVignette} />}
      <div className={s.topShade} />
      <div className={s.bottomShade} />
      <div className={`${s.frame} hud-corners`} />

      <div className={s.header}>
        <div className={s.titleBlock}>
          <span className={s.iconBadge}>
            <PlatformIcon id={v.id} size={18} />
          </span>
          <span className={s.titleText}>
            <span className={s.no}>NO.{v.meta.no}</span>
            <span className={s.name}>{v.meta.en}</span>
          </span>
        </div>
        {v.snap.plan && <span className={s.plan}>{v.snap.plan}</span>}
      </div>

      {v.level === 'empty' && (
        <div className={`${s.stamp} ${art.variant ? s.stampCompact : ''}`}>
          <div className={s.stampMain}>{v.copy.exhausted}</div>
          <div className={s.stampSub}>EXHAUSTED · {resetText(v.primary, now, v.copy)}</div>
        </div>
      )}

      {v.disconnected && !loading && (
        <div className={s.disconnected}>
          <div className={s.discMain}>{v.snap.status === 'offline' ? '未运行' : '未连接'}</div>
          <div className={s.discSub}>{v.snap.status === 'offline' ? v.snap.error?.hint ?? '打开后自动读取' : '点击设置'}</div>
        </div>
      )}

      <div className={`${s.panel} glass`}>
        {loading ? (
          <Skeleton />
        ) : (
          <>
            <div className={s.mainRow}>
              <Ring
                value={value}
                color={v.color}
                glow={v.level === 'low'}
                className={s.ringBox}
                size="var(--ring)"
              >
                <span className={s.ringLabel}>{winPart}</span>
              </Ring>
              <div className={s.mainNum}>
                <div className={s.kicker}>
                  <span className="deco">{mode === 'used' ? 'USED' : v.copy.staminaEn}</span>
                  {groupPart && <span className={s.kickerGroup}>{groupPart}</span>}
                </div>
                <div className={`${s.big} ${v.level === 'low' ? s.breathe : ''}`} style={{ color: v.color }}>
                  <RollingNumber value={value} />
                  {value != null && <span className={s.pct}>%</span>}
                </div>
                <div className={s.bigLabel}>{mode === 'used' ? v.copy.usedLabel : v.copy.stamina}</div>
              </div>
            </div>

            <div className={s.countdown}>
              <span className="deco">RESET IN</span>
              <span className={s.cdText}>{resetText(v.primary, now, v.copy)}</span>
            </div>

            {showAlert ? (
              <div className={s.alert} onClick={(e) => e.stopPropagation()}>
                <IconAlert className={s.alertIcon} />
                <div className={s.alertBody}>
                  <div className={s.alertMsg}>{v.snap.error!.message}</div>
                  <div className={s.alertHint}>{v.snap.error!.hint}</div>
                </div>
                {alertToSettings ? (
                  <button className={s.recheck} onClick={onSettings}>
                    去设置
                  </button>
                ) : (
                  <button className={s.recheck} onClick={onRecheck} disabled={refreshing}>
                    {refreshing ? '检查中…' : '重新检查'}
                  </button>
                )}
              </div>
            ) : (
              <div className={s.bars}>
                {v.others.slice(0, 3).map((w, i) => {
                  const dv = displayValue(w, mode)
                  const lv = levelOf(remainingOf(w))
                  return (
                    <div key={w.id} className={`${s.barRow} ${i === 2 ? s.third : ''}`}>
                      <span className={s.barLabel} title={w.label}>
                        {w.label}
                      </span>
                      <Bar value={dv} color={levelColor(lv, v.manifest.accent)} />
                      <span className={s.barPct}>{dv == null ? '—' : `${fmtPct(dv)}%`}</span>
                    </div>
                  )
                })}
                {v.others.length === 0 && v.snap.note && <div className={s.note}>{v.snap.note}</div>}
              </div>
            )}

            <div className={s.footer}>
              <span className={s.status}>
                <i className={s.dot} style={{ background: st.dot, animation: st.pulse ? 'pulse-dot 1.2s infinite' : undefined }} />
                {st.text}
              </span>
              <span className="deco">{v.manifest.name}</span>
            </div>
          </>
        )}
      </div>

      {guides && <SafeZones kind="card" />}
    </div>
  )
})

function Skeleton() {
  return (
    <div className={s.skeleton}>
      <div className={s.mainRow}>
        <div className={`skeleton ${s.skRing}`} />
        <div style={{ flex: 1, display: 'grid', gap: 8 }}>
          <div className="skeleton" style={{ height: 10, width: '40%' }} />
          <div className="skeleton" style={{ height: 34, width: '62%' }} />
          <div className="skeleton" style={{ height: 10, width: '30%' }} />
        </div>
      </div>
      <div className="skeleton" style={{ height: 10, width: '55%', marginTop: 12 }} />
      <div className="skeleton" style={{ height: 6, width: '100%', marginTop: 14 }} />
      <div className="skeleton" style={{ height: 6, width: '100%', marginTop: 10 }} />
    </div>
  )
}
