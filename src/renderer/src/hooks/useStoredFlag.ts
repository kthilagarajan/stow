import { useState } from 'react'

// A yes/no preference kept in this window's storage. It falls back to off when storage is unavailable.
export function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const [flag, setFlag] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  function update(value: boolean): void {
    setFlag(value)
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      // The setting just won't outlive this window.
    }
  }
  return [flag, update]
}

export function useCompact(): [boolean, (value: boolean) => void] {
  return useStoredFlag('stow.compact')
}
