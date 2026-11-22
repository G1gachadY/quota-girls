/**
 * Antigravity 本机对话记录：~/.gemini/antigravity/conversations/<id>.db（SQLite，用 Electron 自带的 node:sqlite 只读打开）。
 *   gen_metadata.data（protobuf）：字段 1 是一次生成的元数据
 *     .4  用量 { 2 输入（不含缓存）, 3 输出（含思考）, 4 缓存写入, 5 缓存读取, 11 response_id }
 *     .19 模型 ID（如 gemini-4-argon-trial）  .21 显示名（如 "Gemini 4 Argon (High)"）
 *     .20 键值对，其中 last_step_index 指向 steps 表
 *   steps.metadata（protobuf）：字段 1 是创建时间 Timestamp
 * 没有 schema，按字段号宽容解析；解析不了的行跳过。只读，不复制、不改动数据库。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UsageEvent } from '../providers/types'

interface Field {
  no: number
  wire: number
  v?: bigint
  b?: Buffer
}

function varint(b: Buffer, i: number): [bigint, number] {
  let r = 0n
  let s = 0n
  for (;;) {
    if (i >= b.length) throw new Error('eof')
    const x = b[i++]
    r |= BigInt(x & 0x7f) << s
    s += 7n
    if (!(x & 0x80)) return [r, i]
  }
}

function fields(b: Buffer): Field[] {
  const out: Field[] = []
  let i = 0
  while (i < b.length) {
    const [k, j] = varint(b, i)
    i = j
    const no = Number(k >> 3n)
    const wire = Number(k & 7n)
    if (wire === 0) {
      const [v, j2] = varint(b, i)
      i = j2
      out.push({ no, wire, v })
    } else if (wire === 1) {
      i += 8
    } else if (wire === 5) {
      i += 4
    } else if (wire === 2) {
      const [len, j2] = varint(b, i)
      i = j2
      const end = i + Number(len)
      if (end > b.length) throw new Error('eof')
      out.push({ no, wire, b: b.subarray(i, end) })
      i = end
    } else {
      throw new Error(`wire ${wire}`)
    }
  }
  return out
}

const num = (xs: Field[], no: number): number => Number(xs.find((f) => f.no === no && f.wire === 0)?.v ?? 0n)
const str = (xs: Field[], no: number): string | undefined => xs.find((f) => f.no === no && f.wire === 2)?.b?.toString('utf8')
const msg = (xs: Field[], no: number): Field[] | null => {
  const f = xs.find((x) => x.no === no && x.wire === 2)
  if (!f?.b) return null
  try {
    return fields(f.b)
  } catch {
    return null
  }
}

function stepTime(meta: Buffer): number | null {
  try {
    const ts = msg(fields(meta), 1)
    const sec = ts ? num(ts, 1) : 0
    return sec > 1_600_000_000 ? sec * 1000 : null
  } catch {
    return null
  }
}

function parseGen(data: Buffer): { usage: Field[]; model: string; name?: string; step?: number; id?: string } | null {
  try {
    const g = msg(fields(data), 1)
    if (!g) return null
    const usage = msg(g, 4)
    const model = str(g, 19)
    if (!usage || !model) return null
    let step: number | undefined
    for (const f of g) {
      if (f.no !== 20 || !f.b) continue
      const kv = fields(f.b)
      if (str(kv, 1) === 'last_step_index') step = Number(str(kv, 2))
    }
    return { usage, model, name: str(g, 21), step: Number.isFinite(step) ? step : undefined, id: str(usage, 11) }
  } catch {
    return null
  }
}

interface DbState {
  mtimeMs: number
  size: number
  events: UsageEvent[]
}

const dbs = new Map<string, DbState>()

export function antigravityConversationsDir(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'conversations')
}

type Sqlite = typeof import('node:sqlite')
let sqlite: Sqlite | null | undefined

async function loadSqlite(): Promise<Sqlite | null> {
  if (sqlite === undefined) {
    try {
      sqlite = await import('node:sqlite')
    } catch {
      sqlite = null
    }
  }
  return sqlite
}

function readDb(mod: Sqlite, file: string, fallbackT: number): UsageEvent[] {
  const db = new mod.DatabaseSync(file, { readOnly: true })
  try {
    const times = new Map<number, number>()
    try {
      for (const r of db.prepare('SELECT idx, metadata FROM steps').all() as { idx: number; metadata: Uint8Array | null }[]) {
        const t = r.metadata ? stepTime(Buffer.from(r.metadata)) : null
        if (t) times.set(Number(r.idx), t)
      }
    } catch {
      /* 没有 steps 表：用文件时间 */
    }
    const out: UsageEvent[] = []
    for (const r of db.prepare('SELECT idx, data FROM gen_metadata').all() as { idx: number; data: Uint8Array | null }[]) {
      if (!r.data) continue
      const g = parseGen(Buffer.from(r.data))
      if (!g) continue
      out.push({
        t: (g.step != null ? times.get(g.step) : undefined) ?? fallbackT,
        model: g.model,
        modelName: g.name,
        input: num(g.usage, 2),
        output: num(g.usage, 3),
        cacheWrite5m: num(g.usage, 4),
        cacheRead: num(g.usage, 5),
        cacheWrite1h: 0
      })
    }
    return out
  } finally {
    db.close()
  }
}

export async function scanAntigravity(since: number): Promise<{ events: UsageEvent[]; files: number; error?: string }> {
  const dir = antigravityConversationsDir()
  let names: string[]
  try {
    names = (await fs.promises.readdir(dir)).filter((x) => x.endsWith('.db'))
  } catch {
    return { events: [], files: 0 }
  }
  const mod = await loadSqlite()
  if (!mod) return { events: [], files: 0, error: '当前运行环境没有 SQLite 支持，无法读取 Antigravity 对话记录' }
  let files = 0
  const seen = new Set<string>()
  for (const name of names) {
    const file = path.join(dir, name)
    let mtimeMs = 0
    let size = 0
    try {
      const st = await fs.promises.stat(file)
      mtimeMs = st.mtimeMs
      size = st.size
      // WAL 模式下新写入先进 -wal 文件
      const wal = await fs.promises.stat(file + '-wal').catch(() => null)
      if (wal) {
        mtimeMs = Math.max(mtimeMs, wal.mtimeMs)
        size += wal.size
      }
    } catch {
      continue
    }
    if (mtimeMs < since) continue
    files++
    seen.add(file)
    const prev = dbs.get(file)
    if (prev && prev.mtimeMs === mtimeMs && prev.size === size) continue
    try {
      dbs.set(file, { mtimeMs, size, events: readDb(mod, file, mtimeMs) })
    } catch {
      /* 数据库正被写入或格式变了：保留上次结果 */
    }
  }
  for (const k of dbs.keys()) if (!seen.has(k)) dbs.delete(k)
  const events: UsageEvent[] = []
  for (const d of dbs.values()) for (const e of d.events) if (e.t >= since) events.push(e)
  return { events, files }
}
