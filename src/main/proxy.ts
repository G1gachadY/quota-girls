/**
 * 判断"代理是否开着"：Claude / Codex 只在有代理时才刷新（访问国外网站）。
 *   1. TUN 模式：存在代理软件创建的虚拟网卡（Mihomo / Clash / sing-box / Wintun …），
 *      或者网卡地址落在 198.18.0.0/15（TUN 常用的保留网段）；
 *   2. 系统代理：Windows 系统代理开关打开（用 Chromium 的代理解析结果判断，和 net.fetch 走的一样）。
 * 只开着 Clash 但没开 TUN / 系统代理，不算开着。结果缓存 10 秒。
 */
import { app, session } from 'electron'
import os from 'node:os'

const TUN_NAME = /mihomo|clash|meta|wintun|\btun\b|sing-?box|v2ray|xray|nekoray|hiddify|surge|wireguard/i

function inTunRange(ip: string): boolean {
  const m = /^198\.(18|19)\.\d+\.\d+$/.exec(ip)
  return !!m
}

export function tunActive(): boolean {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const v4 = (addrs ?? []).filter((a) => a.family === 'IPv4' && !a.internal)
    if (v4.length === 0) continue
    if (TUN_NAME.test(name) || v4.some((a) => inTunRange(a.address))) return true
  }
  return false
}

export async function systemProxyActive(): Promise<boolean> {
  try {
    const r = await session.defaultSession.resolveProxy('https://claude.ai')
    return /\b(PROXY|SOCKS5?|HTTPS)\s/i.test(r)
  } catch {
    return false
  }
}

let cache: { at: number; on: boolean; via: string } | null = null

/** 代理是否开着；via 说明是怎么判断的（显示在原始响应里） */
export async function proxyState(): Promise<{ on: boolean; via: string }> {
  // 开发调试：QG_FORCE_PROXY=on / off 强制指定（只在开发版生效）
  const forced = !app.isPackaged ? process.env.QG_FORCE_PROXY : undefined
  if (forced === 'on' || forced === 'off') return { on: forced === 'on', via: '开发调试强制' }
  if (cache && Date.now() - cache.at < 10_000) return cache
  let via = ''
  if (tunActive()) via = 'TUN 网卡'
  else if (await systemProxyActive()) via = '系统代理'
  cache = { at: Date.now(), on: !!via, via: via || '无' }
  return cache
}
