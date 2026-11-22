/**
 * 官方 API 价目表 + 折算逻辑（纯函数，main 与 renderer 共用）。
 *
 * 价格均为各家官方页面的标准（Standard / 非 Batch）价，USD / 百万 tokens，核对日期见 PRICING_CHECKED_AT：
 *   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing
 *   OpenAI     https://developers.openai.com/api/docs/pricing
 *   Google     https://ai.google.dev/gemini-api/docs/pricing
 * 价目表里没有的模型显示"无公开定价"，不计入总额；可在 %APPDATA%\QuotaGirls\pricing.json 里补充或覆盖。
 */
import type {
  PlatformSnapshot,
  UnitPrice,
  UsageEvent,
  UsageTokens,
  ValueModelRow,
  ValueRange
} from '../main/providers/types'

export const PRICING_CHECKED_AT = '2026-11-22'

export const PRICING_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing'
} as const

interface Tier {
  /** 生效日期（UTC，含当天）；缺省为一直有效 */
  since?: string
  price: UnitPrice
  /** 单次请求的提示长度超过 over 时改用 price（Haiku 5.5 / OpenAI 长上下文 / Gemini Pro） */
  long?: { over: number; price: UnitPrice }
}

export interface ModelPrice {
  label: string
  vendor: 'anthropic' | 'openai' | 'google' | 'custom'
  /** 匹配规范化后的模型 ID（见 normalizeModel） */
  match: RegExp
  /** 按生效日期升序 */
  tiers: Tier[]
  /** 快速模式倍率（Anthropic：全部单价 x2） */
  fast?: number
}

// Anthropic：5 分钟缓存写入 = 1.25x 输入，1 小时 = 2x 输入；缓存读取按官方表（新模型为 0.05x / 0.025x）
const claude = (input: number, output: number, cacheRead: number): UnitPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2
})
// OpenAI：缓存写入只有一种口径计入时按 30 分钟写入价
const openai = (input: number, cached: number, output: number, cacheWrite = input): UnitPrice => ({
  input,
  output,
  cacheRead: cached,
  cacheWrite5m: cacheWrite,
  cacheWrite1h: cacheWrite
})
// Gemini：隐式缓存没有写入费，写入的 tokens 按普通输入计
const gemini = (input: number, output: number, cache: number): UnitPrice => ({
  input,
  output,
  cacheRead: cache,
  cacheWrite5m: input,
  cacheWrite1h: input
})

const one = (price: UnitPrice, long?: Tier['long']): Tier[] => [{ price, long }]

export const MODEL_PRICES: ModelPrice[] = [
  // ── Anthropic ──
  { label: 'Claude Fable 5.2', vendor: 'anthropic', match: /^claude-(fable|mythos)-5[-.]2(?!\d)/, tiers: one(claude(8, 40, 0.2)), fast: 2 },
  { label: 'Claude Fable 5.1', vendor: 'anthropic', match: /^claude-(fable|mythos)-5[-.]1(?!\d)/, tiers: one(claude(10, 50, 0.25)) },
  { label: 'Claude Fable 5', vendor: 'anthropic', match: /^claude-(fable|mythos)-5(?![-.]?\d)/, tiers: one(claude(10, 50, 1)) },
  { label: 'Claude Opus 5.5', vendor: 'anthropic', match: /^claude-opus-5[-.]5(?!\d)/, tiers: one(claude(4, 20, 0.2)), fast: 2 },
  { label: 'Claude Opus 5', vendor: 'anthropic', match: /^claude-opus-5(?![-.]?\d)/, tiers: one(claude(5, 25, 0.5)), fast: 2 },
  { label: 'Claude Opus 4.8', vendor: 'anthropic', match: /^claude-opus-4[-.]8(?!\d)/, tiers: one(claude(5, 25, 0.5)), fast: 2 },
  { label: 'Claude Opus 4.5–4.7', vendor: 'anthropic', match: /^claude-opus-4[-.][567](?!\d)/, tiers: one(claude(5, 25, 0.5)) },
  { label: 'Claude Opus 4 / 4.1', vendor: 'anthropic', match: /^claude-opus-4(?:[-.]1|[-.]0)?(?![-.]?\d)/, tiers: one(claude(15, 75, 1.5)) },
  { label: 'Claude Sonnet 5.5', vendor: 'anthropic', match: /^claude-sonnet-5[-.]5(?!\d)/, tiers: one(claude(2, 10, 0.1)) },
  { label: 'Claude Sonnet 5', vendor: 'anthropic', match: /^claude-sonnet-5(?![-.]?\d)/, tiers: one(claude(2, 10, 0.2)) },
  { label: 'Claude Sonnet 4.x', vendor: 'anthropic', match: /^claude-sonnet-4(?:[-.][056])?(?![-.]?\d)/, tiers: one(claude(3, 15, 0.3)) },
  {
    label: 'Claude Haiku 5.5',
    vendor: 'anthropic',
    match: /^claude-haiku-5[-.]5(?!\d)/,
    tiers: one(claude(0.1, 0.5, 0.01), { over: 100_000, price: claude(0.5, 2.5, 0.05) })
  },
  { label: 'Claude Haiku 4.5', vendor: 'anthropic', match: /^claude-haiku-4[-.]5(?!\d)/, tiers: one(claude(1, 5, 0.1)) },

  // ── OpenAI（短上下文 ≤272K / 长上下文 >272K）──
  { label: 'GPT-6.2 Astra', vendor: 'openai', match: /^gpt-6\.2-astra/, tiers: one(openai(8, 0.4, 40, 10), { over: 272_000, price: openai(16, 0.8, 60, 20) }) },
  { label: 'GPT-6.2 Sol', vendor: 'openai', match: /^gpt-6\.2-sol/, tiers: one(openai(2, 0.1, 10, 2.5), { over: 272_000, price: openai(4, 0.2, 15, 5) }) },
  { label: 'GPT-6 Astra', vendor: 'openai', match: /^gpt-6-astra/, tiers: one(openai(10, 1, 50, 12.5), { over: 272_000, price: openai(20, 2, 75, 25) }) },
  { label: 'GPT-6.1 Sol', vendor: 'openai', match: /^gpt-6\.1-sol/, tiers: one(openai(2, 0.1, 10, 2.5), { over: 272_000, price: openai(4, 0.2, 15, 5) }) },
  { label: 'GPT-6.1 Terra', vendor: 'openai', match: /^gpt-6\.1-terra/, tiers: one(openai(1, 0.05, 5, 1.25), { over: 272_000, price: openai(2, 0.1, 7.5, 2.5) }) },
  { label: 'GPT-6 Luna', vendor: 'openai', match: /^gpt-6-luna/, tiers: one(openai(0.1, 0.01, 0.5, 0.125), { over: 272_000, price: openai(0.2, 0.02, 0.75, 0.25) }) },
  { label: 'GPT-6 Sol', vendor: 'openai', match: /^gpt-6-sol/, tiers: one(openai(2, 0.2, 10, 2.5), { over: 272_000, price: openai(4, 0.4, 15, 5) }) },
  { label: 'GPT-5.6 Sol', vendor: 'openai', match: /^gpt-5\.6-sol/, tiers: one(openai(4, 0.4, 20, 5), { over: 272_000, price: openai(8, 0.8, 30, 10) }) },
  { label: 'GPT-5.6 Terra', vendor: 'openai', match: /^gpt-5\.6-terra/, tiers: one(openai(2, 0.2, 12, 2.5), { over: 272_000, price: openai(4, 0.4, 18, 5) }) },
  { label: 'GPT-5.6 Luna', vendor: 'openai', match: /^gpt-5\.6-luna/, tiers: one(openai(0.2, 0.02, 1.2, 0.25), { over: 272_000, price: openai(0.4, 0.04, 1.8, 0.5) }) },
  { label: 'GPT-5.5', vendor: 'openai', match: /^gpt-5\.5(?![-\d]|-pro)/, tiers: one(openai(5, 0.5, 30), { over: 272_000, price: openai(10, 1, 45) }) },
  { label: 'GPT-5.4 mini', vendor: 'openai', match: /^gpt-5\.4-mini/, tiers: one(openai(0.75, 0.075, 4.5)) },
  { label: 'GPT-5.4 nano', vendor: 'openai', match: /^gpt-5\.4-nano/, tiers: one(openai(0.2, 0.02, 1.25)) },
  { label: 'GPT-5.4', vendor: 'openai', match: /^gpt-5\.4(?![-\d])/, tiers: one(openai(2.5, 0.25, 15), { over: 272_000, price: openai(5, 0.5, 22.5) }) },
  { label: 'GPT-5.3 Codex', vendor: 'openai', match: /^gpt-5\.3-codex/, tiers: one(openai(1.75, 0.175, 14)) },
  { label: 'GPT-5.2', vendor: 'openai', match: /^gpt-5\.2(?![-\d])/, tiers: one(openai(1.75, 0.175, 14)) },
  { label: 'GPT-5.1', vendor: 'openai', match: /^gpt-5\.1(?![-\d])/, tiers: one(openai(1.25, 0.125, 10)) },
  { label: 'GPT-5 mini', vendor: 'openai', match: /^gpt-5-mini/, tiers: one(openai(0.25, 0.025, 2)) },
  { label: 'GPT-5 nano', vendor: 'openai', match: /^gpt-5-nano/, tiers: one(openai(0.05, 0.005, 0.4)) },
  { label: 'GPT-5', vendor: 'openai', match: /^gpt-5(?![-.\d])/, tiers: one(openai(1.25, 0.125, 10)) },

  // ── Google（Gemini API 付费层标准价；Argon / Carbon 2026-12-01 起涨价，3.8 / 3.6 Flash 2027-01-01 起涨价）──
  {
    label: 'Gemini 4 Argon',
    vendor: 'google',
    match: /^gemini-4-argon/,
    tiers: [{ price: gemini(2, 10, 0.1) }, { since: '2026-12-01', price: gemini(4, 20, 0.2) }]
  },
  {
    label: 'Gemini 4 Carbon',
    vendor: 'google',
    match: /^gemini-4-carbon/,
    tiers: [{ price: gemini(2, 10, 0.1) }, { since: '2026-12-01', price: gemini(4, 20, 0.2) }]
  },
  { label: 'Gemini 4 Neon', vendor: 'google', match: /^gemini-4-neon/, tiers: one(gemini(3, 15, 0.15)) },
  { label: 'Gemini 4 Hydrogen', vendor: 'google', match: /^gemini-4-hydrogen/, tiers: one(gemini(1.5, 7.5, 0.075)) },
  {
    label: 'Gemini 3.8 Flash',
    vendor: 'google',
    match: /^gemini-3\.8-flash(?!-lite|-tts|-live)/,
    tiers: [{ price: gemini(0.75, 3.75, 0.075) }, { since: '2027-01-01', price: gemini(1.5, 7.5, 0.15) }]
  },
  {
    label: 'Gemini 3.6 Flash',
    vendor: 'google',
    match: /^gemini-3\.6-flash(?!-lite|-tts|-live)/,
    tiers: [{ price: gemini(0.75, 3.75, 0.075) }, { since: '2027-01-01', price: gemini(1.5, 7.5, 0.15) }]
  },
  { label: 'Gemini 3.5 Flash-Lite', vendor: 'google', match: /^gemini-3\.5-flash-lite/, tiers: one(gemini(0.3, 2.5, 0.03)) },
  {
    label: 'Gemini 3.1 Pro',
    vendor: 'google',
    match: /^gemini-3\.1-pro/,
    tiers: one(gemini(2, 12, 0.2), { over: 200_000, price: gemini(4, 18, 0.4) })
  },
  { label: 'Gemini 3.1 Flash-Lite', vendor: 'google', match: /^gemini-3\.1-flash-lite/, tiers: one(gemini(0.25, 1.5, 0.025)) },
  { label: 'Gemini 3 Flash', vendor: 'google', match: /^gemini-3-flash/, tiers: one(gemini(0.5, 3, 0.05)) }
]

/**
 * 统一模型 ID：小写、去掉厂商前缀 / 日期后缀 / [1m]，显示名里的空格和括号转成连字符。
 *   "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5"
 *   "Gemini 4 Argon (High)"      → "gemini-4-argon-high"
 */
export function normalizeModel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(anthropic|openai|google|models)[./]/, '')
    .replace(/\[1m\]$/, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/[-@]\d{8}$/, '')
}

export function findModelPrice(model: string, extra: ModelPrice[] = []): ModelPrice | null {
  const id = normalizeModel(model)
  return extra.find((m) => m.match.test(id)) ?? MODEL_PRICES.find((m) => m.match.test(id)) ?? null
}

/** 某一时刻生效的价格档 */
function tierAt(entry: ModelPrice, t: number): Tier {
  let hit = entry.tiers[0]
  for (const tier of entry.tiers) if (!tier.since || Date.parse(tier.since + 'T00:00:00Z') <= t) hit = tier
  return hit
}

const scale = (p: UnitPrice, k: number): UnitPrice => ({
  input: p.input * k,
  output: p.output * k,
  cacheRead: p.cacheRead * k,
  cacheWrite5m: p.cacheWrite5m * k,
  cacheWrite1h: p.cacheWrite1h * k
})

/** 单次请求的提示长度（含缓存读写） */
export function promptTokens(e: UsageTokens): number {
  return e.input + e.cacheRead + e.cacheWrite5m + e.cacheWrite1h
}

/** 单次请求实际适用的单价 */
export function unitPriceFor(e: UsageEvent, entry: ModelPrice): { unit: UnitPrice; long: boolean } {
  const tier = tierAt(entry, e.t)
  const long = !!tier.long && promptTokens(e) > tier.long.over
  let unit = long ? tier.long!.price : tier.price
  if (e.fast && entry.fast) unit = scale(unit, entry.fast)
  if (e.geoUs && entry.vendor === 'anthropic') unit = scale(unit, 1.1)
  return { unit, long }
}

const WEB_SEARCH_USD = 10 / 1000

const zeroTokens = (): UsageTokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const

export function totalTokens(e: UsageTokens): number {
  return e.input + e.output + e.cacheRead + e.cacheWrite5m + e.cacheWrite1h
}

/** 把一批请求按模型汇总并折算 */
export function aggregateValue(
  events: UsageEvent[],
  range: Pick<ValueRange, 'id' | 'label' | 'from' | 'to'>,
  extra: ModelPrice[] = []
): ValueRange {
  const rows = new Map<string, ValueModelRow & { lastT: number; longN: number; fastN: number }>()
  for (const e of events) {
    if (e.t < range.from || e.t > range.to) continue
    if (totalTokens(e) === 0) continue
    const entry = findModelPrice(e.model, extra) ?? (e.modelName ? findModelPrice(e.modelName, extra) : null)
    const key = entry ? entry.label : normalizeModel(e.model)
    let row = rows.get(key)
    if (!row) {
      row = {
        model: normalizeModel(e.model),
        label: entry?.label ?? e.modelName ?? e.model,
        priced: !!entry,
        requests: 0,
        tokens: zeroTokens(),
        cost: { ...zeroTokens(), extra: 0 },
        total: 0,
        notes: [],
        lastT: 0,
        longN: 0,
        fastN: 0
      }
      rows.set(key, row)
    }
    row.requests++
    for (const k of TOKEN_KEYS) row.tokens[k] += e[k]
    if (!entry) continue
    const { unit, long } = unitPriceFor(e, entry)
    for (const k of TOKEN_KEYS) row.cost[k] += (e[k] * unit[k]) / 1e6
    if (e.webSearches && entry.vendor === 'anthropic') row.cost.extra += e.webSearches * WEB_SEARCH_USD
    if (long) row.longN++
    if (e.fast && entry.fast) row.fastN++
    if (e.t >= row.lastT) {
      row.lastT = e.t
      row.unit = unit
    }
  }

  const models: ValueModelRow[] = []
  let total = 0
  let requests = 0
  let unpricedTokens = 0
  for (const { lastT: _t, longN, fastN, ...row } of rows.values()) {
    row.total = TOKEN_KEYS.reduce((s, k) => s + row.cost[k], row.cost.extra)
    if (longN) row.notes.push(`${longN} 次请求超过长上下文阈值，按长上下文价`)
    if (fastN) row.notes.push(`${fastN} 次请求为快速模式（价格 ×2）`)
    if (row.cost.extra) row.notes.push('含网页搜索 $10 / 千次')
    if (!row.priced) unpricedTokens += totalTokens(row.tokens)
    total += row.total
    requests += row.requests
    models.push(row)
  }
  models.sort((a, b) => Number(b.priced) - Number(a.priced) || b.total - a.total || totalTokens(b.tokens) - totalTokens(a.tokens))
  return { ...range, total, requests, unpricedTokens, models }
}

const H = 3600 * 1000

/** 统计区间：当前 5 小时周期、本周周期（按额度窗口的重置时间对齐），近 30 天 */
export function valueRanges(snap: PlatformSnapshot | undefined, now: number): Pick<ValueRange, 'id' | 'label' | 'from' | 'to'>[] {
  const future = (kind: string) =>
    (snap?.windows ?? [])
      .filter((w) => w.kind === kind && w.resetsAt && Date.parse(w.resetsAt) > now)
      .map((w) => Date.parse(w.resetsAt!))
      .sort((a, b) => a - b)[0]
  const s = future('session')
  const w = future('weekly')
  return [
    s ? { id: 'session', label: '本 5 小时周期', from: s - 5 * H, to: now } : { id: 'session', label: '近 5 小时', from: now - 5 * H, to: now },
    w ? { id: 'weekly', label: '本周周期', from: w - 7 * 24 * H, to: now } : { id: 'weekly', label: '近 7 天', from: now - 7 * 24 * H, to: now },
    { id: 'month', label: '近 30 天', from: now - 30 * 24 * H, to: now }
  ]
}

// ───────────────────────── 显示 ─────────────────────────

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return String(Math.round(n))
}

export function formatUsd(v: number): string {
  if (v === 0) return '$0'
  if (v < 0.01) return '<$0.01'
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  return `$${v.toFixed(2)}`
}

export function formatUnit(v: number): string {
  if (v >= 1) return `$${Number(v.toFixed(2))}`
  return `$${Number(v.toPrecision(3))}`
}
