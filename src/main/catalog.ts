import fs from 'node:fs/promises'
import path from 'node:path'
import type { Verdict } from '../shared/types'

export interface RootSpec {
  id: string
  title: string
  path: string
  verdict: Verdict
  group: string
  summary: string
  detail: string
  expand: boolean
  trashable: boolean
  liftFromParent: boolean
  timeoutMs: number
  childTrash?: (name: string) => boolean
}

function root(
  spec: Omit<RootSpec, 'expand' | 'timeoutMs' | 'liftFromParent' | 'trashable'> &
    Partial<Pick<RootSpec, 'expand' | 'timeoutMs' | 'liftFromParent' | 'trashable' | 'childTrash'>>
): RootSpec {
  const trashable = spec.trashable ?? (spec.verdict === 'clear' || spec.verdict === 'optional')
  return {
    expand: false,
    timeoutMs: 45_000,
    liftFromParent: false,
    ...spec,
    trashable
  }
}

function xcodeSpec(dir: string, name: string): RootSpec {
  const lower = name.toLowerCase()
  const full = path.join(dir, name)
  const base = {
    id: `xcode:${name}`,
    title: name,
    path: full,
    group: 'Developer',
    expand: true,
    liftFromParent: false,
    timeoutMs: 75_000
  }

  if (lower === 'deriveddata' || lower.includes('cache') || lower === 'index' || lower.includes('compilation')) {
    return root({
      ...base,
      verdict: 'clear',
      trashable: true,
      summary: 'Build files Xcode recreates. Nothing you wrote lives here.',
      detail:
        'Indexes, logs, and compiled products. Your source stays in the project. The next build takes longer. Moving this to the Trash is the usual fix when a build goes wrong.'
    })
  }
  if (lower.includes('log')) {
    return root({
      ...base,
      verdict: 'clear',
      trashable: true,
      summary: 'Xcode or device logs. Useful only while you are debugging.',
      detail: 'Logs are not your source and not a device backup. Apps and Xcode write them again.'
    })
  }
  if (lower === 'archives') {
    return root({
      ...base,
      verdict: 'optional',
      trashable: true,
      summary: 'Old builds kept for App Store uploads. Keep the latest if you still ship that app.',
      detail:
        'Each archive is one exported build. The source project is elsewhere. You can archive again from the project. You cannot re-upload a build you throw away.'
    })
  }
  if (lower.includes('devicesupport')) {
    return root({
      ...base,
      verdict: 'optional',
      trashable: true,
      summary: 'Debug symbols for devices you have plugged in. Xcode downloads them again next time.',
      detail: 'Folders are named by OS version. They are large and replaceable. They are not a backup of the device.'
    })
  }
  if (lower === 'products') {
    return root({
      ...base,
      verdict: 'optional',
      trashable: true,
      summary: 'Build products Xcode stored beside DerivedData.',
      detail: 'These are compiled outputs. Your source is in the project. The next build can recreate them.'
    })
  }
  if (lower === 'userdata') {
    return root({
      ...base,
      verdict: 'keep',
      trashable: false,
      expand: false,
      summary: 'Xcode window and account state.',
      detail: 'Themes, accounts, and IDE state. The Mac does not need this to start. Stow will not move it.'
    })
  }
  return root({
    ...base,
    verdict: 'optional',
    trashable: false,
    expand: false,
    summary: 'Part of Xcode’s support files. Stow does not treat it as safe to clear.',
    detail: 'It is not required to boot the Mac. Leave it unless you know you can replace it.'
  })
}

function staticRoots(home: string): RootSpec[] {
  const h = (...parts: string[]) => path.join(home, ...parts)
  return [
    root({
      id: 'keychains',
      title: 'Passwords and certificates',
      path: h('Library/Keychains'),
      verdict: 'mandatory',
      group: 'Account',
      summary: 'Saved passwords and certificates. Your account needs these to sign in.',
      detail: 'Keychain holds credentials for this Mac. Stow will not move it.',
      timeoutMs: 20_000
    }),
    root({
      id: 'preferences',
      title: 'Settings',
      path: h('Library/Preferences'),
      verdict: 'mandatory',
      group: 'Account',
      summary: 'Settings apps remember: accounts, windows, and switches.',
      detail: 'Small files. Removing them makes apps forget how you set them up. Stow will not move them.',
      timeoutMs: 30_000
    }),
    root({
      id: 'documents',
      title: 'Documents',
      path: h('Documents'),
      verdict: 'keep',
      group: 'Your files',
      summary: 'Your documents. The Mac runs without them. Stow will not move them.',
      detail: 'Work, exports, and files you saved. They are not mandatory for macOS, and they are not optional clutter.',
      expand: true,
      timeoutMs: 90_000
    }),
    root({
      id: 'desktop',
      title: 'Desktop',
      path: h('Desktop'),
      verdict: 'keep',
      group: 'Your files',
      summary: 'Files sitting on the Desktop. Stow will not move them.',
      detail: 'Often installers and half-finished work. Look in Large files if one of them is huge. Stow will not clear the Desktop for you.',
      expand: true,
      timeoutMs: 60_000
    }),
    root({
      id: 'pictures',
      title: 'Pictures',
      path: h('Pictures'),
      verdict: 'keep',
      group: 'Your files',
      summary: 'Photos and images. The Mac starts without them. Stow will not move them.',
      detail: 'Includes the Photos library when it lives here. That library is your pictures, not a cache.',
      expand: true,
      timeoutMs: 120_000
    }),
    root({
      id: 'movies',
      title: 'Movies',
      path: h('Movies'),
      verdict: 'keep',
      group: 'Your files',
      summary: 'Video on this Mac. Stow will not move it.',
      detail: 'Personal videos and files apps stored here. The system does not need them.',
      expand: true,
      timeoutMs: 120_000
    }),
    root({
      id: 'music',
      title: 'Music',
      path: h('Music'),
      verdict: 'keep',
      group: 'Your files',
      summary: 'Music and the Apple Music library. Stow will not move them.',
      detail: 'The Media library can be large. It is your library, not a cache.',
      expand: true,
      timeoutMs: 120_000
    }),
    root({
      id: 'mail',
      title: 'Mail',
      path: h('Library/Mail'),
      verdict: 'keep',
      group: 'Messages and mail',
      summary: 'Mail stored on this Mac. The system runs without it. Stow will not move it.',
      detail: 'Losing this folder loses mail that is not also on the server. Stow leaves it alone.',
      timeoutMs: 120_000
    }),
    root({
      id: 'messages',
      title: 'Messages',
      path: h('Library/Messages'),
      verdict: 'keep',
      group: 'Messages and mail',
      summary: 'iMessage history and attachments on this Mac.',
      detail: 'The Mac does not need Messages to start. Deleting this deletes local conversations. Stow will not move it.',
      timeoutMs: 90_000
    }),
    root({
      id: 'icloud',
      title: 'iCloud Drive',
      path: h('Library/Mobile Documents'),
      verdict: 'keep',
      group: 'Cloud',
      summary: 'iCloud Drive files cached on this Mac.',
      detail: 'Some of this may also live in iCloud. Stow will not evict or delete it. Sizes can include files that are not fully downloaded.',
      timeoutMs: 90_000
    }),
    root({
      id: 'app-support',
      title: 'App data',
      path: h('Library/Application Support'),
      verdict: 'keep',
      group: 'App data',
      summary: 'Documents and accounts apps stored for you. Stow will not remove this folder.',
      detail:
        'Open an app, such as Cursor, to see each folder inside it. Caches can go to the Trash. Other folders are optional: moving one can make that app forget something, and the app stays installed.',
      expand: true,
      timeoutMs: 120_000
    }),
    root({
      id: 'applications',
      title: 'Applications',
      path: '/Applications',
      verdict: 'keep',
      group: 'Applications',
      summary: 'Apps installed for everyone on this Mac. The system starts without the ones you added.',
      detail: 'Stow will not uninstall an app. If you do not use one, move that app to the Trash from Finder.',
      expand: true,
      timeoutMs: 120_000
    }),
    root({
      id: 'user-apps',
      title: 'Your Applications',
      path: h('Applications'),
      verdict: 'keep',
      group: 'Applications',
      summary: 'Apps installed only for your account.',
      detail: 'The Mac starts without these. Stow will not uninstall them.',
      expand: true,
      timeoutMs: 60_000
    }),
    root({
      id: 'caches',
      title: 'Caches',
      path: h('Library/Caches'),
      verdict: 'clear',
      group: 'Caches',
      summary: 'App caches. They come back when the app needs them.',
      detail: 'Browsers, package managers, and media apps keep temporary copies here. Your documents are not in this folder. Moving it to the Trash is reversible.',
      expand: true,
      timeoutMs: 90_000
    }),
    root({
      id: 'logs',
      title: 'Logs',
      path: h('Library/Logs'),
      verdict: 'clear',
      group: 'Logs',
      summary: 'Diagnostic logs. Keep them only if something is crashing.',
      detail: 'Apps write these again. They are not your documents. Move them to the Trash when you are not chasing a bug.',
      expand: true,
      timeoutMs: 45_000
    }),
    root({
      id: 'trash',
      title: 'Trash',
      path: h('.Trash'),
      verdict: 'clear',
      group: 'Trash',
      summary: 'Already deleted, and still taking space until you empty the Trash.',
      detail: 'Empty Trash on the left permanently deletes everything in the Trash. There is no way back. Stow asks before it does that.',
      expand: true,
      trashable: false,
      timeoutMs: 45_000
    }),
    root({
      id: 'npm',
      title: 'npm cache',
      path: h('.npm'),
      verdict: 'clear',
      group: 'Developer',
      summary: 'Packages npm already downloaded. Your projects stay.',
      detail: 'The next install fetches what it needs. Clearing this does not remove node_modules inside a project.',
      expand: true,
      timeoutMs: 60_000
    }),
    root({
      id: 'downloads',
      title: 'Downloads',
      path: h('Downloads'),
      verdict: 'optional',
      group: 'Downloads',
      summary: 'Files you saved and may not have filed anywhere else.',
      detail: 'Installers are usually safe once the app is installed. Other files may be the only copy. Open a row before you move it.',
      expand: true,
      timeoutMs: 60_000
    }),
    root({
      id: 'ios-backups',
      title: 'iPhone and iPad backups',
      path: h('Library/Application Support/MobileSync/Backup'),
      verdict: 'optional',
      group: 'Backups',
      summary: 'Local device backups. Keep the one you would restore from.',
      detail: 'If iCloud is not holding this device, the Trash becomes the only copy until you put it back. These are not required to boot the Mac.',
      timeoutMs: 90_000
    }),
    root({
      id: 'simulators',
      title: 'iOS Simulators',
      path: h('Library/Developer/CoreSimulator'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'Simulator devices. Xcode can create them again.',
      detail: 'Anything you saved only inside a simulator goes with it. Your app’s source code is not in here.',
      expand: true,
      timeoutMs: 90_000
    }),
    root({
      id: 'docker',
      title: 'Docker',
      path: h('Library/Containers/com.docker.docker'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'Docker’s virtual disk. Local images and containers live here.',
      detail: 'Moving this to the Trash deletes local images and containers. It does not uninstall Docker. Docker recreates an empty disk, not your containers.',
      timeoutMs: 60_000
    }),
    root({
      id: 'colima',
      title: 'Colima',
      path: h('.colima'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'Colima’s Linux virtual machine.',
      detail: 'Moving this deletes that local VM. Colima can create a new one. It will not restore containers you do not have elsewhere.',
      timeoutMs: 45_000
    }),
    root({
      id: 'pnpm',
      title: 'pnpm store',
      path: h('Library/pnpm'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'pnpm’s shared package store. Projects re-link from it.',
      detail: 'Removing it means the next install downloads packages again. Your project folders stay.',
      timeoutMs: 60_000
    }),
    root({
      id: 'pnpm-local',
      title: 'pnpm store',
      path: h('.local/share/pnpm'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'Another pnpm store. Projects re-link from it.',
      detail: 'Removing it means the next install downloads packages again. Your project folders stay.',
      timeoutMs: 45_000
    }),
    root({
      id: 'cargo',
      title: 'Rust toolchain',
      path: h('.cargo'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'The cargo command and downloaded crates.',
      detail: 'Stow will not remove the toolchain. The registry and git checkouts inside can go to the Trash. The next build downloads those crates again.',
      expand: true,
      trashable: false,
      childTrash: (name) => name === 'registry' || name === 'git',
      timeoutMs: 60_000
    }),
    root({
      id: 'go',
      title: 'Go module cache',
      path: h('go/pkg'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'Modules Go already downloaded.',
      detail: 'The next build downloads modules again. Your Go projects stay. This is not the Go application itself if you installed Go elsewhere.',
      timeoutMs: 60_000
    }),
    root({
      id: 'android',
      title: 'Android SDK',
      path: h('Library/Android'),
      verdict: 'optional',
      group: 'Developer',
      summary: 'Android SDK and emulator images.',
      detail: 'Stow will not remove the toolchain. Large system images show under Large files, and those can be downloaded again from Android Studio.',
      trashable: false,
      timeoutMs: 90_000
    }),
    root({
      id: 'homebrew',
      title: 'Homebrew',
      path: '/opt/homebrew',
      verdict: 'optional',
      group: 'Developer',
      summary: 'The Homebrew prefix and the tools you installed with it.',
      detail: 'Stow shows the size and will not remove it. Use brew cleanup for stale downloads. Those usually live in Caches.',
      trashable: false,
      timeoutMs: 90_000
    }),
    root({
      id: 'homebrew-intel',
      title: 'Homebrew Cellar',
      path: '/usr/local/Cellar',
      verdict: 'optional',
      group: 'Developer',
      summary: 'Tools installed with Homebrew under /usr/local.',
      detail: 'Stow shows the size and will not remove them. Uninstall formulae with brew if you want the space back.',
      trashable: false,
      timeoutMs: 90_000
    })
  ]
}

export async function discoverRoots(home: string): Promise<RootSpec[]> {
  const specs = staticRoots(home)
  const xcodeDir = path.join(home, 'Library/Developer/Xcode')
  try {
    const names = await fs.readdir(xcodeDir)
    for (const name of names) {
      if (name.startsWith('.')) continue
      specs.push(xcodeSpec(xcodeDir, name))
    }
  } catch {
    // Xcode is not installed.
  }

  const checks = await Promise.all(
    specs.map(async (spec) => {
      try {
        await fs.stat(spec.path)
        return spec
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        return code === 'ENOENT' ? null : spec
      }
    })
  )
  return checks.filter((spec): spec is RootSpec => spec !== null)
}
