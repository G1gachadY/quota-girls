/**
 * Claude 网页数据源（Electron 专用）。
 * - 登录：可见 BrowserWindow（partition persist:claude-web）加载 claude.ai/login，用户登录后关闭
 * - 取数：同 partition 的隐藏窗口加载 claude.ai，在页面内 fetch（真实浏览器环境，通过 Cloudflare），取完立即销毁
 * - sessionKey：写入该 partition 的 cookie（secure + httpOnly）
 * 这里的 cookie 只存在本程序自己的 partition，与任何平台凭据文件无关。
 */
import { BrowserWindow, app, session } from 'electron'
import { pickChatOrg, type ClaudeWebDeps, type ClaudeWebResult } from './providers/claude'
import { get, str } from './util'

export const CLAUDE_PARTITION = 'persist:claude-web'
const ORIGIN = 'https://claude.ai'

let uaApplied = false
function claudeSession(): Electron.Session {
  const s = session.fromPartition(CLAUDE_PARTITION)
  if (!uaApplied) {
    // 去掉 UA 里的 "Electron/x" 与应用名，得到普通 Chromium UA，降低被风控拦截的概率
    const ua = app.userAgentFallback
      .replace(/\sElectron\/\S+/i, '')
      .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '')
    s.setUserAgent(ua)
    // 网页里不需要任何权限
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    uaApplied = true
  }
  return s
}

export async function hasClaudeWebSession(): Promise<boolean> {
  try {
    const cookies = await claudeSession().cookies.get({ url: ORIGIN, name: 'sessionKey' })
    return cookies.some((c) => !!c.value)
  } catch {
    return false
  }
}

function hiddenWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: {
      session: claudeSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      images: false,
      backgroundThrottling: false
    }
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

const pageFetch = (p: string) => `
  (async () => {
    try {
      const r = await fetch(${JSON.stringify(p)}, { credentials: 'include', headers: { accept: 'application/json' } });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text) } catch (e) {}
      return { status: r.status, json };
    } catch (e) { return { status: 0, json: String(e) } }
  })()`

let inflight: Promise<ClaudeWebResult> | null = null

export function fetchClaudeWeb(): Promise<ClaudeWebResult> {
  if (inflight) return inflight
  inflight = (async () => {
    const win = hiddenWindow()
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          win.webContents.once('dom-ready', () => resolve())
          win.webContents.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
            if (isMainFrame && code !== -3) reject(new Error(`加载 claude.ai 失败：${desc} (${code})`))
          })
          win.loadURL(ORIGIN).catch(() => {
            /* 由 did-fail-load / 超时处理 */
          })
        }),
        30000,
        '加载 claude.ai 超时'
      )
      const run = (p: string) =>
        withTimeout(win.webContents.executeJavaScript(pageFetch(p), true), 20000, `请求 ${p} 超时`) as Promise<{
          status: number
          json: unknown
        }>
      const orgs = await run('/api/organizations')
      const out: ClaudeWebResult = { orgsStatus: orgs.status, orgs: orgs.json }
      if (orgs.status !== 200) return out
      const org = pickChatOrg(orgs.json)
      const uuid = str(get(org, 'uuid'))
      if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) return out
      const usage = await run(`/api/organizations/${uuid}/usage`)
      out.usageStatus = usage.status
      out.usage = usage.json
      try {
        const account = await run('/api/account')
        if (account.status === 200) out.account = account.json
      } catch {
        /* 可选 */
      }
      return out
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export const claudeWebDeps: ClaudeWebDeps = {
  hasSession: hasClaudeWebSession,
  fetch: fetchClaudeWeb
}

let loginWin: BrowserWindow | null = null

/** 打开 claude.ai 登录窗口；登录成功（拿到 sessionKey）后自动关闭；关闭时回调 */
export function openClaudeLogin(parent: BrowserWindow | null, onClosed: () => void): void {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus()
    return
  }
  const s = claudeSession()
  loginWin = new BrowserWindow({
    width: 1000,
    height: 760,
    title: '登录 claude.ai（登录完成后自动关闭）',
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: { session: s, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const win = loginWin
  // 只允许在 claude.ai / anthropic / 常见登录域名内导航；其它链接用系统浏览器以外的方式一律拒绝
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(claude\.ai|anthropic\.com|google\.com|accounts\.google\.com|apple\.com)\//i.test(url)) {
      win.loadURL(url).catch(() => {})
    }
    return { action: 'deny' }
  })
  const onCookie = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
    if (!removed && cookie.name === 'sessionKey' && /claude\.ai$/.test(cookie.domain ?? '') && cookie.value) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.close()
      }, 1500)
    }
  }
  s.cookies.on('changed', onCookie)
  win.on('closed', () => {
    s.cookies.removeListener('changed', onCookie)
    loginWin = null
    onClosed()
  })
  win.loadURL(`${ORIGIN}/login`).catch(() => {})
}

export async function setClaudeSessionKey(key: string): Promise<{ ok: boolean; message: string }> {
  const v = key.trim()
  if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(v)) {
    return { ok: false, message: 'sessionKey 格式不对：应以 sk-ant- 开头' }
  }
  await claudeSession().cookies.set({
    url: ORIGIN,
    name: 'sessionKey',
    value: v,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400
  })
  return { ok: true, message: '已保存，正在用网页数据源刷新' }
}

export async function clearClaudeWeb(): Promise<void> {
  await claudeSession().clearStorageData()
}
