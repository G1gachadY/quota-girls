/**
 * 按量付费平台的余额：内置 DeepSeek + 设置里添加的第三方平台。
 * 只读查询接口，Key 只发往该平台自己的域名（官方类型固定官方域名；中转站 / JSON 为用户填的地址）。
 */
import { CUSTOM_KINDS, normalizeCustomUrl } from '../../shared/quota'
import { classifyStatus, httpRequest, type HttpResponse } from '../net'
import { getSecret } from '../secrets'
import { ProviderError, get, isObj, maskEmail, num, nowIso, pruneNoise, sanitize, str } from '../util'
import { findCcSwitchKey } from './cc-switch'
import type { AppSettings, Balance, CustomKind, CustomPlatform, PlatformSnapshot, ProviderResult, RawEntry } from './types'

interface Query {
  /** 实际查询结果 */
  balance: Balance
  account?: string
  plan?: string
  note?: string
}

const raw = (label: string, res: HttpResponse): RawEntry => ({
  label,
  at: nowIso(),
  status: res.status,
  body: sanitize(pruneNoise(res.json ?? res.text.slice(0, 2000)))
})

async function getJson(url: string, key: string, host: string, rawList: RawEntry[], label: string, headers: Record<string, string> = {}) {
  const res = await httpRequest(url, {
    headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    allowHost: host,
    timeoutMs: 15000
  })
  rawList.push(raw(label, res))
  if (!res.ok) {
    const kind = classifyStatus(res.status)
    throw new ProviderError(
      kind === 'auth' ? 'Key 无效或没有权限' : `接口返回 HTTP ${res.status}`,
      kind === 'other' ? 'parse' : kind,
      kind === 'auth' ? '在设置里检查这个平台的 Key' : kind === 'rate' ? '请求太频繁，稍后自动重试' : '稍后自动重试',
      res.status,
      rawList
    )
  }
  if (res.json === undefined) {
    throw new ProviderError('接口返回的不是 JSON', 'parse', '检查地址是否填对（中转站填根地址即可）', res.status, rawList)
  }
  return res.json
}

const n0 = (v: unknown): number => num(v) ?? 0

// ───────────────────────── 各类型的查询 ─────────────────────────

async function queryDeepSeek(key: string, rawList: RawEntry[]): Promise<Query> {
  const j = await getJson('https://api.deepseek.com/user/balance', key, 'api.deepseek.com', rawList, 'GET /user/balance')
  const infos = (Array.isArray(get(j, 'balance_infos')) ? get(j, 'balance_infos') : []) as unknown[]
  const pick = (infos.find((x) => get(x, 'currency') === 'CNY') ?? infos[0]) as unknown
  if (!pick) throw new ProviderError('没有余额信息', 'parse', '', undefined, rawList)
  const currency = str(get(pick, 'currency')) ?? 'CNY'
  const others = infos.filter((x) => x !== pick && num(get(x, 'total_balance')))
  return {
    balance: {
      amount: n0(get(pick, 'total_balance')),
      currency,
      parts: [
        { label: '充值', amount: n0(get(pick, 'topped_up_balance')) },
        { label: '赠送', amount: n0(get(pick, 'granted_balance')) }
      ]
    },
    note:
      get(j, 'is_available') === false
        ? '余额不足，API 暂不可用'
        : others.length
          ? `另有 ${others.map((x) => `${n0(get(x, 'total_balance'))} ${str(get(x, 'currency')) ?? ''}`).join('、')}`
          : undefined
  }
}

async function queryMoonshot(key: string, rawList: RawEntry[]): Promise<Query> {
  const j = await getJson('https://api.moonshot.cn/v1/users/me/balance', key, 'api.moonshot.cn', rawList, 'GET /v1/users/me/balance')
  const d = get(j, 'data')
  if (!isObj(d)) throw new ProviderError('没有余额信息', 'parse', '', undefined, rawList)
  return {
    balance: {
      amount: n0(d.available_balance),
      currency: 'CNY',
      parts: [
        { label: '现金', amount: n0(d.cash_balance) },
        { label: '代金券', amount: n0(d.voucher_balance) }
      ]
    }
  }
}

async function querySiliconFlow(key: string, rawList: RawEntry[], mask: boolean): Promise<Query> {
  const j = await getJson('https://api.siliconflow.cn/v1/user/info', key, 'api.siliconflow.cn', rawList, 'GET /v1/user/info')
  const d = get(j, 'data')
  if (!isObj(d)) throw new ProviderError('没有余额信息', 'parse', '', undefined, rawList)
  const email = str(d.email)
  return {
    balance: {
      amount: n0(d.totalBalance ?? d.balance),
      currency: 'CNY',
      parts: [
        { label: '充值', amount: n0(d.chargeBalance) },
        { label: '赠送', amount: n0(d.balance) }
      ]
    },
    account: email ? (mask ? maskEmail(email) : email) : undefined
  }
}

async function queryOpenRouter(key: string, rawList: RawEntry[]): Promise<Query> {
  try {
    const j = await getJson('https://openrouter.ai/api/v1/credits', key, 'openrouter.ai', rawList, 'GET /api/v1/credits')
    const total = num(get(j, 'data.total_credits'))
    const used = num(get(j, 'data.total_usage'))
    if (total != null) return { balance: { amount: total - (used ?? 0), total, used, currency: 'USD' } }
  } catch (e) {
    if (!(e instanceof ProviderError) || e.kind === 'network') throw e
  }
  // 退回 Key 自己的额度上限
  const j = await getJson('https://openrouter.ai/api/v1/key', key, 'openrouter.ai', rawList, 'GET /api/v1/key')
  const limit = num(get(j, 'data.limit'))
  const used = num(get(j, 'data.usage'))
  return {
    balance: {
      amount: limit == null ? null : num(get(j, 'data.limit_remaining')) ?? limit - (used ?? 0),
      total: limit,
      used,
      currency: 'USD'
    },
    note: limit == null ? 'Key 不限额度，这里显示已用量' : undefined,
    plan: get(j, 'data.is_free_tier') === true ? '免费层' : undefined
  }
}

/** New API / One API 中转站：令牌的 OpenAI 兼容账单接口 */
async function queryOpenAIBilling(base: string, key: string, rawList: RawEntry[]): Promise<Query> {
  const root = base.replace(/\/v1$/i, '')
  const host = new URL(root).hostname
  const sub = await getJson(`${root}/v1/dashboard/billing/subscription`, key, host, rawList, 'GET /v1/dashboard/billing/subscription')
  const total = num(get(sub, 'hard_limit_usd')) ?? num(get(sub, 'system_hard_limit_usd'))
  const end = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const usage = await getJson(
    `${root}/v1/dashboard/billing/usage?start_date=2000-01-01&end_date=${end}`,
    key,
    host,
    rawList,
    'GET /v1/dashboard/billing/usage'
  )
  const usedCents = num(get(usage, 'total_usage'))
  const used = usedCents == null ? null : usedCents / 100
  if (total == null) throw new ProviderError('接口里没有额度字段', 'parse', '这个中转站可能不支持账单接口，试试"New API 账户"或"自定义 JSON 接口"', undefined, rawList)
  const unlimited = total >= 1e8
  return {
    balance: { amount: unlimited ? null : total - (used ?? 0), total: unlimited ? null : total, used, currency: 'USD' },
    note: unlimited ? '令牌不限额度，这里显示已用量' : undefined
  }
}

/** New API：整个账户的余额（系统访问令牌 + 用户 ID） */
async function queryNewApi(base: string, key: string, userId: string | undefined, rawList: RawEntry[]): Promise<Query> {
  const root = base.replace(/\/v1$/i, '')
  const host = new URL(root).hostname
  const j = await getJson(`${root}/api/user/self`, key, host, rawList, 'GET /api/user/self', userId ? { 'New-Api-User': userId } : {})
  if (get(j, 'success') === false) {
    throw new ProviderError(str(get(j, 'message')) ?? '查询失败', 'auth', '检查系统访问令牌和用户 ID', undefined, rawList)
  }
  const PER_USD = 500000
  const quota = num(get(j, 'data.quota'))
  const usedQ = num(get(j, 'data.used_quota'))
  if (quota == null) throw new ProviderError('接口里没有 quota 字段', 'parse', '', undefined, rawList)
  return {
    balance: {
      amount: quota / PER_USD,
      used: usedQ == null ? null : usedQ / PER_USD,
      total: usedQ == null ? null : (quota + usedQ) / PER_USD,
      currency: 'USD'
    },
    plan: str(get(j, 'data.group'))
  }
}

function pathGet(obj: unknown, path: string): unknown {
  return get(obj, path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, ''))
}

async function queryJson(cp: CustomPlatform, key: string, rawList: RawEntry[]): Promise<Query> {
  const url = normalizeCustomUrl(cp.baseUrl)
  if (!url || !cp.remainingPath) throw new ProviderError('地址或字段路径没填', 'config', '在设置里补全', undefined, rawList)
  const j = await getJson(url, key, new URL(url).hostname, rawList, `GET ${new URL(url).pathname}`)
  const amount = num(pathGet(j, cp.remainingPath))
  if (amount == null) {
    throw new ProviderError(`字段 ${cp.remainingPath} 不是数字`, 'parse', '对照原始响应检查字段路径', undefined, rawList)
  }
  const total = cp.totalPath ? num(pathGet(j, cp.totalPath)) : null
  return { balance: { amount, total, used: total != null ? total - amount : null, currency: cp.unit ?? '' } }
}

// ───────────────────────── 入口 ─────────────────────────

function snapshot(platform: string, source: string, q: Query): PlatformSnapshot {
  return {
    platform,
    status: 'ok',
    source,
    plan: q.plan,
    account: q.account,
    windows: [],
    balance: q.balance,
    note: q.note,
    fetchedAt: nowIso()
  }
}

/** 内置 DeepSeek 的 Key 来源（给设置页显示用） */
export let deepseekKeySource: 'manual' | 'cc-switch' | 'env' | null = null

async function deepseekKey(): Promise<{ key: string; source: 'manual' | 'cc-switch' | 'env' } | null> {
  const manual = getSecret('deepseek')
  if (manual) return { key: manual, source: 'manual' }
  const env = process.env.DEEPSEEK_API_KEY?.trim()
  if (env) return { key: env, source: 'env' }
  const cc = await findCcSwitchKey('api.deepseek.com')
  if (cc) return { key: cc.key, source: 'cc-switch' }
  return null
}

export async function fetchDeepSeek(_settings: AppSettings): Promise<ProviderResult> {
  const found = await deepseekKey()
  deepseekKeySource = found?.source ?? null
  if (!found) {
    return {
      snapshot: {
        platform: 'deepseek',
        status: 'not_configured',
        source: 'none',
        windows: [],
        fetchedAt: nowIso(),
        error: { message: '没有找到 DeepSeek 的 API Key', hint: '在设置里填 Key，或在 CC Switch 里配置 DeepSeek 供应商' }
      },
      raw: []
    }
  }
  const rawList: RawEntry[] = []
  const q = await queryDeepSeek(found.key, rawList)
  return { snapshot: snapshot('deepseek', found.source === 'cc-switch' ? 'cc-switch' : found.source === 'env' ? 'env' : 'manual', q), raw: rawList }
}

export async function fetchCustom(cp: CustomPlatform, settings: AppSettings): Promise<ProviderResult> {
  const key = getSecret(cp.id) ?? ''
  const info = CUSTOM_KINDS[cp.kind]
  if (!key && cp.kind !== 'json') {
    return {
      snapshot: {
        platform: cp.id,
        status: 'not_configured',
        source: 'none',
        windows: [],
        fetchedAt: nowIso(),
        error: { message: '还没有填 Key', hint: `在设置里填写${info.keyLabel}` }
      },
      raw: []
    }
  }
  const rawList: RawEntry[] = []
  const handlers: Record<CustomKind, () => Promise<Query>> = {
    deepseek: () => queryDeepSeek(key, rawList),
    moonshot: () => queryMoonshot(key, rawList),
    siliconflow: () => querySiliconFlow(key, rawList, settings.maskEmail),
    openrouter: () => queryOpenRouter(key, rawList),
    'openai-billing': () => queryOpenAIBilling(cp.baseUrl, key, rawList),
    newapi: () => queryNewApi(cp.baseUrl, key, cp.userId, rawList),
    json: () => queryJson(cp, key, rawList)
  }
  const q = await handlers[cp.kind]()
  return { snapshot: snapshot(cp.id, cp.kind, q), raw: rawList }
}
