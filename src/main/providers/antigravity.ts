/**
 * Antigravity（Google）额度：只走本地 language server，绝不使用 Google OAuth。
 * 1. PowerShell 找 language_server* 进程（命令行含 antigravity），解析 --csrf_token 等参数
 * 2. 找该进程监听的端口，POST GetUnleashData 探测
 * 3. RetrieveUserQuotaSummary → GetUserStatus（HTTPS 失败时改走 extension_server_port 的 HTTP）
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { httpRequest } from '../net'
import {
  ProviderError,
  clampPct,
  deepFindString,
  errorText,
  get,
  isObj,
  maskEmail,
  num,
  nowIso,
  parseTime,
  pruneNoise,
  sanitize,
  str
} from '../util'
import type { AppSettings, PlatformSnapshot, ProviderResult, QuotaWindow, RawEntry } from './types'

const SERVICE = '/exa.language_server_pb.LanguageServerService/'
const OFFLINE_HINT = '打开 Antigravity 后自动读取'

function base(status: PlatformSnapshot['status']): PlatformSnapshot {
  return { platform: 'antigravity', status, source: 'local-ls', windows: [], fetchedAt: nowIso() }
}

function powershell(script: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`
      ],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err && !stdout) reject(err)
        else resolve(stdout)
      }
    )
  })
}

function runCmd(cmd: string, args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err && !stdout) reject(err)
      else resolve(stdout)
    })
  })
}

interface LsProcess {
  pid: number
  name: string
  csrfToken?: string
  extPort?: number
  extCsrfToken?: string
}

function argValue(cmdline: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)("([^"]*)"|(\\S+))`)
  const m = cmdline.match(re)
  return m ? (m[2] ?? m[3]) : undefined
}

async function findProcesses(): Promise<LsProcess[]> {
  const out = await powershell(
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
  )
  const text = out.trim()
  if (!text) return []
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const list = (Array.isArray(json) ? json : [json]).filter(isObj)
  return list
    .filter((p) => /antigravity/i.test(String(p.CommandLine ?? '')))
    .map((p) => {
      const cl = String(p.CommandLine ?? '')
      return {
        pid: Number(p.ProcessId),
        name: String(p.Name ?? ''),
        csrfToken: argValue(cl, 'csrf_token'),
        extPort: num(argValue(cl, 'extension_server_port')) ?? undefined,
        extCsrfToken: argValue(cl, 'extension_server_csrf_token')
      }
    })
}

async function findPorts(pid: number): Promise<number[]> {
  try {
    const out = await powershell(
      `Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction Stop | Select-Object -ExpandProperty LocalPort | ConvertTo-Json -Compress`
    )
    const json = JSON.parse(out.trim() || '[]')
    const ports = (Array.isArray(json) ? json : [json]).map(Number).filter((n) => n > 0)
    if (ports.length) return [...new Set(ports)]
  } catch {
    /* 退回 netstat */
  }
  try {
    const out = await runCmd('netstat', ['-ano', '-p', 'TCP'])
    const ports: number[] = []
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && Number(cols[4]) === pid) {
        const port = Number(cols[1].split(':').pop())
        if (port > 0) ports.push(port)
      }
    }
    return [...new Set(ports)]
  } catch {
    return []
  }
}

const METADATA_BODY = JSON.stringify({
  metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en', ideVersion: 'unknown' }
})

function lsHeaders(csrf: string | undefined): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' }
  if (csrf) h['X-Codeium-Csrf-Token'] = csrf
  return h
}

async function probePort(proc: LsProcess, ports: number[]): Promise<number | null> {
  for (const port of ports) {
    try {
      const r = await httpRequest(`https://127.0.0.1:${port}${SERVICE}GetUnleashData`, {
        method: 'POST',
        headers: lsHeaders(proc.csrfToken),
        body: '{}',
        timeoutMs: 2500
      })
      if (r.status === 200) return port
    } catch {
      /* 下一个 */
    }
  }
  return null
}

// ───────────────────────── 解析 ─────────────────────────

/**
 * 组名 → 短标签。两个主组："Gemini Models" / "Claude and GPT models"；
 * 其它组（例如 "Gemini 4 Argon" 单模型限额）保留原名，kind 记为 'model'。
 */
function groupKeyOf(name: string): { key: string; label: string; main: boolean } {
  const n = name.toLowerCase().trim()
  if (/^gemini( models?)?$/.test(n)) return { key: 'gemini', label: 'Gemini', main: true }
  if ((n.includes('claude') || n.includes('gpt')) && !/\d/.test(n)) return { key: 'claude-gpt', label: 'Claude/GPT', main: true }
  const slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'models'
  return { key: slug, label: name.replace(/\s+models?$/i, ''), main: false }
}

/** 进程命令行里没有 csrf 时（新版 hub 模式），language server 会写发现文件：~/.gemini/antigravity/daemon/hub_<port>.json */
interface DiscoveryFile {
  pid: number
  httpsPort?: number
  httpPort?: number
  csrfToken?: string
}

function readDiscoveryFiles(): DiscoveryFile[] {
  const dir = path.join(os.homedir(), '.gemini', 'antigravity', 'daemon')
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((n) => /\.json$/i.test(n))
  } catch {
    return []
  }
  const out: DiscoveryFile[] = []
  for (const n of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      const pid = num(j?.pid)
      if (pid == null) continue
      out.push({
        pid,
        httpsPort: num(j.httpsPort) ?? undefined,
        httpPort: num(j.httpPort) ?? undefined,
        csrfToken: str(j.csrfToken)
      })
    } catch {
      /* 忽略损坏文件 */
    }
  }
  return out
}

function windowKeyOf(b: Record<string, unknown>): { key: string; label: string; kind: QuotaWindow['kind'] } {
  const win = b.window
  const secs = num(get(win, 'durationSeconds')) ?? num(get(win, 'seconds')) ?? num(get(win, 'duration'))
  const text = [b.bucketId, b.displayName, typeof win === 'string' ? win : JSON.stringify(win ?? '')]
    .map((x) => String(x ?? ''))
    .join(' ')
    .toLowerCase()
  if (secs === 604800 || /week|7d|7_day|seven|周/.test(text)) return { key: 'weekly', label: '本周', kind: 'weekly' }
  if (secs === 18000 || /5h|5_hour|five|5 ?hour|hour|session|小时/.test(text)) return { key: '5h', label: '5小时', kind: 'session' }
  const label = str(b.displayName) ?? '额度'
  return { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'other', label, kind: 'other' }
}

/** 从说明文字里解析 "resets in 2h 15m" / "in 3 days" 之类的相对时间 */
function parseRelativeReset(text: string | undefined): string | null {
  if (!text) return null
  const t = text.toLowerCase()
  const d = Number(t.match(/(\d+)\s*(d|day|days|天)/)?.[1] ?? 0)
  const h = Number(t.match(/(\d+)\s*(h|hr|hrs|hour|hours|小时)/)?.[1] ?? 0)
  const m = Number(t.match(/(\d+)\s*(m|min|mins|minute|minutes|分)/)?.[1] ?? 0)
  const total = ((d * 24 + h) * 60 + m) * 60000
  return total > 0 ? new Date(Date.now() + total).toISOString() : null
}

interface Acc {
  w: QuotaWindow
  frac: number | null
}

/** RetrieveUserQuotaSummary：groups[].buckets[]，同组同窗口取最低剩余 */
export function parseQuotaSummary(json: unknown): QuotaWindow[] | null {
  const groups = get(json, 'response.groups') ?? get(json, 'groups') ?? get(json, 'quotaSummary.groups')
  if (!Array.isArray(groups) || groups.length === 0) return null
  const map = new Map<string, Acc>()
  for (const g of groups) {
    if (!isObj(g)) continue
    const gName = str(g.displayName) ?? str(g.name) ?? 'Models'
    const grp = groupKeyOf(gName)
    const buckets = Array.isArray(g.buckets) ? g.buckets : []
    for (const b of buckets) {
      if (!isObj(b)) continue
      const wk = windowKeyOf(b)
      // bucketId（gemini-5h / 3p-weekly / gemini-argon-wtu-weekly）本身就是稳定的窗口 id
      const id = str(b.bucketId) ?? `${grp.key}-${wk.key}`
      const frac = num(get(b, 'remaining.remainingFraction') ?? b.remainingFraction)
      const resetsAt =
        parseTime(get(b, 'remaining.resetTime') ?? b.resetTime ?? get(b, 'window.resetTime') ?? b.resetsAt) ??
        parseRelativeReset(str(b.description))
      const used = frac != null ? clampPct((1 - frac) * 100) : null
      const w: QuotaWindow = {
        id,
        label: `${grp.label}·${wk.label}`,
        kind: grp.main ? wk.kind : 'model',
        usedPercent: used,
        resetsAt,
        known: frac != null
      }
      const prev = map.get(id)
      if (!prev) map.set(id, { w, frac })
      else if (frac != null && (prev.frac == null || frac < prev.frac)) map.set(id, { w, frac })
    }
  }
  // 主组在前；同组内 5 小时在前、每周在后
  const rank = (w: QuotaWindow) =>
    (w.kind === 'model' || w.kind === 'other' ? 10 : 0) + (w.kind === 'weekly' ? 1 : 0)
  return [...map.values()].map((a) => a.w).sort((a, b) => rank(a) - rank(b))
}

/** GetUserStatus：clientModelConfigs[] { label, quotaInfo { remainingFraction, resetTime } } */
export function parseUserStatus(json: unknown): { windows: QuotaWindow[]; email?: string; plan?: string } {
  const us = get(json, 'userStatus') ?? json
  const configs = get(us, 'cascadeModelConfigData.clientModelConfigs')
  const map = new Map<string, Acc>()
  if (Array.isArray(configs)) {
    for (const c of configs) {
      if (!isObj(c)) continue
      const label = str(c.label) ?? str(c.displayName) ?? str(get(c, 'modelOrAlias.model')) ?? 'Model'
      const q = c.quotaInfo
      if (!isObj(q)) continue
      const grp = groupKeyOf(label)
      const frac = num(q.remainingFraction)
      const w: QuotaWindow = {
        id: grp.key,
        label: grp.label,
        kind: 'model',
        usedPercent: frac != null ? clampPct((1 - frac) * 100) : null,
        resetsAt: parseTime(q.resetTime),
        known: frac != null
      }
      const prev = map.get(grp.key)
      if (!prev) map.set(grp.key, { w, frac })
      else if (frac != null && (prev.frac == null || frac < prev.frac)) map.set(grp.key, { w, frac })
    }
  }
  const email = deepFindString(us, ['email', 'emailAddress'])
  let plan = str(get(us, 'planStatus.planInfo.planName')) ?? deepFindString(us, ['planName', 'planDisplayName'])
  if (plan) {
    plan = plan.replace(/^Google\s+/i, '').trim()
    // 订阅名为 Google AI Pro / AI Ultra
    if (/^(pro|ultra)$/i.test(plan)) plan = `AI ${plan[0].toUpperCase()}${plan.slice(1).toLowerCase()}`
  }
  return { windows: [...map.values()].map((a) => a.w), email, plan }
}

/** 全部 100% 且没有任何重置时间时视为"无法确认"，不显示满血 */
function markUnconfirmed(windows: QuotaWindow[]): { windows: QuotaWindow[]; unconfirmed: boolean } {
  const known = windows.filter((w) => w.known)
  if (known.length > 0 && known.every((w) => w.usedPercent === 0 && !w.resetsAt)) {
    return { windows: windows.map((w) => ({ ...w, known: false, usedPercent: null })), unconfirmed: true }
  }
  return { windows, unconfirmed: known.length === 0 && windows.length > 0 }
}

// ───────────────────────── 入口 ─────────────────────────

async function callLs(
  url: string,
  method: string,
  csrf: string | undefined,
  raw: RawEntry[]
): Promise<unknown | null> {
  try {
    const r = await httpRequest(`${url}${SERVICE}${method}`, {
      method: 'POST',
      headers: lsHeaders(csrf),
      body: METADATA_BODY,
      timeoutMs: 6000
    })
    raw.push({
      label: `POST ${method}`,
      at: nowIso(),
      status: r.status,
      body: pruneNoise(sanitize(r.json ?? r.text.slice(0, 1000)))
    })
    return r.ok ? (r.json ?? null) : null
  } catch (e) {
    raw.push({ label: `POST ${method}`, at: nowIso(), body: errorText(e) })
    return null
  }
}

export async function fetchAntigravity(settings: AppSettings): Promise<ProviderResult> {
  const raw: RawEntry[] = []
  if (process.platform !== 'win32') {
    return { snapshot: { ...base('offline'), error: { message: '仅支持 Windows', hint: OFFLINE_HINT } }, raw }
  }
  let procs: LsProcess[]
  try {
    procs = await findProcesses()
  } catch (e) {
    throw new ProviderError(`进程探测失败：${errorText(e)}`, 'config', '确认 PowerShell 可用')
  }
  raw.push({
    label: 'language_server 进程',
    at: nowIso(),
    body: procs.map((p) => ({ pid: p.pid, name: p.name, csrf_token: p.csrfToken ? '***' : null, extension_server_port: p.extPort ?? null }))
  })
  if (procs.length === 0) {
    return {
      snapshot: { ...base('offline'), error: { message: 'Antigravity 未运行', hint: OFFLINE_HINT } },
      raw
    }
  }

  const discovery = readDiscoveryFiles()
  for (const proc of procs) {
    const candidates: { url: string; csrf?: string }[] = []
    const disc = discovery.find((d) => d.pid === proc.pid)
    if (!proc.csrfToken && disc?.csrfToken) {
      // 新版 hub 模式：csrf 从 stdin 传入，命令行里没有；改读发现文件
      proc.csrfToken = disc.csrfToken
      raw.push({
        label: `pid ${proc.pid} 发现文件 ~/.gemini/antigravity/daemon`,
        at: nowIso(),
        body: { httpsPort: disc.httpsPort ?? null, httpPort: disc.httpPort ?? null, csrfToken: '***' }
      })
      const port = disc.httpsPort ? await probePort(proc, [disc.httpsPort]) : null
      if (port) candidates.push({ url: `https://127.0.0.1:${port}`, csrf: disc.csrfToken })
      if (disc.httpPort) candidates.push({ url: `http://127.0.0.1:${disc.httpPort}`, csrf: disc.csrfToken })
    } else {
      const ports = await findPorts(proc.pid)
      raw.push({ label: `pid ${proc.pid} 监听端口`, at: nowIso(), body: ports })
      const port = await probePort(proc, ports.filter((p) => p !== proc.extPort).concat(proc.extPort ? [proc.extPort] : []))
      if (port) candidates.push({ url: `https://127.0.0.1:${port}`, csrf: proc.csrfToken })
      if (proc.extPort) candidates.push({ url: `http://127.0.0.1:${proc.extPort}`, csrf: proc.extCsrfToken ?? proc.csrfToken })
    }
    if (!proc.csrfToken) {
      raw.push({ label: `pid ${proc.pid}`, at: nowIso(), body: '命令行与发现文件里都没有 csrf token' })
    }

    for (const c of candidates) {
      const summary = await callLs(c.url, 'RetrieveUserQuotaSummary', c.csrf, raw)
      const status = await callLs(c.url, 'GetUserStatus', c.csrf, raw)
      const fromSummary = parseQuotaSummary(summary)
      const fromStatus = parseUserStatus(status)
      const windows = fromSummary && fromSummary.length > 0 ? fromSummary : fromStatus.windows
      if (summary == null && status == null) continue
      const { windows: finalWindows, unconfirmed } = markUnconfirmed(windows)
      const email = fromStatus.email
      return {
        snapshot: {
          ...base('ok'),
          plan: fromStatus.plan,
          account: settings.maskEmail ? maskEmail(email) : email,
          windows: finalWindows,
          note: finalWindows.length === 0 || unconfirmed ? '暂无数据' : undefined
        },
        raw
      }
    }
  }
  throw new ProviderError(
    '找到了 Antigravity 进程，但本地接口没有响应',
    'network',
    '等 Antigravity 完全启动后会自动重试',
    undefined,
    raw
  )
}
