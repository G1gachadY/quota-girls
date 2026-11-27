/**
 * 平台官方图标。来源：
 *   Claude       Anthropic「Claude Code」VS Code 扩展  resources/claude-logo.svg
 *   Codex        OpenAI「Codex」VS Code 扩展           webview/assets/codex-app-ga-logo.png / codex-home-hero-dark-still.png（黑底已转透明）
 *   Antigravity  Antigravity 桌面 App                   app.asar → icon.png（去掉白色圆角底板，只保留拱形标志并裁切）
 *   DeepSeek     官方 GitHub 组织 deepseek-ai 的头像（460px，白底已转透明）
 * 通知与托盘菜单用的是 resources/platforms/ 下未改动的官方 PNG。
 * 商标归各自所有者，仅用于标识对应平台。
 */
import type { CSSProperties } from 'react'
import type { BuiltinId } from '../../../main/providers/types'
import antigravityLogo from '../assets/platforms/antigravity.png'
import claudeLogo from '../assets/platforms/claude.svg'
import codexLarge from '../assets/platforms/codex-large.png'
import codexLogo from '../assets/platforms/codex.png'
import deepseekLogo from '../assets/platforms/deepseek.png'

export type IconKind = BuiltinId

/** 小尺寸（≤64px）用 */
export const PLATFORM_ICONS: Partial<Record<IconKind, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  antigravity: antigravityLogo,
  deepseek: deepseekLogo
}

/** 大尺寸（占位图水印）用 */
export const PLATFORM_ICONS_LARGE: Partial<Record<IconKind, string>> = { ...PLATFORM_ICONS, codex: codexLarge }

/** 按各自图形的留白微调，让视觉大小一致 */
const OPTICAL_SCALE: Partial<Record<IconKind, number>> = { codex: 1.12, antigravity: 0.96, deepseek: 1.08 }

export function PlatformIcon({
  kind,
  name,
  size = 18,
  className,
  style
}: {
  kind: IconKind
  /** 没有图标时显示首字母，也用作 alt */
  name: string
  size?: number
  className?: string
  style?: CSSProperties
}) {
  const src = PLATFORM_ICONS[kind]
  return (
    <span
      className={className}
      style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, flex: 'none', ...style }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: `scale(${OPTICAL_SCALE[kind] ?? 1})`
          }}
        />
      ) : (
        <span
          aria-label={name}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.14)',
            color: '#fff',
            fontSize: Math.max(8, Math.round(size * 0.58)),
            fontWeight: 700,
            lineHeight: 1
          }}
        >
          {[...name.trim()][0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </span>
  )
}
