// macOS calls it the Bin in Commonwealth English and the Trash elsewhere. Stow uses the same word Finder does.
const BIN_REGIONS = new Set(['GB', 'IE', 'AU', 'NZ', 'IN', 'ZA', 'SG', 'HK', 'MY', 'PK', 'NG', 'KE'])

function binWord(): 'Bin' | 'Trash' {
  try {
    const locale = new Intl.Locale(navigator.language)
    return locale.language === 'en' && BIN_REGIONS.has(locale.region ?? '') ? 'Bin' : 'Trash'
  } catch {
    return 'Trash'
  }
}

export const BIN = binWord()
