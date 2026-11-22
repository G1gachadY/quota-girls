/**
 * art:// 协议：读取角色插画与 manifest。
 *   art://img/<platform>/<file>?v=<mtime>
 * 查找顺序：
 *   开发时   项目根目录 art/
 *   打包后   %APPDATA%/QuotaGirls/art/（用户覆盖，逐文件优先） → 安装包内置 resources/art/
 * 换图后无需重启：设置页"重新载入插画"，或直接保存文件（文件夹被监听，自动刷新）。
 */
import { app, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { PLATFORM_IDS } from '../shared/quota'
import { ART_FILE_RE, ART_MIME, findArtFile, scanArt } from './art-scan'
import type { ArtState, PlatformId } from './providers/types'

export const ART_SCHEME = 'art'

/** 必须在 app ready 之前调用 */
export function registerArtScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ART_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

export function userArtDir(): string {
  return path.join(app.getPath('userData'), 'art')
}

function bundledArtDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'art') : path.join(app.getAppPath(), 'art')
}

/** 优先级从高到低 */
export function artDirs(): string[] {
  return app.isPackaged ? [userArtDir(), bundledArtDir()] : [bundledArtDir()]
}

/** "打开插画文件夹"：打包后为用户覆盖目录（不存在则创建骨架），开发时为项目 art/ */
export function ensureEditableArtDir(): string {
  const dir = app.isPackaged ? userArtDir() : bundledArtDir()
  for (const p of PLATFORM_IDS) fs.mkdirSync(path.join(dir, p), { recursive: true })
  const readme = path.join(dir, '说明.txt')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        '额度娘 Quota Girls · 插画文件夹',
        '',
        '每个平台一个子目录：claude / codex / antigravity',
        '  card.png        1024×1536（2:3 竖版） 总览页角色卡',
        '  hero.png        1536×1024（3:2 横版） 详情页全屏背景',
        '  avatar.png      1024×1024（可选）     迷你挂件头像（缺省时从 card 裁脸）',
        '  card-low.png   / hero-low.png    （可选）体力紧张（剩余 <20%）差分',
        '  card-empty.png / hero-empty.png  （可选）体力耗尽差分',
        '  manifest.json   角色名、称号、强调色、构图焦点（object-position）',
        '',
        '格式：png / webp / jpg 均可。差分只画一种方向也行：',
        '  竖版差分会在详情页靠右整幅显示（两侧用同图虚化铺满），横版差分会按焦点裁进角色卡。',
        '  没有差分时，原图加滤镜（紧张偏暖暗、耗尽变灰）。',
        '',
        '这里的文件优先于安装包内置的插画；缺失的文件自动回退到内置版本。',
        '保存后自动生效；按 F2 显示安全区参考线检查构图。',
        ''
      ].join('\r\n'),
      'utf8'
    )
  }
  return dir
}

export function getArtState(): ArtState {
  return scanArt(artDirs(), (p, file, v) => `${ART_SCHEME}://img/${p}/${file}?v=${v}`)
}

/** app ready 之后调用 */
export function registerArtProtocol(): void {
  protocol.handle(ART_SCHEME, async (req) => {
    try {
      const u = new URL(req.url)
      const [platform, file] = decodeURIComponent(u.pathname).split('/').filter(Boolean)
      if (!PLATFORM_IDS.includes(platform as PlatformId) || !file || !ART_FILE_RE.test(file)) {
        return new Response('not found', { status: 404 })
      }
      const f = findArtFile(artDirs(), platform as PlatformId, file)
      if (!f) return new Response('not found', { status: 404 })
      const data = await fs.promises.readFile(f)
      const ext = file.split('.').pop()!.toLowerCase()
      return new Response(data, {
        status: 200,
        headers: { 'content-type': ART_MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' }
      })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

/** 监听插画目录，变更后回调（防抖） */
export function watchArt(onChange: () => void): () => void {
  const watchers: fs.FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  const fire = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 600)
  }
  for (const dir of artDirs()) {
    try {
      if (fs.existsSync(dir)) watchers.push(fs.watch(dir, { recursive: true }, fire))
    } catch {
      /* 某些文件系统不支持 recursive，忽略 */
    }
  }
  return () => watchers.forEach((w) => w.close())
}
