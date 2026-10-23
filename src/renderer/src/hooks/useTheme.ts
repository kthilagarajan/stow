import { useEffect, useState } from 'react'
import type { ThemeChoice } from '@shared/types'
import { applyTheme, effectiveAppearance, NEXT_THEME, storedTheme } from '@/lib/theme'

// The appearance icons follow: the in-app choice, or macOS when the choice is Match macOS.
export function useAppearance(): 'light' | 'dark' {
  const [appearance, setAppearance] = useState(effectiveAppearance)
  useEffect(() => {
    const sync = () => setAppearance(effectiveAppearance())
    window.addEventListener('stow-theme', sync)
    return () => window.removeEventListener('stow-theme', sync)
  }, [])
  return appearance
}

export function useTheme(): { theme: ThemeChoice; cycle: () => void } {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme)
  function cycle(): void {
    const next = NEXT_THEME[theme]
    setTheme(next)
    applyTheme(next, true)
  }
  return { theme, cycle }
}
