/**
 * 等价 API 价值：扫描本机用量记录（增量），按官方 API 定价折算。
 * 只读本地文件，不联网；renderer 只拿到按模型汇总后的 token 数和金额。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { PRICING_CHECKED_AT, aggregateValue, valueRanges, type ModelPrice } from '../../shared/pricing'
import type { PlatformId, PlatformSnapshot, UnitPrice, UsageEvent, ValueReport } from '../providers/types'
import { errorText } from '../util'
import { scanAntigravity } from './antigravity'
import { scanClaudeCode } from './claude-code'
import { scanCodex } from './codex'
import { RETENTION_MS } from './files'

const SCOPE: Record<PlatformId, { scope: string; caveat: string }> = {
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
  }
}

const SCANNERS: Record<PlatformId, (since: number) => Promise<{ events: UsageEvent[]; files: number; error?: string }>> = {
  claude: scanClaudeCode,
  codex: scanCodex,
  antigravity: scanAntigravity
}

/** 同一平台 20 秒内重复打开详情页不重复扫描 */
const MIN_RESCAN_MS = 20_000
const cache = new Map<PlatformId, { at: number; events: UsageEvent[]; files: number; error?: string }>()
const inflight = new Map<PlatformId, Promise<{ at: number; events: UsageEvent[]; files: number; error?: string }>>()

async function scan(p: PlatformId) {
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

export async function getValueReport(p: PlatformId, snap: PlatformSnapshot | undefined): Promise<ValueReport> {
  const r = await scan(p)
  const now = Date.now()
  const extra = customPrices()
  const earliest = r.events.reduce<number | null>((m, e) => (m == null || e.t < m ? e.t : m), null)
  return {
    platform: p,
    ...SCOPE[p],
    ranges: valueRanges(snap, now).map((range) => aggregateValue(r.events, range, extra)),
    scannedAt: new Date(r.at).toISOString(),
    files: r.files,
    earliest,
    pricingCheckedAt: PRICING_CHECKED_AT,
    error: r.error
  }
}
