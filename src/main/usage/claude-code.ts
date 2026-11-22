/**
 * Claude Code 本机会话记录：~/.claude/projects/**\/*.jsonl（含子代理 subagents/）。
 * 每条 assistant 消息带 message.model 和 message.usage；流式输出会把同一条消息写多行，
 * 按 message.id + requestId 去重（各字段取最大值）。只读，不改动任何文件。
 */
import os from 'node:os'
import path from 'node:path'
import type { UsageEvent } from '../providers/types'
import { type FileCursor, listRecentFiles, n, readNewLines } from './files'

const cursors = new Map<string, FileCursor>()
const events = new Map<string, UsageEvent>()

export function claudeProjectRoots(): string[] {
  const roots = new Set<string>()
  for (const dir of (process.env.CLAUDE_CONFIG_DIR ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    roots.add(path.join(dir, 'projects'))
  }
  roots.add(path.join(os.homedir(), '.claude', 'projects'))
  roots.add(path.join(os.homedir(), '.config', 'claude', 'projects'))
  return [...roots]
}

function onLine(line: string): void {
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return
  }
  if (j?.type !== 'assistant') return
  const msg = j.message
  const u = msg?.usage
  const model = typeof msg?.model === 'string' ? msg.model : ''
  if (!u || !model || model.startsWith('<')) return
  const t = Date.parse(j.timestamp)
  if (!Number.isFinite(t)) return
  const cc = u.cache_creation
  const cw1h = n(cc?.ephemeral_1h_input_tokens)
  const cw5m = cc ? n(cc.ephemeral_5m_input_tokens) || Math.max(0, n(u.cache_creation_input_tokens) - cw1h) : n(u.cache_creation_input_tokens)
  const ev: UsageEvent = {
    t,
    model,
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite5m: cw5m,
    cacheWrite1h: cw1h,
    fast: u.speed === 'fast' || undefined,
    geoUs: u.inference_geo === 'us' || undefined,
    webSearches: n(u.server_tool_use?.web_search_requests) || undefined
  }
  const key = `${msg.id ?? ''}:${j.requestId ?? ''}` === ':' ? `${t}:${model}` : `${msg.id ?? ''}:${j.requestId ?? ''}`
  const prev = events.get(key)
  if (!prev) {
    events.set(key, ev)
    return
  }
  prev.input = Math.max(prev.input, ev.input)
  prev.output = Math.max(prev.output, ev.output)
  prev.cacheRead = Math.max(prev.cacheRead, ev.cacheRead)
  prev.cacheWrite5m = Math.max(prev.cacheWrite5m, ev.cacheWrite5m)
  prev.cacheWrite1h = Math.max(prev.cacheWrite1h, ev.cacheWrite1h)
  prev.webSearches = Math.max(prev.webSearches ?? 0, ev.webSearches ?? 0) || undefined
}

export async function scanClaudeCode(since: number): Promise<{ events: UsageEvent[]; files: number }> {
  let files = 0
  for (const root of claudeProjectRoots()) {
    for (const f of await listRecentFiles(root, (name) => name.endsWith('.jsonl'), since)) {
      files++
      const c = cursors.get(f.file)
      if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) continue
      const from = c && f.size >= c.offset ? c.offset : 0
      try {
        const offset = await readNewLines(f.file, from, ['"usage"'], onLine)
        cursors.set(f.file, { size: f.size, mtimeMs: f.mtimeMs, offset })
      } catch {
        /* 读不了就跳过，下次再试 */
      }
    }
  }
  for (const [k, e] of events) if (e.t < since) events.delete(k)
  return { events: [...events.values()], files }
}
