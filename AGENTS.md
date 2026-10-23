# AGENTS.md

Guidance for coding agents and contributors working on Stow, a macOS storage analyzer built with Electron, React and TypeScript. Read [README.md](README.md) first for what the app does.

## Commands

```bash
npm run dev         # run the app with hot reload
npm run typecheck   # must pass before any change is done
npm test            # unit tests in src/shared
npm run demo        # run with made-up data (STOW_DEMO=1), for screenshots
npm run dist        # build the .dmg files (macOS only)
```

Run `npm run typecheck` and `npm test` after every change. CI runs both on every push.

## Safety rules

Stow can move a user's files to the Bin. These rules are what make that safe. Do not weaken them.

1. **The main process decides what can be trashed, never the window.** `src/main/guard.ts` (`trashDecision`) only allows paths that Stow measured, that are inside the home folder, and whose verdict is `clear` or `optional`. It always refuses the home folder itself, sensitive Library folders (keychains, mail, photos and others), apps and photo libraries. Every IPC handler in `src/main/ipc.ts` validates its arguments, because the page is not trusted.
2. **Move to the Bin, never delete.** Use `shell.trashItem`. The only permanent step is Empty Bin, which goes through Finder and is confirmed in the UI first.
3. **Unknown means keep.** A folder outside the catalog (for example one reached with Go to folder) starts as `keep` and not trashable. `classifyEntry` in `src/main/classify.ts` only loosens that for things it recognises, such as caches, `node_modules` and installers. A path the scan already labelled keeps its label wherever it is reached from (`toFolderEntry` in `src/main/scanner.ts`).
4. **Nothing about the Mac leaves it.** The only network code is `src/main/updates.ts`: it reads public release information from this repository on GitHub, and downloads a release asset when the person asks. It sends no paths, sizes or identifiers. It only downloads from `https://github.com/<repo>/releases/download/`, into Downloads. Do not add other network calls. Ask AI only builds a prompt and hands it to a desktop app or the clipboard.
5. **Show names exactly as they are on disk**, including a leading dot and the original case. A friendlier catalog label may appear beside the name (`diskName` and `tagFor` in `src/renderer/src/lib/browse.ts`), never instead of it.
6. **No real data in the repository.** Screenshots, tests and fixtures use demo mode (`src/main/demo.ts`) or invented paths such as `/Users/alex`. Never commit a real scan, a real home path, or credentials.

## Architecture

```
src/
  shared/      Types, IPC channel names and pure logic used by both processes. Unit-tested.
  main/        Electron main process: scanning, trashing, persistence, IPC.
  preload/     Exposes window.stow, the window's only bridge to the main process.
  renderer/    The React app.
```

### Shared (`src/shared`)

- `types.ts` holds every type that crosses the IPC boundary, including `StowApi`, the shape of `window.stow`.
- `ipc.ts` holds the channel names. Main and preload both import them, so a renamed channel fails the typecheck.
- `segments.ts` splits the disk into the storage bar's groups. `items.ts` does the Bin bookkeeping (`applyTrash`, `addToTrash`, `clearTrash`). `version.ts` compares release versions. All are pure functions with tests beside them.

### Main process (`src/main`)

| File | Responsibility |
| --- | --- |
| `index.ts` | App lifecycle: single-instance lock, startup, quit. Kept short. |
| `window.ts` | Creates the window and its icon, and the background colour for each theme. |
| `menu.ts` | The application menu. |
| `ipc.ts` | `registerIpc(scanner)`: every `ipcMain.handle`, with argument checks. |
| `catalog.ts` | The places Stow knows about (`RootSpec`): path, verdict, group and wording. |
| `scanner.ts` | `Scanner`: runs `du`, streams `ScanEvent`s to the window, opens folders, moves things to the Bin, and keeps the registry of measured paths. |
| `classify.ts`, `describe.ts` | Verdicts and summaries for entries found inside a folder. |
| `guard.ts` | `trashDecision` and the path helpers it relies on. |
| `store.ts` | Saves the last scan to `stow.sqlite` in the app's user data folder (`node:sqlite`). |
| `info.ts` | Per-item metadata for the details pane: dates (with last opened from Spotlight) and item count. |
| `updates.ts` | Checks GitHub releases for a newer version, downloads the disk image for this chip, and opens it. The repository comes from `package.json` (`repository.url`); `STOW_UPDATE_REPO` overrides it for testing. |
| `demo.ts` | Demo mode (`STOW_DEMO=1`): made-up scan data built from the real catalog, used by `npm run demo` and for screenshots. It keeps its own profile and never touches files. |
| `volume.ts`, `icons.ts`, `assistant.ts`, `exec.ts` | Disk totals, Finder icons, Ask AI hand-off, and child-process helpers. |

### Renderer (`src/renderer/src`)

`App.tsx` only composes the layout and owns cross-cutting state: the active shelf, the selected row, open dialogs. Each feature lives in its own folder:

| Folder | Contents |
| --- | --- |
| `components/layout` | `AppHeader`, `ShelfNav`, `StorageWall` (the storage bar), `AccessNote` |
| `components/browse` | `ShelfView` (a shelf with its filter), `ItemList`, `FolderBrowser`, `SelectionBar` |
| `components/inspector` | `Inspector` (the details pane), `Metadata` |
| `components/dialogs` | Move to Bin, Empty Bin, Go to folder, Ask AI, Update |
| `components/common` | Shared pieces: `ListRow` and `IconAction`, `Skeleton`s, `FileIcon`, `ActionTile` |
| `components/ui` | Unstyled-to-themed primitives in the shadcn/ui style. Keep these generic. |
| `hooks` | `useStow` (scan state and actions), `useBrowse` (folder navigation), `useSelection` (⌘-click picking), `useUpdate` (release checks and download), `useTheme`, `useShortcut`, `useStoredFlag`, `useFileIcons` |
| `lib` | Pure helpers: formatting, verdict styles and shelves, theme, the Bin/Trash word, browse helpers |
| `state.ts` | The reducer for scan state. The window applies Bin moves optimistically through `@shared/items`. |

Path aliases: `@/` is `src/renderer/src`, and `@shared/` is `src/shared`.

## Adding things

- **A new place to scan**: add a `RootSpec` in `src/main/catalog.ts` with a verdict, group, summary and detail. Pick the strictest verdict that is honest. Only set `trashable: true` when the app that owns it rebuilds it.
- **A new IPC call**: add the channel to `src/shared/ipc.ts`, the method to `StowApi` in `src/shared/types.ts`, the bridge in `src/preload/index.ts`, and a validated handler in `src/main/ipc.ts`.
- **A new UI area**: give it a folder under `components/`, keep its state in a hook when it is more than a few `useState`s, and pass data down as props. Avoid reaching into another area's internals; move shared helpers to `lib/` or `components/common/`.
- **Logic both processes need**: put it in `src/shared` as a pure function, and add a `*.test.ts` beside it and to the `test` script in `package.json`.

## Releasing

1. Make sure `npm run typecheck` and `npm test` pass on `main`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`. CI sets the app version from the tag and publishes a GitHub release with `Stow-<version>-arm64.dmg` and `Stow-<version>-x64.dmg`.
3. Keep those file names: the in-app updater picks the `.dmg` whose name contains the Mac's architecture.

To refresh the README screenshots, run `npm run demo` and capture the window. Screenshots live in `docs/screenshots/`.

## UI conventions

- **Colours come from theme tokens only** (`fog`, `sheet`, `raised`, `chrome`, `ink`, `harbor`, `mist`, `line`, `coral`, `amber`, `kelp`, `well`), defined for light and dark mode in `src/renderer/src/index.css`. Do not hard-code hex values or `bg-white` in components. Add a token instead. The only fixed colours are the verdict hues in `lib/verdicts.ts`.
- **Show loading.** Use `Skeleton`, `RowSkeletons` or `FolderSkeleton` from `components/common/Skeletons.tsx` instead of blank space or "Loading…" text.
- **Motion** uses the classes in `index.css`: `rise` (staggered rows; pass `index`), `fade-in`, `selection-bar`, and the dialog `pop`. Every animation must be switched off under `prefers-reduced-motion`.
- **Interaction**: a click selects, a click on the selected row clears it, ⌘-click adds to the selection, and double-click or the arrow opens a folder. Only the details pane and the multi-select bar offer Move to Bin; list rows do not.
- **Wording** is plain and calm. Say what will happen and whether there is a way back. Use `BIN` from `lib/bin.ts` for every user-facing "Bin" or "Trash".
- Fonts are Geist and Geist Mono. Sizes and paths use the mono face.
- Every clickable element gets a pointer cursor (set globally in `index.css`) and a visible focus ring.

## Code style

- Match the surrounding code: small functions, early returns, and few comments. A comment explains why, not what.
- TypeScript strict mode. Do not use `any` outside tests.
- Name things after what the person sees ("shelf", "bin", "details pane"), not after implementation details.
