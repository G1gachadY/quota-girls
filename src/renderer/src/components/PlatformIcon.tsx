/**
 * 平台官方图标。来源（均为本机已安装的官方发行包）：
 *   Claude       Anthropic「Claude Code」VS Code 扩展  resources/claude-logo.svg
 *   Codex        OpenAI「Codex」VS Code 扩展           webview/assets/codex-app-ga-logo.png / codex-home-hero-dark-still.png（黑底已转透明）
 *   Antigravity  Antigravity 桌面 App                   app.asar → icon.png（去掉白色圆角底板，只保留拱形标志并裁切）
 * 通知与托盘菜单用的是 resources/platforms/ 下未改动的官方 PNG（Antigravity 带白色底板）。
 * 商标归各自所有者，仅用于标识对应平台。
 */
import type { CSSProperties } from 'react'
import { PLATFORM_META } from '@shared/quota'
import type { PlatformId } from '../../../main/providers/types'
import antigravityLogo from '../assets/platforms/antigravity.png'
import claudeLogo from '../assets/platforms/claude.svg'
import codexLarge from '../assets/platforms/codex-large.png'
import codexLogo from '../assets/platforms/codex.png'

/** 小尺寸（≤64px）用 */
export const PLATFORM_ICONS: Record<PlatformId, string> = {
  claude: claudeLogo,
  codex: codexLogo,
  antigravity: antigravityLogo
}

/** 大尺寸（占位图水印）用 */
export const PLATFORM_ICONS_LARGE: Record<PlatformId, string> = {
  claude: claudeLogo,
  codex: codexLarge,
  antigravity: antigravityLogo
}

/** 按各自图形的留白微调，让三者视觉大小一致 */
const OPTICAL_SCALE: Record<PlatformId, number> = { claude: 1, codex: 1.12, antigravity: 0.96 }

export function PlatformIcon({
  id,
  size = 18,
  className,
  style
}: {
  id: PlatformId
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={className}
      style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, flex: 'none', ...style }}
    >
      <img
        src={PLATFORM_ICONS[id]}
        alt={PLATFORM_META[id].name}
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${OPTICAL_SCALE[id]})` }}
      />
    </span>
  )
}
