/**
 * 插画目录扫描（纯 Node，不依赖 Electron）。
 * main 进程的 art:// 协议和浏览器预览（vite 开发服务器的 /__art/）共用这一份逻辑。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_MANIFESTS, PLATFORM_IDS } from '../shared/quota'
import type { ArtFiles, ArtManifest, ArtState, PlatformId } from './providers/types'

/** 槽位 → 文件名（不含扩展名） */
export const ART_SLOTS: Record<keyof ArtFiles, string> = {
  card: 'card',
  hero: 'hero',
  avatar: 'avatar',
  cardLow: 'card-low',
  cardEmpty: 'card-empty',
  heroLow: 'hero-low',
  heroEmpty: 'hero-empty'
}

/** 同一目录里有多种格式时的优先级 */
export const ART_EXTS = ['png', 'webp', 'jpg', 'jpeg']
export const ART_FILE_RE = /^(card|hero|avatar|card-low|card-empty|hero-low|hero-empty)\.(png|jpe?g|webp)$/i
export const ART_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 按目录优先级查找某个具体文件名 */
export function findArtFile(dirs: string[], platform: PlatformId, file: string): string | null {
  for (const dir of dirs) {
    const p = path.join(dir, platform, file)
    if (isFile(p)) return p
  }
  return null
}

/** 查找槽位文件：先按目录（用户覆盖目录优先），同一目录内再按扩展名 */
function findSlot(dirs: string[], platform: PlatformId, base: string): { name: string; file: string } | null {
  for (const dir of dirs) {
    for (const ext of ART_EXTS) {
      const name = `${base}.${ext}`
      const file = path.join(dir, platform, name)
      if (isFile(file)) return { name, file }
    }
  }
  return null
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i
const FOCUS_RE = /^[\d.]+%?\s+[\d.]+%?$|^(center|top|bottom|left|right)(\s+\w+)?$/i

export function readManifest(dirs: string[], platform: PlatformId): ArtManifest {
  const def = DEFAULT_MANIFESTS[platform]
  const file = findArtFile(dirs, platform, 'manifest.json')
  if (!file) return def
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    const val = (k: keyof ArtManifest, re?: RegExp): string | undefined => {
      const v = j?.[k]
      return typeof v === 'string' && v.trim() && (!re || re.test(v.trim())) ? v.trim() : undefined
    }
    return {
      name: (val('name') ?? def.name).slice(0, 24),
      title: (val('title') ?? def.title).slice(0, 40),
      accent: val('accent', COLOR_RE) ?? def.accent,
      accent2: val('accent2', COLOR_RE) ?? def.accent2,
      cardFocus: val('cardFocus', FOCUS_RE) ?? def.cardFocus,
      heroFocus: val('heroFocus', FOCUS_RE) ?? def.heroFocus,
      avatarFocus: val('avatarFocus', FOCUS_RE) ?? def.avatarFocus,
      cardLowFocus: val('cardLowFocus', FOCUS_RE),
      cardEmptyFocus: val('cardEmptyFocus', FOCUS_RE),
      heroLowFocus: val('heroLowFocus', FOCUS_RE),
      heroEmptyFocus: val('heroEmptyFocus', FOCUS_RE)
    }
  } catch {
    return def
  }
}

/** 扫描全部平台的插画；urlOf 决定文件对外的地址（art:// 或 /__art/） */
export function scanArt(dirs: string[], urlOf: (platform: PlatformId, file: string, mtime: number) => string): ArtState {
  const state = {} as ArtState
  for (const p of PLATFORM_IDS) {
    const files: ArtFiles = {}
    for (const [slot, base] of Object.entries(ART_SLOTS) as [keyof ArtFiles, string][]) {
      const hit = findSlot(dirs, p, base)
      if (hit) files[slot] = urlOf(p, hit.name, Math.round(fs.statSync(hit.file).mtimeMs))
    }
    state[p] = { manifest: readManifest(dirs, p), files }
  }
  return state
}
