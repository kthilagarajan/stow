import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateDownload, UpdateInfo, UpdateProgress } from '../shared/types'
import { isNewer } from '../shared/version'

// The only network requests Stow makes: reading public release information from GitHub, and downloading
// a release the person asked for. Nothing about the Mac or its files is sent.

function repository(): string | null {
  if (process.env.STOW_UPDATE_REPO) return process.env.STOW_UPDATE_REPO
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
      repository?: string | { url?: string }
    }
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    return url?.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1] ?? null
  } catch {
    return null
  }
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface Release {
  tag_name: string
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

// Prefer the disk image built for this Mac's chip, then one that names no chip.
function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const images = assets.filter((asset) => asset.name.toLowerCase().endsWith('.dmg'))
  // Never offer another chip's build; without a match the dialog links to the release page instead.
  return images.find((asset) => asset.name.includes(process.arch)) ?? images.find((asset) => !/arm64|x64|universal/.test(asset.name))
}

// Release notes are Markdown; the dialog shows them as plain text.
function plainNotes(body: string): string {
  return body
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
    .slice(0, 4000)
}

let latest: UpdateInfo | null = null

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const repo = repository()
  if (!repo) return null
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Stow/${app.getVersion()}` },
      signal: AbortSignal.timeout(10_000)
    })
    // 404 means the repository has no published release yet.
    if (!response.ok) return null
    const release = (await response.json()) as Release
    if (release.draft || release.prerelease || !isNewer(release.tag_name, app.getVersion())) {
      latest = null
      return null
    }
    const asset = pickAsset(release.assets)
    latest = {
      version: release.tag_name.replace(/^v/, ''),
      notes: plainNotes(release.body ?? ''),
      pageUrl: release.html_url,
      asset: asset ? { name: asset.name, url: asset.browser_download_url, bytes: asset.size } : null
    }
    return latest
  } catch {
    return null
  }
}

export async function downloadUpdate(onProgress: (progress: UpdateProgress) => void): Promise<UpdateDownload> {
  const repo = repository()
  const asset = latest?.asset
  if (!repo || !latest || !asset) return { ok: false, error: 'There is no update to download.' }
  // Only ever download this repository's own release files.
  if (!asset.url.startsWith(`https://github.com/${repo}/releases/download/`)) {
    return { ok: false, error: 'That download is not from Stow’s releases.' }
  }
  const file = path.join(app.getPath('downloads'), path.basename(asset.name))
  const partial = `${file}.download`
  try {
    const response = await fetch(asset.url, { headers: { 'User-Agent': `Stow/${app.getVersion()}` } })
    if (!response.ok || !response.body) return { ok: false, error: 'GitHub did not send the update. Try again later.' }
    const total = Number(response.headers.get('content-length')) || asset.bytes
    let received = 0
    let reported = 0
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      const now = Date.now()
      if (now - reported > 120) {
        reported = now
        onProgress({ received, total })
      }
    })
    await pipeline(body, fs.createWriteStream(partial))
    if (asset.bytes > 0 && received !== asset.bytes) {
      fs.rmSync(partial, { force: true })
      return { ok: false, error: 'The download was incomplete. Try again.' }
    }
    fs.renameSync(partial, file)
    onProgress({ received: total, total })
    return { ok: true, file }
  } catch {
    fs.rmSync(partial, { force: true })
    return { ok: false, error: 'The download stopped. Check the connection and try again.' }
  }
}

export async function openReleasePage(): Promise<void> {
  const repo = repository()
  if (!repo || !latest || !latest.pageUrl.startsWith(`https://github.com/${repo}/releases/`)) return
  await shell.openExternal(latest.pageUrl)
}

// Opens the downloaded disk image so Finder mounts it and shows Stow ready to drag into Applications.
export async function openDownloaded(file: string): Promise<void> {
  const downloads = app.getPath('downloads')
  if (path.dirname(file) !== downloads || !file.endsWith('.dmg') || !fs.existsSync(file)) return
  await shell.openPath(file)
}
