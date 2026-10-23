import { spawn } from 'node:child_process'
import type { VolumeInfo } from '../shared/types'

interface DiskutilInfo {
  VolumeName?: string
  APFSContainerSize?: number
  APFSContainerFree?: number
}

function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `${command} failed`))
    })
    if (input) child.stdin.write(input)
    child.stdin.end()
  })
}

async function diskutil(mount: string): Promise<DiskutilInfo> {
  const xml = await run('diskutil', ['info', '-plist', mount])
  const json = await run('plutil', ['-convert', 'json', '-o', '-', '-'], xml)
  return JSON.parse(json) as DiskutilInfo
}

function displayName(name: string | undefined): string {
  const cleaned = (name ?? 'Macintosh HD').replace(/ - Data$/, '').trim()
  return cleaned || 'Macintosh HD'
}

async function fromDf(): Promise<VolumeInfo> {
  const text = await run('df', ['-k', '/System/Volumes/Data'])
  const line = text.trim().split('\n').at(-1) ?? ''
  const parts = line.split(/\s+/)
  const total = Number(parts[1] ?? 0) * 1024
  const used = Number(parts[2] ?? 0) * 1024
  const free = Number(parts[3] ?? 0) * 1024
  return {
    name: 'Macintosh HD',
    totalBytes: total,
    usedBytes: used,
    freeBytes: free
  }
}

export async function readVolume(): Promise<VolumeInfo> {
  if (process.platform !== 'darwin') {
    throw new Error('Stow reads disks on macOS.')
  }

  try {
    const [boot, data] = await Promise.all([diskutil('/'), diskutil('/System/Volumes/Data')])
    const totalBytes = data.APFSContainerSize || boot.APFSContainerSize || 0
    const freeBytes = data.APFSContainerFree || boot.APFSContainerFree || 0
    if (totalBytes <= 0) return fromDf()
    return {
      name: displayName(boot.VolumeName || data.VolumeName),
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes)
    }
  } catch {
    return fromDf()
  }
}
