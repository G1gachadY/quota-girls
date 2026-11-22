/** 本地记录扫描的公共工具：增量读 JSONL、按修改时间列文件、宽容取数 */
import fs from 'node:fs'
import path from 'node:path'

/** 只看最近这么久有改动的文件 / 记录 */
export const RETENTION_MS = 31 * 24 * 3600 * 1000

export interface FileCursor {
  size: number
  mtimeMs: number
  /** 已处理到的字节位置（最后一个完整行之后） */
  offset: number
}

const CHUNK = 1 << 20

/**
 * 从 offset 读到文件末尾，只把包含任一标记的完整行解码后交给 onLine（不含标记的大行不解码、不 JSON.parse）。
 * 返回最后一个完整行之后的位置；正在写入的半行留到下次。
 */
export async function readNewLines(
  file: string,
  offset: number,
  markers: string[],
  onLine: (line: string) => void
): Promise<number> {
  const marks = markers.map((m) => Buffer.from(m))
  const fh = await fs.promises.open(file, 'r')
  try {
    let pos = offset
    let consumed = offset
    let carry: Buffer = Buffer.alloc(0)
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK)
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos)
      if (bytesRead === 0) break
      pos += bytesRead
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      let start = 0
      for (;;) {
        const nl = data.indexOf(10, start)
        if (nl < 0) break
        const line = data.subarray(start, nl)
        if (marks.some((m) => line.indexOf(m) >= 0)) onLine(line.toString('utf8'))
        consumed += nl + 1 - start
        start = nl + 1
      }
      carry = data.subarray(start)
    }
    return consumed
  } finally {
    await fh.close()
  }
}

/** 递归列出 root 下最近有改动的文件（只读目录，不跟随过深层级） */
export async function listRecentFiles(
  root: string,
  accept: (name: string) => boolean,
  since: number,
  maxDepth = 6
): Promise<{ file: string; size: number; mtimeMs: number }[]> {
  const out: { file: string; size: number; mtimeMs: number }[] = []
  const walk = async (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(p, depth + 1)
      } else if (e.isFile() && accept(e.name)) {
        try {
          const st = await fs.promises.stat(p)
          if (st.mtimeMs >= since) out.push({ file: p, size: st.size, mtimeMs: st.mtimeMs })
        } catch {
          /* 刚被删掉 */
        }
      }
    }
  }
  await walk(root, 0)
  return out
}

export const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
