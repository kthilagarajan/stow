// Copy what the site shows from the app's repository, so the icon and screenshots
// on the web are always the ones in the code.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(site, '..')
const copies = [
  ['build/icon.png', 'public/icon.png'],
  ['docs/screenshots/overview-light.png', 'public/screenshots/overview-light.png'],
  ['docs/screenshots/overview-dark.png', 'public/screenshots/overview-dark.png'],
  ['docs/screenshots/folder-dark.png', 'public/screenshots/folder-dark.png'],
  ['docs/screenshots/multi-select-light.png', 'public/screenshots/multi-select-light.png']
]
for (const [from, to] of copies) {
  mkdirSync(dirname(join(site, to)), { recursive: true })
  copyFileSync(join(repo, from), join(site, to))
}
