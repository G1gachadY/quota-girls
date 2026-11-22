/**
 * preload（sandbox）：通过 contextBridge 暴露 window.quota。
 * renderer 只能拿到脱敏后的快照，拿不到任何 token / cookie。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { QuotaAPI } from '../main/providers/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: QuotaAPI = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => subscribe('state:update', cb),
  refresh: (platform) => ipcRenderer.invoke('quota:refresh', platform),
  getHistory: (platform) => ipcRenderer.invoke('history:get', platform),
  getRaw: (platform) => ipcRenderer.invoke('raw:get', platform),
  getValue: (platform) => ipcRenderer.invoke('value:get', platform),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  getArt: () => ipcRenderer.invoke('art:get'),
  onArt: (cb) => subscribe('art:changed', cb),
  reloadArt: () => ipcRenderer.invoke('art:reload'),
  openArtFolder: () => ipcRenderer.invoke('art:open-folder'),

  claudeLogin: () => ipcRenderer.invoke('claude:login'),
  claudeSetSessionKey: (key) => ipcRenderer.invoke('claude:set-session-key', key),
  claudeLogout: () => ipcRenderer.invoke('claude:logout'),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximized: (cb) => subscribe('win:maximized', cb)
  },
  mini: {
    toggle: () => ipcRenderer.send('mini:toggle'),
    showMain: () => ipcRenderer.send('mini:show-main'),
    dragTo: (x, y) => ipcRenderer.send('mini:drag-to', x, y),
    close: () => ipcRenderer.send('mini:close')
  }
}

contextBridge.exposeInMainWorld('quota', api)
