import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clipboard, shell } from 'electron'
import type { AssistantTarget } from '../shared/types'

export type { AssistantTarget }

const URL_LIMIT = 6000

const NAMES: Record<Exclude<AssistantTarget, 'copy'>, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex'
}

export async function openAssistant(
  target: AssistantTarget,
  prompt: string
): Promise<{ ok: true; notice: string } | { ok: false; error: string }> {
  if (prompt.length === 0 || prompt.length > 20_000) {
    return { ok: false, error: 'That prompt is empty.' }
  }
  clipboard.writeText(prompt)
  if (target === 'copy') {
    return { ok: true, notice: 'Copied. Paste it into a chat.' }
  }

  const name = NAMES[target]
  const clipped = prompt.length > URL_LIMIT ? null : prompt
  try {
    if (target === 'chatgpt') {
      const app = chatGPTApp()
      if (!app) return { ok: false, error: `${name} is not installed. The prompt is on the clipboard.` }
      await openUrl('chatgpt://new-conversation')
      return { ok: true, notice: `Opened ${name}. Paste the prompt into the new chat. It is on the clipboard.` }
    }
    if (target === 'claude') {
      if (!findApp(['Claude'])) return { ok: false, error: `${name} is not installed. The prompt is on the clipboard.` }
      if (clipped) await openUrl(`claude://claude.ai/new?q=${encodeURIComponent(clipped)}&surface=chat&source=desktop_action`)
      else await openApp(findApp(['Claude']) as string)
    } else if (target === 'cursor') {
      const app = findApp(['Cursor'])
      if (!app) return { ok: false, error: `${name} is not installed. The prompt is on the clipboard.` }
      if (clipped) await openUrl(`cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(clipped)}`)
      else await openApp(app)
    } else {
      const app = codexApp()
      if (!app) return { ok: false, error: `${name} is not installed. The prompt is on the clipboard.` }
      if (clipped) await openUrl(`codex://threads/new?prompt=${encodeURIComponent(clipped)}`)
      else await openApp(app)
    }
  } catch {
    return { ok: false, error: `Could not open ${name}. The prompt is on the clipboard.` }
  }

  if (!clipped) {
    return { ok: true, notice: `Opened ${name}. The full prompt is on the clipboard. Paste it into the chat.` }
  }
  return { ok: true, notice: `Opened ${name}. The prompt is in the new chat, and also on the clipboard.` }
}

function chatGPTApp(): string | null {
  return findApp(['ChatGPT Classic']) ?? appWithBundleId(['ChatGPT'], 'com.openai.chat')
}

function codexApp(): string | null {
  return findApp(['Codex']) ?? appWithBundleId(['ChatGPT', 'Codex'], 'com.openai.codex')
}

function findApp(names: string[]): string | null {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
  for (const root of roots) {
    for (const name of names) {
      const full = path.join(root, `${name}.app`)
      if (fs.existsSync(full)) return full
    }
  }
  return null
}

function appWithBundleId(names: string[], bundleId: string): string | null {
  for (const name of names) {
    const full = findApp([name])
    if (full && readBundleId(full) === bundleId) return full
  }
  return null
}

function readBundleId(appPath: string): string | null {
  try {
    return execFileSync('defaults', ['read', path.join(appPath, 'Contents/Info'), 'CFBundleIdentifier'], {
      encoding: 'utf8'
    }).trim()
  } catch {
    return null
  }
}

function openUrl(url: string): Promise<void> {
  return shell.openExternal(url)
}

function openApp(appPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', appPath], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
