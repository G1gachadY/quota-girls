// 生成应用图标与托盘图标（纯 Node，无依赖）：深色圆角底 + 三段弧形"体力环"（三平台强调色）
// 用法：npm run icons
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const ARCS = [hex('#D97757'), hex('#10A37F'), hex('#4285F4')]
const CREAM = hex('#F3E6D3')

/** 返回某个像素点（单位坐标 0..1）的 RGBA */
function shade(x, y, opts) {
  const { bg = true } = opts
  // 圆角矩形底
  const r = 0.22
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  const inBg = dx * dx + dy * dy <= r * r
  let col = null
  if (bg && inBg) {
    const t = y
    col = [21 + (11 - 21) * t, 25 + (13 - 25) * t, 37 + (18 - 37) * t, 255]
  }
  const cx = x - 0.5
  const cy = y - 0.5
  const d = Math.hypot(cx, cy)
  const R = bg ? 0.3 : 0.38
  const T = bg ? 0.095 : 0.13
  if (Math.abs(d - R) <= T / 2) {
    // 角度：从顶部顺时针
    let a = (Math.atan2(cy, cx) * 180) / Math.PI + 90
    if (a < 0) a += 360
    const seg = Math.floor(a / 120)
    const within = a - seg * 120
    if (within > 7 && within < 113) col = [...ARCS[seg], 255]
  }
  if (d <= (bg ? 0.075 : 0.1)) col = [...CREAM, 255]
  return col ?? [0, 0, 0, 0]
}

function render(size, opts = {}) {
  const ss = 4
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts)
          const al = c[3] / 255
          r += c[0] * al
          g += c[1] * al
          b += c[2] * al
          a += al
        }
      }
      const n = ss * ss
      const i = (py * size + px) * 4
      buf[i] = a ? Math.round(r / a) : 0
      buf[i + 1] = a ? Math.round(g / a) : 0
      buf[i + 2] = a ? Math.round(b / a) : 0
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return encodePng(size, size, buf)
}

const out = (rel, data) => {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
  console.log('wrote', rel)
}

out('build/icon.png', render(512))
out('resources/icon.png', render(256))
// 托盘：无底板，环更粗，16px 下也清楚
out('resources/tray.png', render(16, { bg: false }))
out('resources/tray@1.5x.png', render(24, { bg: false }))
out('resources/tray@2x.png', render(32, { bg: false }))
