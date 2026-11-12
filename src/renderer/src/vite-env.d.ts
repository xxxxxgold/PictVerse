/// <reference types="vite/client" />

import type { PictVerseAPI } from '@shared/types'

declare global {
  interface Window {
    pictverse: PictVerseAPI
  }
}
