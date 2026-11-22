/**
 * Claude 额度（桌面版 / 网页 / Claude Code 共用一份）。
 * A. OAuth：只读 ~/.claude/.credentials.json → GET api.anthropic.com/api/oauth/usage（绝不刷新 token）
 * B. 内嵌网页登录：同 partition 的隐藏窗口里 fetch claude.ai/api/organizations/{uuid}/usage
 * C. 手动 sessionKey：写入 B 的 partition cookie 后走 B
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { httpRequest } from '../net'
import {
  ProviderError,
  clampPct,
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

// ───────────────────────── 文件路径（只读） ─────────────────────────

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function credentialsPath(): string {
  return path.join(claudeConfigDir(), '.credentials.json')
}

function globalConfigPath(): string {
  // Claude Code 的账号信息（oauthAccount.emailAddress）在 ~/.claude.json
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(os.homedir(), '.claude.json')
}

interface OAuthCreds {
  accessToken: string
  expiresAt: number | null
  scopes: string[]
  subscriptionType?: string
  rateLimitTier?: string
}

function readOAuthCreds(): OAuthCreds | null {
  let text: string
  try {
    text = fs.readFileSync(credentialsPath(), 'utf8')
  } catch {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ProviderError('.credentials.json 无法解析', 'config', '文件可能损坏：重新运行 claude 登录一次')
  }
  const o = get(json, 'claudeAiOauth')
  if (!isObj(o) || typeof o.accessToken !== 'string') return null
  return {
    accessToken: o.accessToken,
    expiresAt: num(o.expiresAt),
    scopes: Array.isArray(o.scopes) ? (o.scopes as string[]) : [],
    subscriptionType: str(o.subscriptionType),
    rateLimitTier: str(o.rateLimitTier)
  }
}

function readAccountEmail(): string | undefined {
  try {
    const text = fs.readFileSync(globalConfigPath(), 'utf8')
    const json = JSON.parse(text)
    return str(get(json, 'oauthAccount.emailAddress'))
  } catch {
    return undefined
  }
}

export function hasClaudeCodeLogin(): boolean {
  try {
    return readOAuthCreds() != null
  } catch {
    return true
  }
}

// ───────────────────────── 解析（A/B 共用） ─────────────────────────

const KNOWN_WINDOWS: Record<string, { label: string; kind: QuotaWindow['kind'] }> = {
  five_hour: { label: '5小时', kind: 'session' },
  seven_day: { label: '本周', kind: 'weekly' },
  seven_day_opus: { label: '本周·Opus', kind: 'model' },
  seven_day_sonnet: { label: '本周·Sonnet', kind: 'model' },
  seven_day_oauth_apps: { label: '本周·OAuth应用', kind: 'other' },
  seven_day_cowork: { label: '本周·Cowork', kind: 'other' }
}

const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']

function prettySuffix(s: string): string {
  return s
    .split('_')
    .filter(Boolean)
    .map((p) => (p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

export function parseClaudeUsage(json: unknown): {
  windows: QuotaWindow[]
  extraUsage?: string
} {
  const windows: QuotaWindow[] = []
  let extraUsage: string | undefined
  if (!isObj(json)) return { windows }

  for (const [key, value] of Object.entries(json)) {
    if (key === 'extra_usage') continue
    if (!isObj(value) || !('utilization' in value || 'resets_at' in value)) continue
    const meta =
      KNOWN_WINDOWS[key] ??
      (key.startsWith('seven_day_')
        ? { label: `本周·${prettySuffix(key.slice('seven_day_'.length))}`, kind: 'weekly' as const }
        : { label: prettySuffix(key), kind: 'other' as const })
    const util = num(value.utilization)
    windows.push({
      id: key,
      label: meta.label,
      kind: meta.kind,
      usedPercent: clampPct(util),
      resetsAt: parseTime(value.resets_at),
      known: util != null
    })
  }

  windows.sort((a, b) => {
    const ia = ORDER.indexOf(a.id)
    const ib = ORDER.indexOf(b.id)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  const ex = json.extra_usage
  if (isObj(ex) && ex.is_enabled) {
    const used = num(ex.used_credits)
    const limit = num(ex.monthly_limit)
    const util = num(ex.utilization)
    // 单位按美分处理（API 返回的 credits 为美分），以 probe 实测为准
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
    if (used != null && limit != null) extraUsage = `本月 ${fmt(used)} / ${fmt(limit)}`
    else if (used != null) extraUsage = `本月已用 ${fmt(used)}`
    if (util != null && extraUsage) extraUsage += ` · ${Math.round(util)}%`
    if (!extraUsage) extraUsage = '已开启'
  }
  return { windows, extraUsage }
}

function planFromOAuth(c: OAuthCreds): string | undefined {
  const sub = (c.subscriptionType ?? '').toLowerCase()
  const tier = (c.rateLimitTier ?? '').toLowerCase()
  if (sub === 'max' || tier.includes('max')) {
    if (tier.includes('20x')) return 'Max 20x'
    if (tier.includes('5x')) return 'Max 5x'
    return 'Max'
  }
  if (sub === 'pro') return 'Pro'
  if (sub === 'team') return 'Team'
  if (sub === 'enterprise') return 'Enterprise'
  if (sub === 'free') return 'Free'
  return sub ? sub[0].toUpperCase() + sub.slice(1) : undefined
}

function base(status: PlatformSnapshot['status'], source: string): PlatformSnapshot {
  return { platform: 'claude', status, source, windows: [], fetchedAt: nowIso() }
}

// ───────────────────────── A. OAuth ─────────────────────────

const AUTH_EXPIRED_HINT = '打开一次 Claude Code（终端运行 claude）即可自动续期'

async function fetchOAuth(settings: AppSettings): Promise<ProviderResult> {
  const raw: RawEntry[] = []
  const creds = readOAuthCreds()
  if (!creds) {
    return {
      snapshot: {
        ...base('not_configured', 'oauth'),
        error: {
          message: '未找到 Claude Code 登录信息',
          hint: '终端运行 claude 并登录；或在设置里"登录 claude.ai"'
        }
      },
      raw
    }
  }
  const email = readAccountEmail()
  const plan = planFromOAuth(creds)
  const account = settings.maskEmail ? maskEmail(email) : email
  raw.push({
    label: '~/.claude/.credentials.json（仅元数据）',
    at: nowIso(),
    body: sanitize({
      expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
      scopes: creds.scopes,
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier,
      accessToken: creds.accessToken
    })
  })

  if (creds.expiresAt != null && creds.expiresAt < Date.now()) {
    return {
      snapshot: {
        ...base('auth_expired', 'oauth'),
        plan,
        account,
        error: { message: 'OAuth token 已过期', hint: AUTH_EXPIRED_HINT }
      },
      raw
    }
  }

  const res = await httpRequest('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'quota-girls/0.1'
    }
  })
  raw.push({ label: 'GET api.anthropic.com/api/oauth/usage', at: nowIso(), status: res.status, body: sanitize(res.json ?? res.text.slice(0, 2000)) })

  if (res.status === 401 || res.status === 403) {
    return {
      snapshot: {
        ...base('auth_expired', 'oauth'),
        plan,
        account,
        error: { message: `HTTP ${res.status}：token 无效或已过期`, hint: AUTH_EXPIRED_HINT }
      },
      raw
    }
  }
  if (!res.ok) {
    throw new ProviderError(
      `HTTP ${res.status}`,
      res.status === 429 ? 'rate' : res.status >= 500 ? 'server' : 'network',
      res.status === 429 ? '请求太频繁，已自动退避' : '稍后自动重试',
      res.status
    )
  }
  const { windows, extraUsage } = parseClaudeUsage(res.json)
  if (windows.length === 0) {
    throw new ProviderError('响应里没有找到额度窗口', 'parse', '接口格式可能变了：运行 npm run probe 查看原始响应')
  }
  return {
    snapshot: {
      ...base('ok', 'oauth'),
      plan,
      account,
      windows,
      extras: extraUsage ? { extraUsage } : undefined
    },
    raw
  }
}

// ───────────────────────── B. 网页（Electron 注入） ─────────────────────────

export interface ClaudeWebResult {
  orgsStatus: number
  orgs: unknown
  usageStatus?: number
  usage?: unknown
  account?: unknown
}

export interface ClaudeWebDeps {
  /** 是否已有网页登录（partition 里有 sessionKey cookie） */
  hasSession: () => Promise<boolean>
  /** 在隐藏浏览器窗口内取数 */
  fetch: () => Promise<ClaudeWebResult>
}

const WEB_EXPIRED_HINT = '在设置里点"登录 claude.ai"重新登录，或粘贴新的 sessionKey'

async function fetchWeb(settings: AppSettings, deps: ClaudeWebDeps | undefined): Promise<ProviderResult> {
  const raw: RawEntry[] = []
  if (!deps || !(await deps.hasSession())) {
    return {
      snapshot: {
        ...base('not_configured', 'web'),
        error: { message: '尚未登录 claude.ai', hint: '在设置里点"登录 claude.ai"，或粘贴 sessionKey' }
      },
      raw
    }
  }
  const r = await deps.fetch()
  raw.push({ label: 'GET claude.ai/api/organizations', at: nowIso(), status: r.orgsStatus, body: sanitize(r.orgs) })
  if (r.usageStatus != null) {
    raw.push({ label: 'GET claude.ai/api/organizations/{uuid}/usage', at: nowIso(), status: r.usageStatus, body: sanitize(r.usage) })
  }
  if (r.account !== undefined) raw.push({ label: 'GET claude.ai/api/account', at: nowIso(), body: sanitize(r.account) })

  if (r.orgsStatus === 401 || r.orgsStatus === 403 || r.usageStatus === 401 || r.usageStatus === 403) {
    return {
      snapshot: { ...base('auth_expired', 'web'), error: { message: '网页登录已失效', hint: WEB_EXPIRED_HINT } },
      raw
    }
  }
  if (r.orgsStatus === 429 || r.usageStatus === 429) {
    throw new ProviderError('HTTP 429', 'rate', '请求太频繁，已自动退避', 429)
  }
  if (r.orgsStatus >= 500 || (r.usageStatus ?? 0) >= 500) {
    throw new ProviderError(`HTTP ${r.usageStatus ?? r.orgsStatus}`, 'server', '稍后自动重试')
  }
  if (r.usageStatus == null || r.usageStatus !== 200) {
    throw new ProviderError(
      `无法读取用量（organizations HTTP ${r.orgsStatus}${r.usageStatus ? `，usage HTTP ${r.usageStatus}` : ''}）`,
      'parse',
      '可能被 Cloudflare 拦截或接口变化：在设置里重新登录 claude.ai 试试'
    )
  }
  const { windows, extraUsage } = parseClaudeUsage(r.usage)
  const email = str(get(r.account, 'email_address')) ?? str(get(r.account, 'email'))
  let plan: string | undefined
  const org = pickChatOrg(r.orgs)
  const caps = (Array.isArray(get(org, 'capabilities')) ? (get(org, 'capabilities') as string[]) : []).map(String)
  if (caps.includes('claude_max')) plan = 'Max'
  else if (caps.includes('claude_pro')) plan = 'Pro'
  const tier = str(get(org, 'rate_limit_tier'))
  if (plan === 'Max' && tier) {
    if (tier.includes('20x')) plan = 'Max 20x'
    else if (tier.includes('5x')) plan = 'Max 5x'
  }
  if (windows.length === 0) {
    throw new ProviderError('响应里没有找到额度窗口', 'parse', '接口格式可能变了：运行 npm run probe 查看原始响应')
  }
  return {
    snapshot: {
      ...base('ok', 'web'),
      plan,
      account: settings.maskEmail ? maskEmail(email) : email,
      windows,
      extras: extraUsage ? { extraUsage } : undefined
    },
    raw
  }
}

/** 取 capabilities 含 'chat' 的组织 */
export function pickChatOrg(orgs: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(orgs)) return undefined
  const list = orgs.filter(isObj)
  return (
    list.find((o) => Array.isArray(o.capabilities) && (o.capabilities as unknown[]).includes('chat')) ?? list[0]
  )
}

// ───────────────────────── 入口 ─────────────────────────

export async function fetchClaude(settings: AppSettings, web?: ClaudeWebDeps): Promise<ProviderResult> {
  const pref = settings.sources.claude
  try {
    if (pref === 'oauth') return await fetchOAuth(settings)
    if (pref === 'web') return await fetchWeb(settings, web)

    // auto：OAuth 优先；OAuth 不可用时若有网页登录则走网页
    let oauth: ProviderResult | null = null
    let oauthErr: unknown = null
    try {
      oauth = await fetchOAuth(settings)
      if (oauth.snapshot.status === 'ok') return oauth
    } catch (e) {
      oauthErr = e
    }
    if (web && (await web.hasSession())) {
      try {
        const w = await fetchWeb(settings, web)
        if (w.snapshot.status === 'ok') {
          w.raw.unshift(...(oauth?.raw ?? []))
          return w
        }
        if (!oauth) return w
      } catch (e) {
        if (!oauth && !oauthErr) throw e
      }
    }
    if (oauth) return oauth
    throw oauthErr
  } catch (e) {
    if (e instanceof ProviderError) throw e
    throw new ProviderError(errorText(e), 'network', '稍后自动重试')
  }
}
