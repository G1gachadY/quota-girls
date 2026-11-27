/**
 * DeepSeek 余额：GET https://api.deepseek.com/user/balance（只读）。
 * Key 按顺序找：设置里手动填的 → 环境变量 DEEPSEEK_API_KEY → CC Switch 里的 DeepSeek 供应商。
 * Key 只发往 api.deepseek.com（net.ts 白名单）。
 */
import { classifyStatus, httpRequest } from '../net'
import { getSecret } from '../secrets'
import { ProviderError, get, num, nowIso, pruneNoise, sanitize, str } from '../util'
import { findCcSwitchKey } from './cc-switch'
import type { AppSettings, ProviderResult, RawEntry } from './types'

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

const n0 = (v: unknown): number => num(v) ?? 0

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

  const raw: RawEntry[] = []
  const res = await httpRequest('https://api.deepseek.com/user/balance', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${found.key}` },
    timeoutMs: 15000
  })
  raw.push({ label: 'GET /user/balance', at: nowIso(), status: res.status, body: sanitize(pruneNoise(res.json ?? res.text.slice(0, 2000))) })
  if (!res.ok) {
    const kind = classifyStatus(res.status)
    throw new ProviderError(
      kind === 'auth' ? 'Key 无效或没有权限' : `接口返回 HTTP ${res.status}`,
      kind === 'other' ? 'parse' : kind,
      kind === 'auth'
        ? found.source === 'cc-switch'
          ? 'CC Switch 里的 DeepSeek Key 可能已失效，可在设置里手动填一个'
          : '在设置里检查 DeepSeek 的 Key'
        : '稍后自动重试',
      res.status,
      raw
    )
  }

  const j = res.json
  const infos = (Array.isArray(get(j, 'balance_infos')) ? get(j, 'balance_infos') : []) as unknown[]
  const pick = infos.find((x) => get(x, 'currency') === 'CNY') ?? infos[0]
  if (!pick) throw new ProviderError('接口没有返回余额信息', 'parse', '', res.status, raw)
  const others = infos.filter((x) => x !== pick && num(get(x, 'total_balance')))

  return {
    snapshot: {
      platform: 'deepseek',
      status: 'ok',
      source: found.source,
      windows: [],
      balance: {
        amount: n0(get(pick, 'total_balance')),
        currency: str(get(pick, 'currency')) ?? 'CNY',
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
            : undefined,
      fetchedAt: nowIso()
    },
    raw
  }
}
