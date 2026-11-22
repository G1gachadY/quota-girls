import { useEffect, useState, type CSSProperties } from 'react'
import type { PlatformId } from '../../../main/providers/types'
import s from './ArtImage.module.css'
import { PLATFORM_ICONS_LARGE, type IconKind } from './PlatformIcon'

type Slot = 'card' | 'hero' | 'avatar'

const SLOT_INFO: Record<Slot, { file: string; size: string; zone: string }> = {
  card: { file: 'card.png', size: '1024×1536', zone: '角色位于上方 10–58%' },
  hero: { file: 'hero.png', size: '1536×1024', zone: '角色位于右侧 45–100%' },
  avatar: { file: 'avatar.png', size: '1024×1024', zone: '' }
}

/** "50% 21%" / "center top" → [x%, y%] */
function parseFocus(focus: string): [number, number] {
  const kw: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }
  const parts = focus.trim().split(/\s+/)
  const val = (t: string | undefined) => (t == null ? 50 : t in kw ? kw[t] : parseFloat(t) || 0)
  if (parts.length === 1 && (parts[0] === 'top' || parts[0] === 'bottom')) return [50, val(parts[0])]
  return [val(parts[0]), val(parts[1])]
}

/**
 * 插画：有图就显示，缺图 / 加载失败时用 CSS 占位图
 * （平台强调色斜向渐变 + 细斜线纹理 + 巨大半透明平台官方图标 + 虚线安全区说明）。
 *   layout="cover"  object-fit: cover + focus（object-position）
 *   layout="side"   竖版图放进横版槽位：整幅靠右显示，背后用同一张图虚化铺满
 *   crop={0.42}     以 focus 为脸部中心，裁出边长为原图宽 42% 的方块（迷你挂件头像）
 */
export function ArtImage({
  url,
  focus,
  slot,
  platform,
  kind,
  accent,
  letter,
  layout = 'cover',
  crop,
  className,
  style
}: {
  url?: string
  focus: string
  slot: Slot
  platform: PlatformId
  /** 选水印图标用；没有官方图标的类型显示首字母 */
  kind?: IconKind
  accent: string
  letter: string
  layout?: 'cover' | 'side'
  crop?: number
  className?: string
  style?: CSSProperties
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  const vars = { '--accent': accent, ...style } as CSSProperties

  if (url && !failed && layout === 'side') {
    return (
      <div className={`${s.wrap} ${s.side} ${className ?? ''}`} style={vars}>
        <img src={url} alt="" aria-hidden draggable={false} className={s.sideBg} />
        <img src={url} alt="" draggable={false} className={s.sideFg} onError={() => setFailed(true)} />
      </div>
    )
  }

  if (url && !failed && crop) {
    const [fx, fy] = parseFocus(focus)
    return (
      <div className={`${s.wrap} ${className ?? ''}`} style={vars}>
        <img
          src={url}
          alt=""
          draggable={false}
          className={s.crop}
          style={{ width: `${100 / crop}%`, transform: `translate(-${fx}%, -${fy}%)` }}
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  if (url && !failed) {
    return (
      <div className={`${s.wrap} ${className ?? ''}`} style={vars}>
        <img
          src={url}
          alt=""
          draggable={false}
          className={s.img}
          style={{ objectPosition: focus }}
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  const info = SLOT_INFO[slot]
  return (
    <div className={`${s.wrap} ${s.ph} ${s[slot]} ${className ?? ''}`} style={vars}>
      {slot === 'avatar' || !(kind && PLATFORM_ICONS_LARGE[kind]) ? (
        <div className={`${s.letter} ${slot !== 'avatar' ? s.bigLetter : ''}`}>{letter}</div>
      ) : (
        <img className={s.logoMark} src={PLATFORM_ICONS_LARGE[kind]} alt="" draggable={false} />
      )}
      {slot !== 'avatar' && (
        <div className={s.safe}>
          <div className={s.safeTag}>插画槽位</div>
          <div className={s.safePath}>
            art/{platform}/{info.file}
          </div>
          <div className={s.safeMeta}>
            {info.size} · {info.zone}
          </div>
          <div className={s.face} />
        </div>
      )}
    </div>
  )
}
