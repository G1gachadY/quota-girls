/**
 * Windows 通知：
 * - 低于阈值："Codex 酱体力只剩 18% 了"
 * - 窗口重置后："Claude 酱体力回满啦！"（仅当重置前剩余 ≤50% 时提醒，避免每 5 小时都打扰）
 * 每个窗口每个周期只提醒一次（按 resetsAt 区分周期，记录持久化）。
 */
import { Notification } from 'electron'
import fs from 'node:fs'
import { PLATFORM_META, copyFor, effectiveWindow, formatCountdown } from '../shared/quota'
import type { PlatformId, PlatformSnapshot } from './providers/types'
import type { Store } from './store'

const CYCLE_ROUND = 15 * 60 * 1000

function cycleOf(resetsAt: string | null): string {
  if (!resetsAt) return 'none'
  const t = Date.parse(resetsAt)
  return Number.isFinite(t) ? String(Math.round(t / CYCLE_ROUND)) : 'none'
}

export function checkNotifications(
  store: Store,
  p: PlatformId,
  prev: PlatformSnapshot | undefined,
  next: PlatformSnapshot,
  onClick: () => void,
  /** 平台官方图标 PNG（通知左侧大图标） */
  iconPath?: string
): void {
  const show = (title: string, body: string, click: () => void) => showToast(title, body, click, iconPath)
  if (next.status !== 'ok' || !Notification.isSupported()) return
  const s = store.settings.data
  const copy = copyFor(s.copyStyle)
  const who = copy.char(PLATFORM_META[p].name)
  const now = Date.now()

  for (const w of next.windows) {
    if (!w.known || w.usedPercent == null) continue
    const remaining = Math.max(0, 100 - w.usedPercent)

    if (s.notifyLow && remaining < s.alertThreshold) {
      const key = `low:${p}:${w.id}:${cycleOf(w.resetsAt)}`
      if (store.markNotified(key)) {
        const pct = Math.round(remaining)
        const title =
          remaining <= 0.5
            ? `${who}${copy.exhausted}了`
            : s.copyStyle === 'game'
              ? `${who}体力只剩 ${pct}% 了`
              : `${who} 剩余额度仅 ${pct}%`
        const when = w.resetsAt ? `，${formatCountdown(Date.parse(w.resetsAt) - now)}${copy.resetSuffix}` : ''
        show(title, `${w.label}窗口${when}`, onClick)
      }
    }

    if (s.notifyReset && prev) {
      const pw = prev.windows.find((x) => x.id === w.id)
      if (pw && pw.known && pw.usedPercent != null && pw.resetsAt) {
        const prevRemaining = 100 - pw.usedPercent
        const passed = effectiveWindow(pw, now + 60 * 1000).resetsAt === null
        if (passed && prevRemaining <= 50 && remaining >= prevRemaining + 20) {
          const key = `reset:${p}:${w.id}:${cycleOf(pw.resetsAt)}`
          if (store.markNotified(key)) {
            show(
              s.copyStyle === 'game' ? `${who}体力回满啦！` : `${who} 额度已重置`,
              `${w.label} 现在剩余 ${Math.round(remaining)}%`,
              onClick
            )
          }
        }
      }
    }
  }
}

function showToast(title: string, body: string, onClick: () => void, icon?: string): void {
  const n = new Notification({ title, body, silent: false, ...(icon && fs.existsSync(icon) ? { icon } : {}) })
  n.on('click', onClick)
  n.show()
}
