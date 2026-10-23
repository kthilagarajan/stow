/// <reference types="vite/client" />

import type { StowApi } from '@shared/types'

declare global {
  interface Window {
    stow?: StowApi
  }
}

export {}
