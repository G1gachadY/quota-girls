/**
 * 额度娘 Quota Girls —— main 进程：窗口、托盘、IPC、定时调度、通知。
 * 凭据读取、网络请求、进程探测全部在这里完成；renderer 只拿脱敏后的数字快照。
 */
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, session, shell } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { DEFAULT_SETTINGS, PLATFORM_IDS, PLATFORM_META, pickPrimary, remainingOf } from '../shared/quota'
import { ensureEditableArtDir, getArtState, registerArtProtocol, registerArtScheme, watchArt } from './art'
import { clearClaudeWeb, hasClaudeWebSession, openClaudeLogin, setClaudeSessionKey } from './claude-web'
import { checkNotifications } from './notify'
import type { AppSettings, AppState, PlatformId } from './providers/types'
import { Scheduler } from './scheduler'
import { Store } from './store'
import { getValueReport } from './usage'

const APP_ID = 'com.quotagirls.app'
const isDev = !app.isPackaged
const startHidden = process.argv.includes('--hidden')

registerArtScheme()

// 开发调试：QG_USER_DATA=<目录> 时用独立的数据目录，可以和已安装的正式版同时运行
if (isDev && process.env.QG_USER_DATA) app.setPath('userData', process.env.QG_USER_DATA)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let store: Store
let scheduler: Scheduler
let mainWin: BrowserWindow | null = null
let miniWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let claudeWebLoggedIn = false
let stopWatch: (() => void) | null = null

function resource(name: string): string {
  return isDev ? path.join(app.getAppPath(), 'resources', name) : path.join(process.resourcesPath, 'resources', name)
}

function rendererUrl(hash = ''): { url?: string; file?: string; hash: string } {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (isDev && dev) return { url: dev + (hash ? `#${hash}` : ''), hash }
  return { file: path.join(__dirname, '../renderer/index.html'), hash }
}

function loadRenderer(win: BrowserWindow, hash = ''): void {
  const r = rendererUrl(hash)
  if (r.url) void win.loadURL(r.url)
  else void win.loadFile(r.file!, r.hash ? { hash: r.hash } : undefined)
}

/** 只接受来自本程序页面的 IPC */
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const dev = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file://') || (!!dev && url.startsWith(dev))
}

function hardenAppWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(url.startsWith('file://') || (dev && url.startsWith(dev)))) e.preventDefault()
  })
}

const webPreferences = (): Electron.WebPreferences => ({
  preload: path.join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false
})

// ───────────────────────── 主窗口 ─────────────────────────

function createMainWindow(show: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#0B0D12',
    title: '额度娘 Quota Girls',
    icon: resource('icon.png'),
    webPreferences: webPreferences()
  })
  hardenAppWindow(win)
  win.once('ready-to-show', () => {
    if (show) win.show()
  })
  // 开发调试：QG_CAPTURE=<png 路径> 时，载入 8 秒后把本窗口截成图片（只截本程序自己的窗口）；
  // QG_CAPTURE_JS=<脚本> 会在截图前 3 秒在页面里执行（比如点开详情页），仅开发时有效
  const capture = isDev ? process.env.QG_CAPTURE : undefined
  if (capture) {
    win.webContents.once('did-finish-load', () => {
      const script = process.env.QG_CAPTURE_JS
      if (script) setTimeout(() => !win.isDestroyed() && win.webContents.executeJavaScript(script).catch(() => {}), 5000)
      setTimeout(async () => {
        if (win.isDestroyed()) return
        const img = await win.webContents.capturePage()
        await import('node:fs').then((fs) => fs.promises.writeFile(capture, img.toPNG()))
        console.log('[capture] saved', capture)
      }, 8000)
    })
  }
  win.on('maximize', () => win.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win.webContents.send('win:maximized', false))
  win.on('close', (e) => {
    if (!quitting && store.settings.data.closeToTray) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWin = null
    if (!store.settings.data.closeToTray && !quitting) {
      quitting = true
      app.quit()
    }
  })
  loadRenderer(win)
  return win
}

function showMain(): void {
  if (!mainWin || mainWin.isDestroyed()) mainWin = createMainWindow(true)
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

// ───────────────────────── 迷你挂件 ─────────────────────────

const MINI_W = 360
const MINI_H = 132

function createMiniWindow(): BrowserWindow {
  const s = store.settings.data
  const wa = screen.getPrimaryDisplay().workArea
  let { x, y } = s.miniPosition ?? { x: wa.x + wa.width - MINI_W - 24, y: wa.y + wa.height - MINI_H - 24 }
  // 防止上次位置在已拔掉的显示器上
  const visible = screen.getAllDisplays().some(
    (d) => x >= d.workArea.x - 40 && y >= d.workArea.y - 40 && x < d.workArea.x + d.workArea.width - 40 && y < d.workArea.y + d.workArea.height - 40
  )
  if (!visible) {
    x = wa.x + wa.width - MINI_W - 24
    y = wa.y + wa.height - MINI_H - 24
  }
  const win = new BrowserWindow({
    width: MINI_W,
    height: MINI_H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: s.miniAlwaysOnTop,
    show: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: '额度娘 · 迷你挂件',
    webPreferences: webPreferences()
  })
  hardenAppWindow(win)
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    miniWin = null
    updateTrayMenu()
  })
  loadRenderer(win, 'mini')
  return win
}

function toggleMini(): void {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.close()
  } else {
    miniWin = createMiniWindow()
  }
  updateTrayMenu()
}

let savePosTimer: NodeJS.Timeout | null = null
function moveMini(x: number, y: number): void {
  if (!miniWin || miniWin.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return
  miniWin.setBounds({ x: Math.round(x), y: Math.round(y), width: MINI_W, height: MINI_H })
  if (savePosTimer) clearTimeout(savePosTimer)
  savePosTimer = setTimeout(() => {
    if (miniWin && !miniWin.isDestroyed()) {
      const [px, py] = miniWin.getPosition()
      store.updateSettings({ miniPosition: { x: px, y: py } })
    }
  }, 400)
}

// ───────────────────────── 托盘 ─────────────────────────

function trayTooltip(): string {
  const s = store.settings.data
  const parts = PLATFORM_IDS.map((p) => {
    const w = pickPrimary(scheduler.snapshots[p], s.primaryRule[p])
    const r = remainingOf(w)
    return `${PLATFORM_META[p].name} ${r == null ? '—' : `${Math.round(r)}%`}`
  })
  return `额度娘 · 剩余\n${parts.join('  ')}`.slice(0, 127)
}

const trayIcons = new Map<PlatformId, Electron.NativeImage>()
function platformTrayIcon(p: PlatformId): Electron.NativeImage | undefined {
  if (!trayIcons.has(p)) {
    const img = nativeImage.createFromPath(resource(path.join('platforms', `${p}.png`)))
    trayIcons.set(p, img.isEmpty() ? img : img.resize({ width: 16, height: 16, quality: 'best' }))
  }
  const img = trayIcons.get(p)!
  return img.isEmpty() ? undefined : img
}

function updateTrayMenu(): void {
  if (!tray) return
  tray.setToolTip(trayTooltip())
  const s = store.settings.data
  const statusItems: Electron.MenuItemConstructorOptions[] = PLATFORM_IDS.map((p) => {
    const r = remainingOf(pickPrimary(scheduler.snapshots[p], s.primaryRule[p]))
    return {
      label: `${PLATFORM_META[p].name}　剩余 ${r == null ? '—' : `${Math.round(r)}%`}`,
      icon: platformTrayIcon(p),
      click: showMain
    }
  })
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...statusItems,
      { type: 'separator' },
      { label: '显示主窗口', click: showMain },
      { label: '迷你挂件', type: 'checkbox', checked: !!miniWin && !miniWin.isDestroyed(), click: toggleMini },
      { label: '立即刷新', click: () => void scheduler.refreshAll(true) },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const img = nativeImage.createFromPath(resource('tray.png'))
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(resource('icon.png')).resize({ width: 16 }) : img)
  tray.on('click', showMain)
  tray.on('double-click', showMain)
  updateTrayMenu()
}

// ───────────────────────── 状态广播 ─────────────────────────

function buildState(): AppState {
  const nextRefreshAt = {} as Record<PlatformId, string | null>
  for (const p of PLATFORM_IDS) {
    const t = scheduler.nextAt[p]
    nextRefreshAt[p] = t ? new Date(t).toISOString() : null
  }
  return {
    snapshots: scheduler.snapshots,
    settings: store.settings.data,
    refreshing: scheduler.refreshing,
    nextRefreshAt,
    claudeWebLoggedIn,
    version: app.getVersion()
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of [mainWin, miniWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

let pushTimer: NodeJS.Timeout | null = null
function pushState(): void {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    broadcast('state:update', buildState())
    updateTrayMenu()
  }, 50)
}

async function refreshClaudeWebFlag(): Promise<void> {
  const v = await hasClaudeWebSession()
  if (v !== claudeWebLoggedIn) {
    claudeWebLoggedIn = v
    pushState()
  }
}

// ───────────────────────── 设置 ─────────────────────────

const SETTING_KEYS = new Set<keyof AppSettings>([...(Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]), 'miniPosition'])

function applySettings(prev: AppSettings, next: AppSettings): void {
  if (prev.refreshMinutes !== next.refreshMinutes) scheduler.reschedule()
  if (miniWin && !miniWin.isDestroyed() && prev.miniAlwaysOnTop !== next.miniAlwaysOnTop) {
    miniWin.setAlwaysOnTop(next.miniAlwaysOnTop)
  }
  if (prev.launchAtLogin !== next.launchAtLogin) applyLoginItem(next.launchAtLogin)
  for (const p of PLATFORM_IDS) {
    if (prev.sources[p] !== next.sources[p]) void scheduler.refresh(p, false)
  }
  if (prev.maskEmail !== next.maskEmail) void scheduler.refreshAll(false)
}

function applyLoginItem(on: boolean): void {
  // 开发模式下注册的会是 electron.exe，没有意义；只在安装版里生效
  if (isDev) return
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
}

// ───────────────────────── IPC ─────────────────────────

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!trusted(e)) throw new Error('untrusted sender')
      return fn(...(args as A))
    })
  }
  const on = <A extends unknown[]>(channel: string, fn: (e: IpcMainEvent, ...args: A) => void) => {
    ipcMain.on(channel, (e, ...args) => {
      if (trusted(e)) fn(e, ...(args as A))
    })
  }
  const isPlatform = (p: unknown): p is PlatformId => PLATFORM_IDS.includes(p as PlatformId)

  handle('state:get', () => buildState())
  handle('quota:refresh', (p?: unknown) =>
    isPlatform(p) ? scheduler.refresh(p, true) : scheduler.refreshAll(true)
  )
  handle('history:get', (p: unknown) => (isPlatform(p) ? store.getHistory(p) : { windows: {} }))
  handle('raw:get', (p: unknown) => (isPlatform(p) ? scheduler.raw[p] ?? [] : []))
  handle('value:get', (p: unknown) => (isPlatform(p) ? getValueReport(p, scheduler.snapshots[p]) : null))
  handle('settings:set', (patch: unknown) => {
    const clean: Partial<AppSettings> = {}
    if (patch && typeof patch === 'object') {
      for (const [k, v] of Object.entries(patch)) if (SETTING_KEYS.has(k as keyof AppSettings)) (clean as Record<string, unknown>)[k] = v
    }
    const prev = store.settings.data
    const next = store.updateSettings(clean)
    applySettings(prev, next)
    pushState()
    return next
  })

  handle('art:get', () => getArtState())
  handle('art:reload', () => {
    const a = getArtState()
    broadcast('art:changed', a)
    return a
  })
  handle('art:open-folder', async () => {
    const dir = ensureEditableArtDir()
    restartArtWatch()
    await shell.openPath(dir)
  })

  handle('claude:login', () => {
    openClaudeLogin(mainWin, () => {
      void refreshClaudeWebFlag()
      void scheduler.refresh('claude', false)
    })
  })
  handle('claude:set-session-key', async (key: unknown) => {
    const r = await setClaudeSessionKey(String(key ?? ''))
    if (r.ok) {
      await refreshClaudeWebFlag()
      void scheduler.refresh('claude', false)
    }
    return r
  })
  handle('claude:logout', async () => {
    await clearClaudeWeb()
    await refreshClaudeWebFlag()
    void scheduler.refresh('claude', false)
  })

  on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  on('win:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  handle('win:is-maximized', () => mainWin?.isMaximized() ?? false)

  on('mini:toggle', () => toggleMini())
  on('mini:show-main', () => showMain())
  on('mini:drag-to', (_e, x: unknown, y: unknown) => moveMini(Number(x), Number(y)))
  on('mini:close', () => {
    if (miniWin && !miniWin.isDestroyed()) miniWin.close()
  })
}

function restartArtWatch(): void {
  stopWatch?.()
  stopWatch = watchArt(() => broadcast('art:changed', getArtState()))
}

// ───────────────────────── 启动 ─────────────────────────

app.on('second-instance', () => showMain())

app.whenReady().then(() => {
  if (!gotLock) return
  app.setAppUserModelId(isDev ? process.execPath : APP_ID)
  // 默认 session 不需要任何权限
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  registerArtProtocol()
  store = new Store(app.getPath('userData'))
  scheduler = new Scheduler(store)
  scheduler.onChange(pushState)
  scheduler.onSnapshot((p, prev, next) => {
    checkNotifications(store, p, prev, next, showMain, resource(path.join('platforms', `${p}.png`)))
    if (p === 'claude') void refreshClaudeWebFlag()
    pushState()
  })

  registerIpc()
  mainWin = createMainWindow(!startHidden)
  createTray()
  restartArtWatch()
  void refreshClaudeWebFlag()
  applyLoginItem(store.settings.data.launchAtLogin)
  scheduler.start()
})

app.on('window-all-closed', () => {
  // 常驻托盘：不因窗口全部关闭而退出（关闭按钮行为由 closeToTray 控制）
})

app.on('before-quit', () => {
  quitting = true
  scheduler?.stop()
  store?.flush()
})
