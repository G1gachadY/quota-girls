/**
 * Codex 本机会话记录：$CODEX_HOME（默认 ~/.codex）/sessions 与 archived_sessions 下的 rollout-*.jsonl。
 *   新版：每次请求一条 token_usage_record（usage + response_id），按 response_id 去重；
 *         模型取同一文件里 turn_context 的 model（按 turn_id 对应）。
 *   旧版：只有 event_msg/token_count，累计值 total_token_usage 增长时取 last_token_usage
 *         （恢复的会话从旧累计值继续，所以不能直接用累计值）。
 * OpenAI 口径里 input_tokens 包含 cached_input_tokens，这里拆开：input 只算未命中缓存的部分。只读。
 */
import os from 'node:os'
import path from 'node:path'
import type { UsageEvent } from '../providers/types'
import { type FileCursor, listRecentFiles, n, readNewLines } from './files'

interface FileState extends FileCursor {
  lastModel: string | null
  turnModels: Map<string, string>
  prevTotal: number
  hasRecords: boolean
  /** 在第一条 turn_context 之前出现的请求：等看到模型再补上 */
  pending: UsageEvent[]
  /** 旧版 token_count 推出来的请求（文件里有 token_usage_record 时弃用） */
  counts: UsageEvent[]
}

const states = new Map<string, FileState>()
const records = new Map<string, UsageEvent>()

export function codexRoots(): string[] {
  const home = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')
  return [path.join(home, 'sessions'), path.join(home, 'archived_sessions')]
}

function toEvent(t: number, model: string, u: any): UsageEvent | null {
  if (!u || typeof u !== 'object') return null
  const cached = n(u.cached_input_tokens)
  const write = n(u.cache_write_input_tokens)
  return {
    t,
    model,
    input: Math.max(0, n(u.input_tokens) - cached - write),
    output: n(u.output_tokens),
    cacheRead: cached,
    cacheWrite5m: write,
    cacheWrite1h: 0
  }
}

function handle(file: string, st: FileState, line: string): void {
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return
  }
  const t = Date.parse(j?.timestamp)
  const p = j?.payload
  if (!p || !Number.isFinite(t)) return
  if (j.type === 'turn_context') {
    if (typeof p.model === 'string' && p.model) {
      st.lastModel = p.model
      if (typeof p.turn_id === 'string') st.turnModels.set(p.turn_id, p.model)
      for (const e of st.pending) e.model = p.model
      st.pending = []
    }
    return
  }
  if (j.type === 'token_usage_record') {
    const model = (typeof p.turn_id === 'string' && st.turnModels.get(p.turn_id)) || st.lastModel || 'unknown'
    const ev = toEvent(t, model, p.usage)
    if (!ev) return
    if (model === 'unknown') st.pending.push(ev)
    st.hasRecords = true
    records.set(typeof p.response_id === 'string' && p.response_id ? p.response_id : `${file}:${t}`, ev)
    return
  }
  if (j.type === 'event_msg' && p.type === 'token_count' && p.info) {
    const total = n(p.info.total_token_usage?.total_tokens)
    if (total > st.prevTotal || (total === 0 && st.prevTotal === 0)) {
      const ev = toEvent(t, st.lastModel ?? 'unknown', p.info.last_token_usage)
      if (ev) {
        st.counts.push(ev)
        if (!st.lastModel) st.pending.push(ev)
      }
    }
    st.prevTotal = Math.max(st.prevTotal, total)
  }
}

export async function scanCodex(since: number): Promise<{ events: UsageEvent[]; files: number }> {
  let files = 0
  for (const root of codexRoots()) {
    const list = await listRecentFiles(root, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), since)
    for (const f of list) {
      files++
      let st = states.get(f.file)
      if (st && st.size === f.size && st.mtimeMs === f.mtimeMs) continue
      if (!st || f.size < st.offset) {
        st = { size: 0, mtimeMs: 0, offset: 0, lastModel: null, turnModels: new Map(), prevTotal: 0, hasRecords: false, pending: [], counts: [] }
        states.set(f.file, st)
      }
      const cur = st
      try {
        cur.offset = await readNewLines(f.file, cur.offset, ['"token_usage_record"', '"turn_context"', '"token_count"'], (line) =>
          handle(f.file, cur, line)
        )
        cur.size = f.size
        cur.mtimeMs = f.mtimeMs
      } catch {
        /* 下次再试 */
      }
    }
  }
  const out: UsageEvent[] = []
  for (const e of records.values()) if (e.t >= since) out.push(e)
  for (const st of states.values()) if (!st.hasRecords) for (const e of st.counts) if (e.t >= since) out.push(e)
  for (const [k, e] of records) if (e.t < since) records.delete(k)
  return { events: out, files }
}
