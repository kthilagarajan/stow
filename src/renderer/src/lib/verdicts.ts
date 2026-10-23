import type { Verdict } from '@shared/types'

export type ShelfId = 'everything' | 'large' | Verdict

export interface VerdictStyle {
  label: string
  bin: string
  ink: string
  instruction: string
  badge: string
}

export const verdicts: Record<Verdict, VerdictStyle> = {
  clear: {
    label: 'Safe to delete',
    bin: '#C83B32',
    ink: '#F8FBFE',
    instruction: 'Caches, logs, and build leftovers. Apps rebuild them. They go to the Trash, and you can put them back.',
    badge: 'border-transparent bg-coral/15 text-coral'
  },
  optional: {
    label: 'Optional',
    bin: '#E8A317',
    ink: '#1A1406',
    instruction: 'Useful, and often replaceable. Open a row before you clear it.',
    badge: 'border-transparent bg-amber/25 text-amber-ink'
  },
  keep: {
    label: 'Not mandatory',
    bin: '#0E6B58',
    ink: '#F8FBFE',
    instruction: 'The Mac runs without these. They are your files and your apps, so Stow leaves them where they are.',
    badge: 'border-transparent bg-kelp/15 text-kelp'
  },
  mandatory: {
    label: 'Mandatory',
    bin: '#24497A',
    ink: '#F8FBFE',
    instruction: 'The account needs these. Nothing in this shelf can be moved to the Trash.',
    badge: 'border-transparent bg-harbor/12 text-harbor'
  }
}

export const verdictOrder: Verdict[] = ['clear', 'optional', 'keep', 'mandatory']

export interface Shelf {
  id: ShelfId
  label: string
  instruction: string
  color: string
}

export const shelves: Shelf[] = [
  {
    id: 'everything',
    label: 'Everything',
    instruction: 'Sorted by what you can do with them, largest first in each group.',
    color: '#24497A'
  },
  {
    id: 'clear',
    label: verdicts.clear.label,
    instruction: verdicts.clear.instruction,
    color: verdicts.clear.bin
  },
  {
    id: 'optional',
    label: verdicts.optional.label,
    instruction: verdicts.optional.instruction,
    color: verdicts.optional.bin
  },
  {
    id: 'keep',
    label: verdicts.keep.label,
    instruction: verdicts.keep.instruction,
    color: verdicts.keep.bin
  },
  {
    id: 'mandatory',
    label: verdicts.mandatory.label,
    instruction: verdicts.mandatory.instruction,
    color: verdicts.mandatory.bin
  },
  {
    id: 'large',
    label: 'Large files',
    instruction: 'Files over 500 MB. They already sit inside the folders above, so this shelf does not add to the wall.',
    color: '#152033'
  }
]
