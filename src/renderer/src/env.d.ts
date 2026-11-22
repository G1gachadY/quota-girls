/// <reference types="vite/client" />
import type { QuotaAPI } from '../../main/providers/types'

declare global {
  interface Window {
    quota?: QuotaAPI
  }
}

export {}
