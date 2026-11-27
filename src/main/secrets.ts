/**
 * 用户在设置里填的 API Key：用 Electron safeStorage（Windows DPAPI，绑定当前 Windows 账户）加密后存到
 * %APPDATA%\QuotaGirls\secrets.json。只有 main 进程读写，renderer 只知道"有没有"。
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

type SecretFile = Record<string, string>

function file(): string {
  return path.join(app.getPath('userData'), 'secrets.json')
}

function load(): SecretFile {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return j && typeof j === 'object' ? (j as SecretFile) : {}
  } catch {
    return {}
  }
}

function save(data: SecretFile): void {
  const f = file()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = f + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, f)
}

export function secretsAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function getSecret(id: string): string | null {
  const enc = load()[id]
  if (!enc || !secretsAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function hasSecret(id: string): boolean {
  return !!load()[id]
}

/** value 为 null 时删除 */
export function setSecret(id: string, value: string | null): void {
  const data = load()
  if (value == null) {
    if (!(id in data)) return
    delete data[id]
  } else {
    if (!secretsAvailable()) throw new Error('本机不支持加密存储，无法保存 Key')
    data[id] = safeStorage.encryptString(value).toString('base64')
  }
  save(data)
}
