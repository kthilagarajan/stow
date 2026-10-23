import type { ThemeChoice } from '@shared/types'

const KEY = 'stow.theme'

export const THEME_LABEL: Record<ThemeChoice, string> = { system: 'Match macOS', light: 'Light', dark: 'Dark' }
export const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' }
const dark = window.matchMedia('(prefers-color-scheme: dark)')

export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function effectiveAppearance(): 'light' | 'dark' {
  const choice = storedTheme()
  return choice === 'dark' || (choice === 'system' && dark.matches) ? 'dark' : 'light'
}

function paint(choice: ThemeChoice): void {
  const isDark = choice === 'dark' || (choice === 'system' && dark.matches)
  document.documentElement.classList.toggle('dark', isDark)
  window.dispatchEvent(new Event('stow-theme'))
}

// Applies a theme to the page and the window frame. `animate` cross-fades colours for a user-initiated switch.
export function applyTheme(choice: ThemeChoice, animate = false): void {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // The choice just won't outlive this window.
  }
  const root = document.documentElement
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-switching')
    window.setTimeout(() => root.classList.remove('theme-switching'), 320)
  }
  paint(choice)
  void window.stow?.setTheme(choice)
}

// Follow macOS when the choice is "system".
dark.addEventListener('change', () => {
  if (storedTheme() === 'system') paint('system')
})
