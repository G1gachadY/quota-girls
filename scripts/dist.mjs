// 打包 Windows NSIS 安装包。默认使用 npmmirror 镜像下载 Electron 与 NSIS 等构建工具（可用环境变量覆盖）。
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ?? 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  // 没有代码签名证书：跳过自动查找证书
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
}
const cli = require.resolve('electron-builder/cli.js')
const r = spawnSync(process.execPath, [cli, '--win', 'nsis', '--x64', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
})
process.exit(r.status ?? 1)
