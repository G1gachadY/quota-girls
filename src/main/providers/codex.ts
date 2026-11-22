/**
 * Codex（ChatGPT 订阅）额度。
 * A. API：只读 ~/.codex/auth.json → GET chatgpt.com/backend-api/wham/usage（绝不刷新、改写 auth.json）
 * B. CLI RPC：codex -s read-only -a never app-server（JSON-RPC over stdio）→ account/rateLimits/read
 * C. 本地会话日志：~/.codex/sessions/**\/rollout-*.jsonl 最后一条带 rate_limits 的 token_count 事件
 */
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { windowLabelFromSeconds } from '../../shared/quota'
import { httpRequest } from '../net'
import {
  ProviderError,
  clampPct,
  decodeJwtPayload,
  errorText,
  get,
  isObj,
  maskEmail,
  num,
  nowIso,
  parseTime,
  sanitize,
  str
} from '../util'
import type { AppSettings, PlatformSnapshot, ProviderResult, QuotaWindow, RawEntry } from './types'

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

interface CodexAuth {
  accessToken?: string
  accountId?: string
  idToken?: string
  apiKeyOnly: boolean
}

function readAuth(): CodexAuth | null {
  let text: string
  try {
    text = fs.readFileSync(path.join(codexHome(), 'auth.json'), 'utf8')
  } catch {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ProviderError('auth.json 无法解析', 'config', '运行一次 codex 重新登录')
  }
  const tokens = get(json, 'tokens')
  const accessToken = str(get(tokens, 'access_token'))
  const apiKey = str(get(json, 'OPENAI_API_KEY'))
  return {
    accessToken,
    accountId: str(get(tokens, 'account_id')),
    idToken: str(get(tokens, 'id_token')),
    apiKeyOnly: !accessToken && !!apiKey
  }
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
  go: 'Go'
}

function prettyPlan(p: string | undefined): string | undefined {
  if (!p) return undefined
  return PLAN_NAMES[p.toLowerCase()] ?? p[0].toUpperCase() + p.slice(1)
}

function identityFromIdToken(idToken: string | undefined): { email?: string; plan?: string } {
  const payload = decodeJwtPayload(idToken)
  if (!payload) return {}
  const auth = payload['https://api.openai.com/auth']
  return {
    email: str(payload.email) ?? str(get(payload, 'https://api.openai.com/profile.email')),
    plan: str(get(auth, 'chatgpt_plan_type'))
  }
}

function base(status: PlatformSnapshot['status'], source: string): PlatformSnapshot {
  return { platform: 'codex', status, source, windows: [], fetchedAt: nowIso() }
}

// ───────────────────────── 解析 ─────────────────────────

/** wham/usage 的单个 window：{ used_percent, limit_window_seconds, reset_after_seconds, reset_at } */
function parseApiWindow(w: unknown, idPrefix: string, fallbackId: string, namePrefix = ''): QuotaWindow | null {
  if (!isObj(w)) return null
  const used = num(w.used_percent)
  const secs = num(w.limit_window_seconds)
  const { label, kind } = windowLabelFromSeconds(secs)
  let resetsAt = parseTime(w.reset_at)
  const after = num(w.reset_after_seconds)
  if (!resetsAt && after != null) resetsAt = new Date(Date.now() + after * 1000).toISOString()
  const id = secs === 18000 ? 'five_hour' : secs === 604800 ? 'weekly' : fallbackId
  return {
    id: idPrefix + id,
    label: namePrefix ? `${namePrefix}·${label}` : label,
    kind: namePrefix ? 'model' : kind,
    usedPercent: clampPct(used),
    resetsAt,
    known: used != null
  }
}

function dedupeIds(windows: QuotaWindow[]): QuotaWindow[] {
  const seen = new Map<string, number>()
  return windows.map((w) => {
    const n = seen.get(w.id) ?? 0
    seen.set(w.id, n + 1)
    return n === 0 ? w : { ...w, id: `${w.id}_${n + 1}` }
  })
}

export function parseWhamUsage(json: unknown): { windows: QuotaWindow[]; plan?: string; credits?: string } {
  const windows: QuotaWindow[] = []
  const rl = get(json, 'rate_limit')
  const p = parseApiWindow(get(rl, 'primary_window'), '', 'primary')
  const s = parseApiWindow(get(rl, 'secondary_window'), '', 'secondary')
  if (p) windows.push(p)
  if (s) windows.push(s)

  // 代码审查（Code Review）的独立限额，通常为 null
  const cr = get(json, 'code_review_rate_limit')
  if (isObj(cr)) {
    const a = parseApiWindow(get(cr, 'primary_window'), 'code_review:', 'primary', '代码审查')
    const b = parseApiWindow(get(cr, 'secondary_window'), 'code_review:', 'secondary', '代码审查')
    if (a) windows.push(a)
    if (b) windows.push(b)
  }

  const extra = get(json, 'additional_rate_limits')
  if (Array.isArray(extra)) {
    extra.forEach((item, i) => {
      if (!isObj(item)) return
      const name =
        str(item.limit_name) ?? str(item.name) ?? str(item.metered_feature) ?? str(item.feature) ?? `额外${i + 1}`
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      const inner = isObj(item.rate_limit) ? item.rate_limit : item
      const a = parseApiWindow(get(inner, 'primary_window'), `${slug}:`, 'primary', name)
      const b = parseApiWindow(get(inner, 'secondary_window'), `${slug}:`, 'secondary', name)
      if (a) windows.push(a)
      if (b) windows.push(b)
    })
  }

  let credits: string | undefined
  const c = get(json, 'credits')
  if (isObj(c)) {
    if (c.unlimited) credits = '无限'
    else if (c.has_credits) {
      const bal = num(c.balance)
      credits = bal != null ? `余额 ${bal.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '有'
    }
  }
  return { windows: dedupeIds(windows), plan: str(get(json, 'plan_type')), credits }
}

/** app-server / 会话日志里的窗口：{ usedPercent|used_percent, windowDurationMins|window_minutes, resetsAt|resets_at|resets_in_seconds } */
function parseCamelWindow(w: unknown, fallbackId: string, baseTimeMs = Date.now()): QuotaWindow | null {
  if (!isObj(w)) return null
  const used = num(w.usedPercent ?? w.used_percent)
  const mins = num(w.windowDurationMins ?? w.window_minutes ?? w.windowMinutes)
  const { label, kind } = windowLabelFromSeconds(mins != null ? mins * 60 : null)
  let resetsAt = parseTime(w.resetsAt ?? w.resets_at)
  const inSec = num(w.resets_in_seconds ?? w.resetsInSeconds)
  if (!resetsAt && inSec != null) resetsAt = new Date(baseTimeMs + inSec * 1000).toISOString()
  const id = mins === 300 ? 'five_hour' : mins === 10080 ? 'weekly' : fallbackId
  return { id, label, kind, usedPercent: clampPct(used), resetsAt, known: used != null }
}

// ───────────────────────── A. API ─────────────────────────

const AUTH_HINT = '运行一次 codex 重新登录'

async function fetchApi(settings: AppSettings): Promise<ProviderResult> {
  const raw: RawEntry[] = []
  const auth = readAuth()
  if (!auth) {
    return {
      snapshot: {
        ...base('not_configured', 'api'),
        error: { message: '未找到 ~/.codex/auth.json', hint: '安装 Codex CLI 并运行 codex 登录 ChatGPT 账号' }
      },
      raw
    }
  }
  if (auth.apiKeyOnly) {
    return {
      snapshot: {
        ...base('not_configured', 'api'),
        error: { message: '当前是 API Key 登录', hint: 'API Key 计费模式没有订阅额度' }
      },
      raw
    }
  }
  if (!auth.accessToken) {
    return {
      snapshot: { ...base('not_configured', 'api'), error: { message: 'auth.json 中没有 access_token', hint: AUTH_HINT } },
      raw
    }
  }
  const ident = identityFromIdToken(auth.idToken)
  const account = settings.maskEmail ? maskEmail(ident.email) : ident.email
  const atPayload = decodeJwtPayload(auth.accessToken)
  const exp = num(atPayload?.exp)
  raw.push({
    label: '~/.codex/auth.json（仅元数据）',
    at: nowIso(),
    body: sanitize({
      access_token: auth.accessToken,
      account_id: auth.accountId,
      access_expires_at: exp ? new Date(exp * 1000).toISOString() : null,
      id_token_claims: { email: ident.email, chatgpt_plan_type: ident.plan }
    })
  })

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    'User-Agent': 'codex-cli',
    Accept: 'application/json'
  }
  if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId
  const res = await httpRequest('https://chatgpt.com/backend-api/wham/usage', { headers })
  raw.push({
    label: 'GET chatgpt.com/backend-api/wham/usage',
    at: nowIso(),
    status: res.status,
    body: sanitize(res.json ?? res.text.slice(0, 2000))
  })
  if (res.status === 401) {
    return {
      snapshot: {
        ...base('auth_expired', 'api'),
        account,
        plan: prettyPlan(ident.plan),
        error: { message: 'HTTP 401：登录已过期', hint: AUTH_HINT }
      },
      raw
    }
  }
  if (!res.ok) {
    throw new ProviderError(
      `HTTP ${res.status}`,
      res.status === 429 ? 'rate' : res.status >= 500 ? 'server' : res.status === 403 ? 'auth' : 'network',
      res.status === 429 ? '请求太频繁，已自动退避' : res.status === 403 ? '可能被 Cloudflare 拦截，稍后重试' : '稍后自动重试',
      res.status
    )
  }
  const parsed = parseWhamUsage(res.json)
  if (parsed.windows.length === 0) {
    throw new ProviderError('响应里没有找到额度窗口', 'parse', '接口格式可能变了：运行 npm run probe 查看原始响应')
  }
  return {
    snapshot: {
      ...base('ok', 'api'),
      plan: prettyPlan(parsed.plan ?? ident.plan),
      account,
      windows: parsed.windows,
      extras: parsed.credits ? { credits: parsed.credits } : undefined
    },
    raw
  }
}

// ───────────────────────── B. CLI RPC ─────────────────────────

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(pid)
    } catch {
      /* ignore */
    }
  }
}

interface RpcOutcome {
  rateLimits: unknown
  account?: unknown
}

function runAppServer(timeoutMs = 15000): Promise<RpcOutcome> {
  return new Promise((resolve, reject) => {
    // Windows 下经 shell 解析 codex.cmd
    const child = spawn('codex', ['-s', 'read-only', '-a', 'never', 'app-server'], {
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    })
    let done = false
    let buf = ''
    let stderr = ''
    let account: unknown
    let gotAccount = false
    let rateLimits: unknown = undefined
    const finish = (err: Error | null, value?: RpcOutcome) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        child.stdin.end()
      } catch {
        /* ignore */
      }
      killTree(child.pid)
      if (err) reject(err)
      else resolve(value!)
    }
    const timer = setTimeout(
      () => finish(new ProviderError('codex app-server 15 秒内无响应', 'network', '确认 codex 命令可用，或改用 API 数据源')),
      timeoutMs
    )
    const send = (msg: unknown) => {
      try {
        child.stdin.write(JSON.stringify(msg) + '\n')
      } catch {
        /* ignore */
      }
    }
    child.on('error', (e) =>
      finish(new ProviderError(`无法启动 codex：${e.message}`, 'config', '确认已安装 Codex CLI（npm i -g @openai/codex）'))
    )
    child.on('exit', (code) => {
      if (!done)
        finish(
          new ProviderError(
            `codex app-server 退出（code ${code}）${stderr ? '：' + errorText(stderr.slice(-300)) : ''}`,
            'config',
            '确认 codex 命令可用，或改用 API 数据源'
          )
        )
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 1) {
          send({ method: 'initialized' })
          send({ id: 2, method: 'account/rateLimits/read' })
          send({ id: 3, method: 'account/read', params: {} })
        } else if (msg.id === 2) {
          if (msg.error) {
            finish(new ProviderError(`account/rateLimits/read 失败：${JSON.stringify(sanitize(msg.error))}`, 'parse', AUTH_HINT))
          } else {
            rateLimits = msg.result
            // account/read 只是附加信息：已到就立即结束，否则最多再等 1.5 秒
            if (gotAccount) finish(null, { rateLimits, account })
            else setTimeout(() => finish(null, { rateLimits, account }), 1500)
          }
        } else if (msg.id === 3) {
          account = msg.result ?? null
          gotAccount = true
          if (rateLimits !== undefined) finish(null, { rateLimits, account })
        }
      }
    })
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'quota-girls', title: 'Quota Girls', version: '0.1.0' } }
    })
  })
}

async function fetchRpc(settings: AppSettings): Promise<ProviderResult> {
  const raw: RawEntry[] = []
  const out = await runAppServer()
  raw.push({ label: 'codex app-server · account/rateLimits/read', at: nowIso(), body: sanitize(out.rateLimits) })
  if (out.account !== undefined) raw.push({ label: 'codex app-server · account/read', at: nowIso(), body: sanitize(out.account) })
  const rl = get(out.rateLimits, 'rateLimits') ?? out.rateLimits
  const windows: QuotaWindow[] = []
  const p = parseCamelWindow(get(rl, 'primary'), 'primary')
  const s = parseCamelWindow(get(rl, 'secondary'), 'secondary')
  if (p) windows.push(p)
  if (s) windows.push(s)
  // 其它带名字的限额（rateLimitsByLimitId 里除主限额以外的条目）
  const byId = get(out.rateLimits, 'rateLimitsByLimitId')
  const mainId = str(get(rl, 'limitId'))
  if (isObj(byId)) {
    for (const [limitId, v] of Object.entries(byId)) {
      if (limitId === mainId || !isObj(v)) continue
      const name = str(v.limitName) ?? limitId
      for (const [k, w] of [
        ['primary', v.primary],
        ['secondary', v.secondary]
      ] as const) {
        const pw = parseCamelWindow(w, k)
        if (pw) windows.push({ ...pw, id: `${limitId}:${pw.id}`, label: `${name}·${pw.label}`, kind: 'model' })
      }
    }
  }
  let credits: string | undefined
  const c = get(rl, 'credits')
  if (isObj(c)) {
    if (c.unlimited) credits = '无限'
    else if (c.hasCredits) credits = num(c.balance) != null ? `余额 ${num(c.balance)}` : '有'
  }
  if (windows.length === 0) {
    throw new ProviderError('app-server 没有返回额度窗口', 'parse', '运行 npm run probe 查看原始响应')
  }
  const email = str(get(out.account, 'account.email')) ?? str(get(out.account, 'email'))
  const plan = str(get(out.account, 'account.planType')) ?? str(get(rl, 'planType'))
  return {
    snapshot: {
      ...base('ok', 'rpc'),
      plan: prettyPlan(plan) ?? prettyPlan(identityFromIdToken(readAuthSafe()?.idToken).plan),
      account: settings.maskEmail ? maskEmail(email) : email,
      windows: dedupeIds(windows),
      extras: credits ? { credits } : undefined
    },
    raw
  }
}

function readAuthSafe(): CodexAuth | null {
  try {
    return readAuth()
  } catch {
    return null
  }
}

// ───────────────────────── C. 本地会话日志 ─────────────────────────

function listRecentRollouts(root: string, limit = 6): string[] {
  const files: { p: string; m: number }[] = []
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    // 目录按名字倒序（YYYY/MM/DD），只深入最近的几个
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
    for (const e of entries) {
      if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
        const p = path.join(dir, e.name)
        try {
          files.push({ p, m: fs.statSync(p).mtimeMs })
        } catch {
          /* ignore */
        }
      }
    }
    if (depth < 4) for (const d of dirs.slice(0, depth === 0 ? 2 : 3)) walk(path.join(dir, d), depth + 1)
  }
  walk(root, 0)
  return files.sort((a, b) => b.m - a.m).slice(0, limit).map((f) => f.p)
}

function readTail(file: string, bytes = 512 * 1024): string {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

async function fetchLocalLog(settings: AppSettings): Promise<ProviderResult> {
  const raw: RawEntry[] = []
  const files = listRecentRollouts(path.join(codexHome(), 'sessions'))
  for (const file of files) {
    let text: string
    try {
      text = readTail(file)
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line.includes('rate_limits')) continue
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      const payload = isObj(ev.payload) ? ev.payload : ev
      const rl = get(payload, 'rate_limits') ?? get(payload, 'info.rate_limits')
      if (!isObj(rl)) continue
      const ts = Date.parse(String(ev.timestamp ?? '')) || fs.statSync(file).mtimeMs
      raw.push({
        label: `本地会话日志 ${path.basename(file)}（最后一条 token_count）`,
        at: new Date(ts).toISOString(),
        body: sanitize(ev)
      })
      const windows: QuotaWindow[] = []
      const p = parseCamelWindow(rl.primary, 'primary', ts)
      const s = parseCamelWindow(rl.secondary, 'secondary', ts)
      if (p) windows.push(p)
      if (s) windows.push(s)
      if (windows.length === 0) continue
      const ident = identityFromIdToken(readAuthSafe()?.idToken)
      return {
        snapshot: {
          ...base('stale', 'local-log'),
          plan: prettyPlan(str(rl.plan_type) ?? ident.plan),
          account: settings.maskEmail ? maskEmail(ident.email) : ident.email,
          windows: dedupeIds(windows),
          fetchedAt: new Date(ts).toISOString(),
          note: '来自最近一次会话'
        },
        raw
      }
    }
  }
  return {
    snapshot: {
      ...base('not_configured', 'local-log'),
      error: { message: '本地会话日志里没有额度信息', hint: '用 codex 跑一次对话后会写入日志' }
    },
    raw
  }
}

// ───────────────────────── 入口 ─────────────────────────

export async function fetchCodex(settings: AppSettings): Promise<ProviderResult> {
  const pref = settings.sources.codex
  if (pref === 'api') return fetchApi(settings)
  if (pref === 'rpc') return fetchRpc(settings)
  if (pref === 'local-log') return fetchLocalLog(settings)

  // auto：API → RPC → 本地日志
  const raws: RawEntry[] = []
  let first: ProviderResult | null = null
  let firstErr: unknown = null
  try {
    const a = await fetchApi(settings)
    if (a.snapshot.status === 'ok') return a
    first = a
    raws.push(...a.raw)
    // API Key 模式：没有订阅额度，不必再试
    if (a.snapshot.error?.hint === 'API Key 计费模式没有订阅额度') return a
  } catch (e) {
    firstErr = e
    raws.push({ label: 'API 失败', at: nowIso(), body: errorText(e) })
  }
  try {
    const b = await fetchRpc(settings)
    b.raw.unshift(...raws)
    return b
  } catch (e) {
    raws.push({ label: 'CLI RPC 失败', at: nowIso(), body: errorText(e) })
  }
  const c = await fetchLocalLog(settings)
  if (c.snapshot.status === 'stale') {
    c.raw.unshift(...raws)
    // 同时附带 API 失败原因（例如 auth_expired 的 hint）
    if (first?.snapshot.error) c.snapshot.error = first.snapshot.error
    else if (firstErr instanceof ProviderError) c.snapshot.error = { message: firstErr.message, hint: firstErr.hint }
    return c
  }
  if (first) {
    first.raw = raws
    return first
  }
  throw firstErr
}
