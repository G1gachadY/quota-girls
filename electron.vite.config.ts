import fs from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { ART_FILE_RE, ART_MIME, findArtFile, scanArt } from './src/main/art-scan'
import type { PlatformId } from './src/main/providers/types'
import { PLATFORM_IDS } from './src/shared/quota'

/**
 * 浏览器预览（没有 Electron、没有 art:// 协议）时，开发服务器在 /__art/ 下提供项目 art/ 里的插画：
 *   /__art/state.json            与 art:// 版本同结构的 ArtState
 *   /__art/<platform>/<file>     插画文件（只放行插画槽位文件名）
 * 仅 `npm run dev` 生效，不进入打包产物。
 */
function devArt(): Plugin {
  const dirs = [resolve(__dirname, 'art')]
  return {
    name: 'quota-girls:dev-art',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__art', (req, res, next) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
        if (pathname === '/state.json') {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(scanArt(dirs, (p, file, v) => `/__art/${p}/${file}?v=${v}`)))
          return
        }
        const [platform, file] = pathname.split('/').filter(Boolean)
        const found =
          PLATFORM_IDS.includes(platform as PlatformId) && file && ART_FILE_RE.test(file)
            ? findArtFile(dirs, platform as PlatformId, file)
            : null
        if (!found) return next()
        res.setHeader('content-type', ART_MIME[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('cache-control', 'no-cache')
        fs.createReadStream(found).pipe(res)
      })
    }
  }
}

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // `npm run probe` 用同一套 main 进程代码（系统代理、Chromium 网络栈）探测三个平台
          probe: resolve(__dirname, 'scripts/probe.ts')
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    plugins: [react(), devArt()]
  }
})
