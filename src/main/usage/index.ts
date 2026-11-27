/**
 * 等价 API 价值：扫描本机用量记录（增量），按官方 API 定价折算。
 * 只读本地文件，不联网；renderer 只拿到按模型汇总后的 token 数和金额。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { DEEPSEEK_PRICING_CHECKED_AT, PRICING_CHECKED_AT, aggregateValue, valueRanges, type ModelPrice } from '../../shared/pricing'
import type { PlatformId, PlatformSnapshot, UnitPrice, UsageEvent, ValueReport } from '../providers/types'
import { errorText } from '../util'
import { scanAntigravity } from './antigravity'
import { scanClaudeCode } from './claude-code'
import { scanCodex } from './codex'
import { RETENTION_MS } from './files'

/** 支持等价 API 价值的平台（有本机用量记录） */
export type ValuePlatform = 'claude' | 'codex' | 'antigravity' | 'deepseek'
export const VALUE_PLATFORMS: ValuePlatform[] = ['claude', 'codex', 'antigravity', 'deepseek']

const SCOPE: Record<ValuePlatform, { scope: string; caveat: string }> = {
  claude: {
    scope: 'Claude Code 本机会话记录',
    caveat: 'Claude 桌面版 / 网页版 / 手机端的对话不在本机留记录，无法计入；实际消耗的订阅额度会比这里多。'
  },
  codex: {
    scope: 'Codex CLI / IDE 插件本机会话记录',
    caveat: 'Codex 云端任务和 ChatGPT 网页对话不在本机留记录，无法计入。'
  },
  antigravity: {
    scope: 'Antigravity 本机对话记录',
    caveat: '只统计这台电脑上的 Antigravity 对话。'
  },
  deepseek: {
    scope: 'Claude Code / Codex 本机记录里走 DeepSeek 的请求',
    caveat:
      'Cherry Studio、网页版等其它客户端的用量不在本机记录里，以余额变化为准。花费按官方价格估算，高峰 / 空闲按北京时间判断，法定节假日也按工作日算（可能略高估）。'
  }
}

/**
 * 只算走这个订阅的请求：用 CC Switch 把 Claude Code / Codex 切到 DeepSeek、百炼等第三方时，
 * 本机记录里会出现别家的模型，那些不消耗这个订阅，排除掉。
 */
const OTHER_VENDORS = /^(deepseek|qwen|glm|kimi|moonshot|minimax|doubao|ernie|hunyuan|yi-|baichuan|step-)/i
const MODEL_FILTER: Record<ValuePlatform, (model: string) => boolean> = {
  claude: (m) => /^claude/i.test(m),
  codex: (m) => !OTHER_VENDORS.test(m) && !/^(claude|gemini)/i.test(m),
  antigravity: () => true,
  deepseek: (m) => /^deepseek/i.test(m)
}

const SCANNERS: Record<ValuePlatform, (since: number) => Promise<{ events: UsageEvent[]; files: number; error?: string }>> = {
  claude: scanClaudeCode,
  codex: scanCodex,
  antigravity: scanAntigravity,
  // 通过 CC Switch 把 Claude Code / Codex 切到 DeepSeek 时，请求记在它们的本机记录里
  deepseek: async (since) => {
    const [a, b] = await Promise.all([scanClaudeCode(since), scanCodex(since)])
    return { events: [...a.events, ...b.events], files: a.files + b.files }
  }
}

/** 同一平台 20 秒内重复打开详情页不重复扫描 */
const MIN_RESCAN_MS = 20_000
const cache = new Map<ValuePlatform, { at: number; events: UsageEvent[]; files: number; error?: string }>()
const inflight = new Map<ValuePlatform, Promise<{ at: number; events: UsageEvent[]; files: number; error?: string }>>()

async function scan(p: ValuePlatform) {
  const hit = cache.get(p)
  if (hit && Date.now() - hit.at < MIN_RESCAN_MS) return hit
  let job = inflight.get(p)
  if (!job) {
    job = SCANNERS[p](Date.now() - RETENTION_MS)
      .then((r) => ({ at: Date.now(), ...r }))
      .catch((e) => ({ at: Date.now(), events: hit?.events ?? [], files: hit?.files ?? 0, error: errorText(e) }))
      .then((r) => {
        cache.set(p, r)
        return r
      })
      .finally(() => inflight.delete(p))
    inflight.set(p, job)
  }
  return job
}

// ───────────────── 用户自定义价格：%APPDATA%\QuotaGirls\pricing.json ─────────────────

let custom: { mtimeMs: number; prices: ModelPrice[] } | null = null

/**
 * {
 *   "models": [
 *     { "match": "codex-auto-review", "label": "Codex Auto Review",
 *       "input": 2, "output": 10, "cacheRead": 0.1, "cacheWrite": 2.5, "cacheWrite1h": 4 }
 *   ]
 * }
 * match 是正则（不区分大小写），匹配规范化后的模型 ID；写在这里的条目优先于内置价目表。
 */
export function customPrices(): ModelPrice[] {
  const file = path.join(app.getPath('userData'), 'pricing.json')
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    custom = null
    return []
  }
  if (custom && custom.mtimeMs === st.mtimeMs) return custom.prices
  const prices: ModelPrice[] = []
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    for (const m of Array.isArray(j?.models) ? j.models : []) {
      const v = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null)
      const input = v(m?.input)
      const output = v(m?.output)
      if (typeof m?.match !== 'string' || input == null || output == null) continue
      let re: RegExp
      try {
        re = new RegExp(m.match, 'i')
      } catch {
        continue
      }
      const unit: UnitPrice = {
        input,
        output,
        cacheRead: v(m.cacheRead) ?? input,
        cacheWrite5m: v(m.cacheWrite) ?? input,
        cacheWrite1h: v(m.cacheWrite1h) ?? v(m.cacheWrite) ?? input
      }
      prices.push({ label: typeof m.label === 'string' && m.label ? m.label.slice(0, 40) : m.match, vendor: 'custom', match: re, tiers: [{ price: unit }] })
    }
  } catch {
    /* 格式不对：忽略 */
  }
  custom = { mtimeMs: st.mtimeMs, prices }
  return prices
}

export function isValuePlatform(p: PlatformId): p is ValuePlatform {
  return (VALUE_PLATFORMS as string[]).includes(p)
}

export async function getValueReport(p: ValuePlatform, snap: PlatformSnapshot | undefined): Promise<ValueReport> {
  const scanned = await scan(p)
  const r = { ...scanned, events: scanned.events.filter((e) => MODEL_FILTER[p](e.model)) }
  const now = Date.now()
  const extra = customPrices()
  const earliest = r.events.reduce<number | null>((m, e) => (m == null || e.t < m ? e.t : m), null)
  return {
    platform: p,
    ...SCOPE[p],
    ranges: valueRanges(snap, now).map((range) => aggregateValue(r.events, range, extra, p === 'deepseek' ? 'CNY' : 'USD')),
    scannedAt: new Date(r.at).toISOString(),
    files: r.files,
    earliest,
    pricingCheckedAt: p === 'deepseek' ? DEEPSEEK_PRICING_CHECKED_AT : PRICING_CHECKED_AT,
    error: r.error
  }
}
