import path from 'node:path'
import type { Verdict } from '../shared/types'

export interface ClassifiedFile {
  verdict: Verdict
  trashable: boolean
  summary: string
  detail: string
}

function file(verdict: Verdict, trashable: boolean, summary: string, detail: string): ClassifiedFile {
  return { verdict, trashable, summary, detail }
}

export function classifyLargeFile(filePath: string): ClassifiedFile {
  const base = path.basename(filePath)
  const lower = filePath.toLowerCase()

  if (lower.includes('/library/keychains/') || lower.includes('/library/preferences/')) {
    return file('mandatory', false, 'Account data. Leave it in place.', 'Passwords or settings. Stow will not move this file.')
  }
  if (lower.includes('.photoslibrary') || lower.includes('/pictures/')) {
    return file('keep', false, 'Part of your photos.', 'This file is already counted with Pictures. Stow will not move it.')
  }
  if (
    lower.includes('/documents/') ||
    lower.includes('/desktop/') ||
    lower.includes('/movies/') ||
    lower.includes('/music/') ||
    lower.includes('/library/mail/') ||
    lower.includes('/library/messages/') ||
    lower.includes('/library/mobile documents/')
  ) {
    return file('keep', false, 'Your file. The Mac does not need it, and Stow will not move it.', `Already counted inside its folder. ${base}`)
  }
  if (lower.includes('/library/caches/') || lower.includes('/.npm/') || lower.includes('/deriveddata/') || lower.includes('/.trash/')) {
    return file('clear', true, 'A large cache, build leftover, or file already in the Trash.', 'Clearing it frees space inside the folder that holds it. Apps recreate caches.')
  }
  if (lower.endsWith('.dmg') || lower.endsWith('.pkg') || lower.endsWith('.iso')) {
    return file('optional', true, 'A large installer. If the app is already installed, this is usually safe to clear.', 'Already counted inside its folder.')
  }
  if (lower.includes('/node_modules/')) {
    return file('optional', true, 'A large installed dependency. The project stays. Install again if you need it.', 'Already counted inside its project.')
  }
  if (lower.includes('/library/developer/coresimulator/') || lower.includes('devicesupport')) {
    return file('optional', true, 'Simulator or device-support data. Xcode can download or create it again.', 'Anything that exists only inside a simulator goes with it.')
  }
  if (lower.includes('/library/android/') || lower.includes('/sdk/system-images/')) {
    return file('optional', true, 'An Android emulator image or SDK file. Android Studio can download it again.', 'Stow will not remove the whole Android toolchain from here.')
  }
  if (lower.includes('/applications/') || lower.endsWith('.app')) {
    return file('keep', false, 'Part of an installed app. Stow will not uninstall it.', 'Already counted with Applications.')
  }
  if (lower.includes('/downloads/')) {
    return file('optional', true, 'A large download. Keep it if you still need the file.', 'Already counted inside Downloads.')
  }
  return file('optional', true, 'A large file outside the usual folders. Open it before you decide.', 'Already counted inside whatever folder holds it.')
}

const PERSONAL = [
  '/documents/',
  '/desktop/',
  '/pictures/',
  '/movies/',
  '/music/',
  '/library/mail/',
  '/library/messages/',
  '/library/mobile documents/'
]

function cacheKind(name: string): 'clear' | 'optional' | null {
  const normalized = name.toLowerCase()
  if (normalized.includes('extension')) return 'optional'
  if (
    normalized === 'cache' ||
    normalized === 'caches' ||
    normalized === 'cacheddata' ||
    normalized === 'gpucache' ||
    normalized === 'code cache' ||
    normalized === 'cachestorage' ||
    normalized === 'blob_storage' ||
    normalized === 'logs' ||
    normalized === 'crashpad' ||
    normalized.endsWith(' cache') ||
    normalized.includes('gpucache') ||
    normalized.startsWith('dawn')
  ) {
    return 'clear'
  }
  return null
}

export function classifyEntry(
  name: string,
  fullPath: string,
  parent: { verdict: Verdict; trashable: boolean }
): { verdict: Verdict; trashable: boolean; summary: string } {
  const lowerPath = fullPath.toLowerCase()
  const lowerName = name.toLowerCase()

  if (lowerPath.includes('.photoslibrary') || lowerName.endsWith('.app') || lowerPath.includes('.app/')) {
    return { verdict: 'keep', trashable: false, summary: 'Part of an app or a photo library. Stow will not move it.' }
  }
  if (lowerPath.includes('/.cargo/') && (lowerName === 'registry' || lowerName === 'git')) {
    return { verdict: 'optional', trashable: true, summary: 'Downloaded Rust crates. The next build fetches them again.' }
  }

  const cache = cacheKind(name)
  if (cache === 'clear') {
    return { verdict: 'clear', trashable: true, summary: 'A cache. The app rebuilds it. Your documents stay.' }
  }
  if (cache === 'optional') {
    return { verdict: 'optional', trashable: true, summary: 'Cached app pieces. They download again if the app still wants them.' }
  }
  if (lowerName === 'node_modules') {
    return { verdict: 'optional', trashable: true, summary: 'Installed dependencies. The project stays. Install again if you need them.' }
  }
  if (lowerName.endsWith('.dmg') || lowerName.endsWith('.pkg') || lowerName.endsWith('.iso')) {
    return {
      verdict: 'optional',
      trashable: true,
      summary: 'An installer. If the app is already installed, this is usually safe to clear.'
    }
  }
  if (parent.verdict === 'mandatory') {
    return { verdict: 'mandatory', trashable: false, summary: 'The account needs this. Stow will not move it.' }
  }
  if (PERSONAL.some((fragment) => lowerPath.includes(fragment))) {
    return { verdict: 'keep', trashable: false, summary: 'Your files. Stow will not move them.' }
  }
  if (parent.verdict === 'clear') {
    return {
      verdict: 'clear',
      trashable: parent.trashable,
      summary: 'Inside a folder that is safe to clear. The app can rebuild it.'
    }
  }
  if (lowerPath.includes('/library/application support/') || lowerPath.includes('/library/containers/')) {
    return {
      verdict: 'optional',
      trashable: true,
      summary: 'Data this app stored. Moving it can make the app forget this part. The app stays installed.'
    }
  }
  if (parent.verdict === 'optional') {
    return {
      verdict: 'optional',
      trashable: parent.trashable,
      summary: 'Inside an optional folder. Look at it before you move it.'
    }
  }
  return { verdict: 'keep', trashable: false, summary: 'Stow will not move this. Reveal it in Finder if you want to decide there.' }
}
