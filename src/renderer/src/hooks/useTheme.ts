import { useState } from 'react'
import type { ThemeChoice } from '@shared/types'
import { applyTheme, NEXT_THEME, storedTheme } from '@/lib/theme'

export function useTheme(): { theme: ThemeChoice; cycle: () => void } {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme)
  function cycle(): void {
    const next = NEXT_THEME[theme]
    setTheme(next)
    applyTheme(next, true)
  }
  return { theme, cycle }
}
