function parts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/, '')
    .split('-')[0]!
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
}

// True when `candidate` (a release tag such as v1.2.0) is a later version than `current`.
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate)
  const b = parts(current)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  }
  return false
}
