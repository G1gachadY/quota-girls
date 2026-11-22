import type { QuotaAPI } from '../../main/providers/types'
import { createMockApi } from './mock'

/** Electron 里由 preload 注入；在普通浏览器里预览（npm run dev 的 renderer 地址）时用假数据 */
export const isMock = typeof window !== 'undefined' && !window.quota
export const api: QuotaAPI = window.quota ?? createMockApi()
