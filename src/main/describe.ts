const KNOWN_CACHES: Record<string, string> = {
  Google: 'Chrome and other Google caches. They come back as you browse. Bookmarks are not in here.',
  Homebrew: 'Old Homebrew downloads. The next install fetches what it needs. Installed tools stay.',
  pip: 'Python package downloads. pip fetches them again when a project asks.',
  Yarn: 'Yarn’s package cache. Your projects keep their own files.',
  'com.apple.Safari': 'Safari’s cache. History and bookmarks live elsewhere.',
  'com.apple.Music': 'Apple Music’s cache. Your library is in the Music folder.',
  'com.spotify.client': 'Spotify’s cache. Playlists stay. Songs may stream again.',
  'com.tinyspeck.slackmacgap': 'Slack’s cache. Your messages stay.',
  Cursor: 'Cursor’s cache. Projects and settings stay.',
  typescript: 'TypeScript’s cache. The next compile rebuilds it.',
  'node-gyp': 'Native-module build cache. The next rebuild recreates it.',
  'com.apple.dt.Xcode': 'Xcode’s cache. The next build recreates it.'
}

function downloadCopy(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.dmg') || lower.endsWith('.pkg') || lower.endsWith('.iso')) {
    return 'An installer. If the app is already installed, this is usually safe to clear.'
  }
  if (lower.endsWith('.zip') || lower.endsWith('.gz') || lower.endsWith('.tar') || lower.endsWith('.tgz')) {
    return 'An archive. Keep it if you have not unpacked it somewhere you still use.'
  }
  return 'A download. Keep it if you have not filed it somewhere else.'
}

export function describeChild(specId: string, name: string): string {
  if (name.endsWith('.photoslibrary')) {
    return 'Your photo library. The Mac starts without it, and Stow will not move it.'
  }
  if (specId === 'caches') {
    return (
      KNOWN_CACHES[name] ??
      (name.startsWith('com.apple.')
        ? `Apple cache for ${name.slice('com.apple.'.length)}. The app rebuilds it.`
        : 'An app cache. The app rebuilds it if it still needs it. Documents are not stored here.')
    )
  }
  if (specId === 'logs') {
    if (name === 'DiagnosticReports') return 'Crash reports. Useful only while you are chasing a bug.'
    return 'Log files. Safe to clear unless you are diagnosing a problem right now.'
  }
  if (specId === 'downloads') return downloadCopy(name)
  if (specId === 'trash') return 'Already in the Trash. Empty Trash on the left when you are sure. That step is permanent.'
  if (specId === 'applications' || specId === 'user-apps') {
    return 'An installed app. Stow will not uninstall it. Move it to the Trash from Finder if you no longer use it.'
  }
  if (specId === 'app-support') {
    return `Files ${name} stored. Open it to see each folder, then decide what can go.`
  }
  if (specId === 'pictures') return 'Something in Pictures. Stow will not move your photos.'
  if (specId === 'documents' || specId === 'desktop' || specId === 'movies' || specId === 'music') {
    return 'Your files. The Mac does not need them, and Stow will not move them.'
  }
  if (specId === 'cargo') {
    if (name === 'registry' || name === 'git') return 'Downloaded Rust crates. The next build fetches them again. The cargo command stays.'
    return 'Part of the Rust toolchain. Stow leaves it in place.'
  }
  if (specId.startsWith('xcode:')) {
    const lower = name.toLowerCase()
    if (lower.includes('devicesupport')) return 'Symbols for one device. Xcode downloads them again when you connect it.'
    if (name.endsWith('.xcarchive')) return 'One archived build. Keep it if you still need to upload that version.'
    return 'A folder inside this Xcode support directory.'
  }
  if (specId === 'simulators') return 'One simulator device. You can add it again from Xcode. Data saved only inside it goes too.'
  if (specId === 'node-modules') return 'Dependencies for this project. The project stays. Install again when you need them.'
  return 'A folder inside this one.'
}
