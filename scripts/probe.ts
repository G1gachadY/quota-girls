/**
 * npm run probe —— 在本机实际请求三个平台，打印脱敏后的原始响应和解析后的 PlatformSnapshot。
 * 作为 Electron main 进程运行（与应用同一套网络栈：系统代理、Chromium 证书校验）。
 *
 *   npm run probe                 # 三个平台
 *   npm run probe -- claude       # 只探测某个平台（claude / codex / antigravity / deepseek / 自定义平台 id）
 *   npm run probe -- value        # 打印三个平台本机记录按官方 API 定价折算的结果（可加平台名）
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { claudeWebDeps } from '../src/main/claude-web'
import { fetchAntigravity } from '../src/main/providers/antigravity'
import { fetchCustom, fetchDeepSeek } from '../src/main/providers/balance'
import { fetchClaude } from '../src/main/providers/claude'
import { fetchCodex } from '../src/main/providers/codex'
import { getValueReport, type ValuePlatform } from '../src/main/usage'
import { formatTokens, formatUsd, totalTokens } from '../src/shared/pricing'
import type { AppSettings, PlatformId, ProviderResult } from '../src/main/providers/types'
import { ProviderError, errorText } from '../src/main/util'
import { normalizeSettings } from '../src/shared/quota'

app.setName('QuotaGirls')
app.setPath('userData', path.join(app.getPath('appData'), 'QuotaGirls'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {
  /* 隐藏窗口销毁时不要退出 */
})

function loadSettings(): AppSettings {
  try {
    const text = fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')
    return normalizeSettings(JSON.parse(text))
  } catch {
    return normalizeSettings({})
  }
}

const out = (s: string) => process.stdout.write(s + '\n')
const hr = (t: string) => out(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`)

async function run(name: PlatformId, fn: () => Promise<ProviderResult>) {
  hr(name.toUpperCase())
  const t0 = Date.now()
  try {
    const r = await fn()
    for (const e of r.raw) {
      out(`\n── 原始响应 · ${e.label}${e.status != null ? ` · HTTP ${e.status}` : ''}`)
      out(JSON.stringify(e.body, null, 2))
    }
    out(`\n── 解析后的 PlatformSnapshot（${Date.now() - t0} ms）`)
    out(JSON.stringify(r.snapshot, null, 2))
  } catch (e) {
    if (e instanceof ProviderError) {
      for (const r of e.raw ?? []) {
        out(`\n── 原始响应 · ${r.label}${r.status != null ? ` · HTTP ${r.status}` : ''}`)
        out(JSON.stringify(r.body, null, 2))
      }
    }
    out(`\n✗ 失败：${errorText(e)}`)
    if (e instanceof ProviderError) out(`  kind=${e.kind} hint=${e.hint}`)
  }
}

async function value(p: ValuePlatform) {
  hr(`${p.toUpperCase()} · 等价 API 价值`)
  const t0 = Date.now()
  const r = await getValueReport(p, undefined)
  out(`${r.scope} · ${r.files} 个文件 · 扫描 ${Date.now() - t0} ms${r.error ? ` · 错误：${r.error}` : ''}`)
  for (const range of r.ranges) {
    out(`
── ${range.label}：${formatUsd(range.total)}（${range.requests} 次请求）`)
    for (const m of range.models) {
      const t = m.tokens
      out(
        `  ${m.label.padEnd(22)} ${String(m.requests).padStart(5)} 次  ${formatTokens(totalTokens(t)).padStart(7)} tok  ` +
          `${m.priced ? formatUsd(m.total) : '无公开定价'}  ` +
          `[入 ${formatTokens(t.input)} 出 ${formatTokens(t.output)} 读缓存 ${formatTokens(t.cacheRead)} 写缓存 ${formatTokens(t.cacheWrite5m + t.cacheWrite1h)}]`
      )
      for (const note of m.notes) out(`      · ${note}`)
    }
  }
}

app.whenReady().then(async () => {
  const settings = loadSettings()
  const args = process.argv.slice(2)
  const only = args.find((a) => ['claude', 'codex', 'antigravity', 'deepseek'].includes(a) || a.startsWith('x-'))
  if (args.includes('value')) {
    for (const p of ['claude', 'codex', 'antigravity'] as ValuePlatform[]) if (!only || only === p) await value(p)
    app.exit(0)
    return
  }
  // 可选：强制数据源，例如 npm run probe -- codex rpc / npm run probe -- claude web
  const forced = args.find((a) => ['oauth', 'web', 'api', 'rpc', 'local-log'].includes(a))
  if (forced && only === 'claude' && (forced === 'oauth' || forced === 'web')) settings.sources.claude = forced
  if (forced && only === 'codex' && (forced === 'api' || forced === 'rpc' || forced === 'local-log'))
    settings.sources.codex = forced
  out(`userData: ${app.getPath('userData')}`)
  out(`数据源设置: ${JSON.stringify(settings.sources)}`)
  if (!only || only === 'claude') await run('claude', () => fetchClaude(settings, claudeWebDeps))
  if (!only || only === 'codex') await run('codex', () => fetchCodex(settings))
  if (!only || only === 'antigravity') await run('antigravity', () => fetchAntigravity(settings))
  if (!only || only === 'deepseek') await run('deepseek', () => fetchDeepSeek(settings))
  for (const c of settings.customPlatforms) {
    if (!only || only === c.id) await run(c.id, () => fetchCustom(c, settings))
  }
  out('\n完成。以上内容已脱敏（token / cookie / 邮箱已打码）。')
  app.exit(0)
})
