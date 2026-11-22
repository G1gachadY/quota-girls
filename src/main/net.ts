/**
 * 网络层（只在 main 进程使用）。
 * - 官方域名（api.anthropic.com / claude.ai / chatgpt.com）走 Electron net.fetch：Chromium 网络栈，
 *   自动跟随系统代理，正常校验证书。
 * - 127.0.0.1 走 Node http/https：仅对 127.0.0.1 放行自签名证书（Antigravity 本地 language server）。
 * - 其它任何域名一律拒绝，保证 token 只发往对应官方域名。
 */
import http from 'node:http'
import https from 'node:https'
import { ProviderError } from './util'

export const ALLOWED_HOSTS = new Set(['api.anthropic.com', 'claude.ai', 'chatgpt.com'])

export interface HttpOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface HttpResponse {
  status: number
  ok: boolean
  text: string
  json: unknown
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export async function httpRequest(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const u = new URL(url)
  if (u.hostname === '127.0.0.1') return localRequest(u, opts)
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new ProviderError(`拒绝请求非白名单域名：${u.hostname}`, 'config', '这是程序内部错误，请反馈')
  }
  const { net } = await import('electron')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000)
  try {
    const res = await net.fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: ctrl.signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store'
    } as RequestInit)
    const text = await res.text()
    return { status: res.status, ok: res.ok, text, json: tryJson(text) }
  } catch (e) {
    const aborted = ctrl.signal.aborted
    throw new ProviderError(
      aborted ? '请求超时' : `网络错误：${(e as Error)?.message ?? e}`,
      'network',
      '检查网络 / 代理是否能访问该平台；程序会跟随 Windows 系统代理设置'
    )
  } finally {
    clearTimeout(timer)
  }
}

function localRequest(u: URL, opts: HttpOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = u.protocol === 'https:'
    const mod = isHttps ? https : http
    const body = opts.body ?? undefined
    const req = mod.request(
      {
        host: '127.0.0.1',
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: {
          ...(opts.headers ?? {}),
          ...(body != null ? { 'Content-Length': Buffer.byteLength(body).toString() } : {})
        },
        // 仅对 127.0.0.1 放行自签名证书
        ...(isHttps ? { rejectUnauthorized: false, servername: undefined } : {}),
        timeout: opts.timeoutMs ?? 5000
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          resolve({ status, ok: status >= 200 && status < 300, text, json: tryJson(text) })
        })
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => reject(new ProviderError(`本地连接失败：${e.message}`, 'network', '')))
    if (body != null) req.write(body)
    req.end()
  })
}

/** 把 HTTP 状态码映射成错误类型（用于退避与 UI 提示） */
export function classifyStatus(status: number): 'auth' | 'rate' | 'server' | 'other' {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate'
  if (status >= 500) return 'server'
  return 'other'
}
