/**
 * 从 CC Switch 的配置里找某个域名对应的 API Key（只读）：
 *   ~/.cc-switch/cc-switch.db（新版 SQLite，providers.settings_config）
 *   ~/.cc-switch/config.json（旧版）
 *
 * 只认"成对"的字段，避免把别的凭据发错地方：
 *   Claude 供应商  env.ANTHROPIC_BASE_URL 指向这个域名 → env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY
 *   Gemini 供应商  env.GOOGLE_GEMINI_BASE_URL 指向这个域名 → env.GEMINI_API_KEY
 * Codex 供应商的配置里地址和 Key 对应关系不明确（还可能含 ChatGPT 登录的 refresh_token），一律不读。
 * Key 只在 main 进程里用，只发往这个域名。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface FoundKey {
  key: string
  provider: string
}

const PAIRS: { url: string; keys: string[] }[] = [
  { url: 'ANTHROPIC_BASE_URL', keys: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'] },
  { url: 'GOOGLE_GEMINI_BASE_URL', keys: ['GEMINI_API_KEY'] }
]

function looksLikeKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 16 && v.length <= 300 && !/\s/.test(v) && !/^https?:/i.test(v)
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** 在一个供应商的 settingsConfig 里按成对字段找 Key */
function keyFor(config: unknown, host: string): string | null {
  const env = (config as { env?: Record<string, unknown> } | null)?.env
  if (!env || typeof env !== 'object') return null
  for (const pair of PAIRS) {
    if (hostOf(env[pair.url]) !== host) continue
    for (const k of pair.keys) if (looksLikeKey(env[k])) return env[k] as string
  }
  return null
}

function parse(text: unknown): unknown {
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function fromDb(host: string): Promise<FoundKey | null> {
  const db = path.join(os.homedir(), '.cc-switch', 'cc-switch.db')
  if (!fs.existsSync(db)) return null
  const { DatabaseSync } = await import('node:sqlite')
  const conn = new DatabaseSync(db, { readOnly: true })
  try {
    const rows = conn.prepare('SELECT name, app_type, settings_config, is_current FROM providers').all() as {
      name: string
      app_type: string
      settings_config: string
      is_current: number
    }[]
    rows.sort((a, b) => Number(b.is_current) - Number(a.is_current))
    for (const r of rows) {
      if (r.app_type !== 'claude' && r.app_type !== 'gemini') continue
      const key = keyFor(parse(r.settings_config), host)
      if (key) return { key, provider: String(r.name ?? '') }
    }
  } finally {
    conn.close()
  }
  return null
}

function fromJson(host: string): FoundKey | null {
  const f = path.join(os.homedir(), '.cc-switch', 'config.json')
  let j: Record<string, unknown>
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
  // 旧版：{ claude: { providers: { id: { name, settingsConfig } } }, gemini: {...} }
  for (const appName of ['claude', 'gemini']) {
    const providers = (j?.[appName] as { providers?: Record<string, { name?: string; settingsConfig?: unknown }> })?.providers
    for (const p of Object.values(providers ?? {})) {
      const key = keyFor(p?.settingsConfig, host)
      if (key) return { key, provider: String(p?.name ?? '') }
    }
  }
  return null
}

export async function findCcSwitchKey(host: string): Promise<FoundKey | null> {
  const h = host.toLowerCase()
  try {
    return (await fromDb(h)) ?? fromJson(h)
  } catch {
    return fromJson(h)
  }
}
