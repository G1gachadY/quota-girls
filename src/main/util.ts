/** main 进程通用工具：打码、脱敏、JWT 解码、宽容取值。 */
import type { RawEntry } from './providers/types'

export type ErrorKind = 'auth' | 'rate' | 'server' | 'network' | 'parse' | 'config' | 'offline'

export class ProviderError extends Error {
  constructor(
    message: string,
    public kind: ErrorKind,
    public hint: string,
    public status?: number,
    /** 出错前已收集到的原始响应（已脱敏） */
    public raw?: RawEntry[]
  ) {
    super(message)
  }
}

/** 原始响应面板用：去掉体积巨大但无用的字段（例如 Antigravity 的 supportedMimeTypes） */
export function pruneNoise(value: unknown, depth = 0): unknown {
  if (depth > 30 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const arr = value.slice(0, 40).map((v) => pruneNoise(v, depth + 1))
    if (value.length > 40) arr.push(`… 另有 ${value.length - 40} 项`)
    return arr
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'supportedMimeTypes' || k === 'allowedTiers') {
      out[k] = '[已省略]'
      continue
    }
    out[k] = pruneNoise(v, depth + 1)
  }
  return out
}

export function maskEmail(email: string | undefined | null): string | undefined {
  if (!email || typeof email !== 'string') return undefined
  const at = email.indexOf('@')
  if (at <= 0) return email.length > 2 ? `${email[0]}***` : '***'
  return `${email[0]}***${email.slice(at)}`
}

const SENSITIVE_KEY =
  /(token|secret|password|passwd|cookie|authorization|api[_-]?key|session[_-]?key|sessionkey|csrf|bearer|credential|refresh)/i
const ID_KEY = /^(uuid|.*_uuid|account_id|user_id|org_id|organization_id|accountid|userid|sub|id)$/i
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const JWT_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONG_SECRET_RE = /^[A-Za-z0-9_\-+/=.]{40,}$/

function maskString(key: string, v: string): string {
  if (SENSITIVE_KEY.test(key) && v.length > 0) return `***(${v.length})`
  if (v.startsWith('sk-ant-') || v.startsWith('sk-')) return '***(key)'
  if (JWT_RE.test(v)) return '***(jwt)'
  if (UUID_RE.test(v)) return `${v.slice(0, 4)}****-****`
  if (ID_KEY.test(key) && v.length > 6) return `${v.slice(0, 4)}****`
  if (LONG_SECRET_RE.test(v) && !/^\d+$/.test(v) && !v.includes('/')) return `***(${v.length})`
  return v.replace(EMAIL_RE, (m) => maskEmail(m) ?? '***')
}

/** 深度脱敏：token/cookie/密钥 → ***，邮箱 → a***@x.com，UUID/ID → 前 4 位。 */
export function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (depth > 30) return '[depth]'
  if (value == null) return value
  if (typeof value === 'string') return maskString(key, value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const arr = value.slice(0, 200).map((v) => sanitize(v, key, depth + 1))
    if (value.length > 200) arr.push(`… ${value.length - 200} more`)
    return arr
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitize(v, k, depth + 1)
  }
  return out
}

/** 日志用：把文本里可能出现的 token / 邮箱打码 */
export function scrubText(text: string): string {
  return text
    .replace(/Bearer\s+[\w.\-+/=]+/gi, 'Bearer ***')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '***(jwt)')
    .replace(/sk-ant-[\w-]+/g, 'sk-ant-***')
    .replace(/(csrf_token[=\s]+)\S+/gi, '$1***')
    .replace(EMAIL_RE, (m) => maskEmail(m) ?? '***')
}

export function decodeJwtPayload(jwt: unknown): Record<string, unknown> | null {
  if (typeof jwt !== 'string') return null
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const obj = JSON.parse(json)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

/** 按路径宽容取值：get(obj, 'a.b.0.c') */
export function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const k of path.split('.')) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) cur = cur[Number(k)]
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[k]
    else return undefined
  }
  return cur
}

/** 深度查找第一个名为 keys 之一、值为非空字符串的字段 */
export function deepFindString(obj: unknown, keys: string[], depth = 0): string | undefined {
  if (!obj || typeof obj !== 'object' || depth > 8) return undefined
  if (!Array.isArray(obj)) {
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = deepFindString(v, keys, depth + 1)
    if (found) return found
  }
  return undefined
}

/**
 * 时间解析：ISO 字符串 / Unix 秒 / Unix 毫秒 / protobuf Timestamp {seconds, nanos}
 */
export function parseTime(v: unknown): string | null {
  if (v == null || v === '') return null
  if (isObj(v) && 'seconds' in v) {
    const s = num(v.seconds)
    return s != null ? new Date(s * 1000).toISOString() : null
  }
  if (typeof v === 'string') {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return parseTime(Number(v))
    const t = Date.parse(v)
    return Number.isFinite(t) ? new Date(t).toISOString() : null
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = v > 1e12 ? v : v * 1000
    return new Date(ms).toISOString()
  }
  return null
}

export function clampPct(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return Math.min(100, Math.max(0, v))
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return scrubText(e.message)
  return scrubText(String(e))
}
