import type { SegmentTotals } from '@shared/segments'
import { formatBytes } from './format'

export function diskLede(totals: SegmentTotals, done: boolean): string {
  const sentences: string[] = []
  if (totals.clear > 0) sentences.push(`${formatBytes(totals.clear)} can be deleted.`)
  if (totals.optional > 0) sentences.push(`${formatBytes(totals.optional)} is optional.`)
  if (totals.keep > 0) sentences.push(`${formatBytes(totals.keep)} is not mandatory.`)
  if (totals.mandatory > 0) sentences.push(`${formatBytes(totals.mandatory)} is mandatory.`)
  if (totals.other > 0) {
    sentences.push(
      done
        ? `${formatBytes(totals.other)} is not sorted. That is mostly macOS, plus folders this scan does not open.`
        : `${formatBytes(totals.other)} is still being sorted.`
    )
  }
  if (sentences.length === 0) return done ? 'Nothing measured on this disk yet.' : 'Reading the disk.'
  return sentences.join(' ')
}
