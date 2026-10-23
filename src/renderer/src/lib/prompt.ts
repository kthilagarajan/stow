import type { Verdict } from '@shared/types'
import { formatBytes } from '@/lib/format'
import { verdicts } from '@/lib/verdicts'

export interface PromptEntry {
  name: string
  bytes: number
  verdict: Verdict
  summary: string
}

export interface PromptSubject {
  title: string
  path: string
  bytes: number
  verdict: Verdict
  summary: string
  detail?: string
  entries?: PromptEntry[]
}

export function deletionPrompt(subject: PromptSubject): string {
  const lines = [
    'I am deciding whether to delete something on my Mac to free space. Stow measured it and labeled it. Please say if it is safe to delete, what I would lose, and what would come back.',
    '',
    `Name: ${subject.title}`,
    `Path: ${subject.path || 'Several folders'}`,
    `Size: ${formatBytes(subject.bytes)}`,
    `Stow label: ${verdicts[subject.verdict].label}`,
    `Stow note: ${subject.summary}`
  ]
  if (subject.detail && subject.detail !== subject.summary) {
    lines.push(`More from Stow: ${subject.detail}`)
  }
  const entries = subject.entries?.slice(0, 12) ?? []
  if (entries.length > 0) {
    lines.push('', 'Largest items inside:')
    for (const entry of entries) {
      lines.push(`- ${entry.name} — ${formatBytes(entry.bytes)} — ${verdicts[entry.verdict].label}. ${entry.summary}`)
    }
  }
  lines.push(
    '',
    'Please answer:',
    '1. Is it safe to move this to the Trash?',
    '2. What would I lose, and would an app forget something?',
    '3. What inside it is safe to delete, and what should stay?',
    '4. If you are not sure, say what I should check first.',
    '',
    'Do not give me commands that delete files. I will delete from Stow or Finder myself.'
  )
  return lines.join('\n')
}
