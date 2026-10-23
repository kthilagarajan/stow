# AGENTS.md

Guidance for coding agents and contributors working on Stow, a macOS storage analyzer built with Tauri 2, Rust, React and TypeScript. Read [README.md](README.md) first for what the app does.

## Commands

```bash
npm run dev         # tauri dev: Vite plus the Rust shell, with hot reload
npm run typecheck   # must pass before any change is done
npm test            # unit tests in src/shared
cargo test --manifest-path src-tauri/Cargo.toml
npm run demo        # run with made-up data (STOW_DEMO=1), for screenshots
npm run dist        # build the .dmg files (macOS only)
```

Run `npm run typecheck`, `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` after every change. CI runs all three on every push.

## Safety rules

Stow can move a user's files to the Bin. These rules are what make that safe. Do not weaken them.

1. **Rust decides what can be trashed, never the window.** `src-tauri/src/guard.rs` (`trash_decision`) only allows paths that Stow measured, that are inside the home folder, and whose verdict is `clear` or `optional`. It always refuses the home folder itself, sensitive Library folders (keychains, mail, photos and others), apps and photo libraries. Every command in `src-tauri/src/commands.rs` validates its arguments, because the page is not trusted.
2. **Move to the Bin, never delete.** Use the macOS trash (`trash` crate, NSWorkspace recycle). The only permanent step is Empty Bin, which goes through Finder and is confirmed in the UI first.
3. **Unknown means keep.** A folder outside the catalog (for example one reached with Go to folder) starts as `keep` and not trashable. `classify_entry` in `src-tauri/src/classify.rs` only loosens that for things it recognises, such as caches, `node_modules` and installers. A path the scan already labelled keeps its label wherever it is reached from (`to_folder_entry` in `src-tauri/src/scanner.rs`).
4. **Nothing about the Mac leaves it.** The only network code is `src-tauri/src/updates.rs`: it reads public release information from this repository on GitHub, and downloads a release asset when the person asks. It sends no paths, sizes or identifiers. It only downloads from `https://github.com/<repo>/releases/download/`, into Downloads. Do not add other network calls. Ask AI only builds a prompt and hands it to a desktop app or the clipboard (`src-tauri/src/assistant.rs`).
5. **Show names exactly as they are on disk**, including a leading dot and the original case. A friendlier catalog label may appear beside the name (`diskName` and `tagFor` in `src/renderer/src/lib/browse.ts`), never instead of it.
6. **No real data in the repository.** Screenshots, tests and fixtures use demo mode (`src-tauri/src/demo.rs`) or invented paths such as `/Users/alex`. Never commit a real scan, a real home path, or credentials.

## Architecture

```
src/
  shared/      Types and pure logic used by the React app. Unit-tested.
  renderer/    The React app. lib/bridge.ts installs window.stow.
src-tauri/     Rust: scanning, trashing, persistence, and Tauri commands.
```

### Shared (`src/shared`)

- `types.ts` holds every type that crosses the command boundary, including `StowApi`, the shape of `window.stow`.
- `ipc.ts` lists the event names the bridge listens for (`scan:event`, `folder:update`, `update:progress`, `update:requested`, `activity:update`).
- `segments.ts` splits the disk into the storage bar's groups. `items.ts` does the Bin bookkeeping (`applyTrash`, `addToTrash`, `clearTrash`). `version.ts` compares release versions. `listing.ts` shapes a folder listing for the window. All are pure functions with tests beside them.

### Rust (`src-tauri/src`)

| File | Responsibility |
| --- | --- |
| `lib.rs` | App lifecycle: single-instance lock, startup, quit. Kept short. |
| `window.rs` | Window icon and the background colour for each theme. |
| `menu.rs` | The application menu, including Check for Updates. |
| `commands.rs` | Every Tauri command, with argument checks. |
| `catalog.rs` | The places Stow knows about (`RootSpec`): path, verdict, group and wording. |
| `scanner.rs` | Streams `ScanEvent`s to the window, opens folders, moves things to the Bin, and keeps the registry of measured paths. All of its state sits behind one lock (`Inner`), including folders being measured, so there is no lock order to get wrong. |
| `disk.rs` | `Walk`: measures folders in parallel on `rayon` pools, counted like `du -k`. Browsing has its own pool so an opened folder never waits behind the scan. |
| `activity.rs` | The list of background work (`activity:update`). Hold a `Busy` from `Activity::begin` while work runs; the window words it in `components/layout/ActivityStatus.tsx`. |
| `classify.rs`, `describe.rs` | Verdicts and summaries for entries found inside a folder. |
| `guard.rs` | `trash_decision` and the path helpers it relies on. |
| `store.rs` | Saves the last scan and folder listings to `stow.sqlite` in the app's user data folder (`rusqlite`). `Db` queues writes on one thread; reads go through `Db::read` from a blocking task. |
| `info.rs` | Per-item metadata for the details pane: dates (with last opened from Spotlight) and item count. |
| `updates.rs` | Checks GitHub releases for a newer version, downloads the disk image for this chip, and opens it. The repository comes from `package.json` (`repository.url`); `STOW_UPDATE_REPO` overrides it for testing. |
| `demo.rs` | Demo mode (`STOW_DEMO=1`): made-up scan data built from the real catalog, used by `npm run demo` and for screenshots. It keeps its own profile and never touches files. |
| `volume.rs`, `icons.rs`, `assistant.rs`, `exec.rs` | Disk totals, Finder icons, Ask AI hand-off, and child-process helpers. |

### Renderer (`src/renderer/src`)

`App.tsx` only composes the layout and owns cross-cutting state: the active shelf, the selected row, open dialogs. Each feature lives in its own folder:

| Folder | Contents |
| --- | --- |
| `components/layout` | `AppHeader`, `ShelfNav`, `StorageWall` (the storage bar), `AccessNote`, `ActivityStatus` (background work, under the shelves) |
| `components/browse` | `ShelfView` (a shelf with its filter), `ItemList`, `FolderBrowser`, `SelectionBar` |
| `components/inspector` | `Inspector` (the details pane), `Metadata` |
| `components/dialogs` | Move to Bin, Empty Bin, Go to folder, Ask AI, Update |
| `components/common` | Shared pieces: `ListRow` and `IconAction`, `Skeleton`s, `FileIcon`, `ActionTile` |
| `components/ui` | Unstyled-to-themed primitives in the shadcn/ui style. Keep these generic. |
| `hooks` | `useStow` (scan state and actions), `useBrowse` (folder navigation), `useSelection` (⌘-click picking), `useSteadyRows` (rows that hold still under the pointer and slide into place), `useUpdate` (release checks and download), `useActivity` (background work), `useTheme`, `useShortcut`, `useStoredFlag`, `useFileIcons` |
| `lib` | Pure helpers: formatting, verdict styles and shelves, theme, the Bin/Trash word, browse helpers |
| `state.ts` | The reducer for scan state. The window applies Bin moves optimistically through `@shared/items`. |

Path aliases: `@/` is `src/renderer/src`, and `@shared/` is `src/shared`.

## Adding things

- **A new place to scan**: add a `RootSpec` in `src-tauri/src/catalog.rs` with a verdict, group, summary and detail. Pick the strictest verdict that is honest. Only set `trashable: true` when the app that owns it rebuilds it.
- **A new command**: add the method to `StowApi` in `src/shared/types.ts`, the invoke in `src/renderer/src/lib/bridge.ts`, a validated handler in `src-tauri/src/commands.rs`, and the name in `invoke_handler` in `src-tauri/src/lib.rs`. Events keep the names in `src/shared/ipc.ts`. Make the handler `async` and move disk, SQLite or child-process work into `spawn_blocking`: a plain `fn` command runs on the main thread and freezes the window.
- **A new UI area**: give it a folder under `components/`, keep its state in a hook when it is more than a few `useState`s, and pass data down as props. Avoid reaching into another area's internals; move shared helpers to `lib/` or `components/common/`.
- **Logic both processes need**: put it in `src/shared` as a pure function, and add a `*.test.ts` beside it and to the `test` script in `package.json`.

## Releasing

1. Make sure `npm run typecheck`, `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` pass on `main`.
2. Bump `version` in `package.json` (`npm version 0.2.0 --no-git-tag-version`) and commit it. `src-tauri/tauri.conf.json` reads that version.
3. Tag and push: `git tag v0.2.0 && git push origin main v0.2.0`. `.github/workflows/release.yml` checks the tag matches `package.json`, builds, and publishes a GitHub release with the disk images.
4. The in-app updater picks the `.dmg` whose name contains this Mac's architecture: `arm64` or `aarch64`, and `x64` or `x86_64`. `tauri build` writes them under `src-tauri/target/release/bundle/dmg/`.

To refresh the screenshots, run `npm run demo` and capture the window. Screenshots live in `docs/screenshots/` and are used by both the README and the website.

## Website

`site/` is an Astro + Tailwind page using the app's palette and Geist, published to GitHub Pages at https://kthilagarajan.github.io/stow/ by `.github/workflows/site.yml`. `site/scripts/sync.mjs` copies the icon and screenshots in at build time, so never edit copies under `site/public/`. Keep the site's wording in line with the README and the app.

## UI conventions

- **Colours come from theme tokens only** (`fog`, `sheet`, `raised`, `chrome`, `ink`, `harbor`, `mist`, `line`, `coral`, `amber`, `kelp`, `well`), defined for light and dark mode in `src/renderer/src/index.css`. Do not hard-code hex values or `bg-white` in components. Add a token instead. The only fixed colours are the verdict hues in `lib/verdicts.ts`.
- **Show loading.** Use `Skeleton`, `RowSkeletons` or `FolderSkeleton` from `components/common/Skeletons.tsx` instead of blank space or "Loading…" text.
- **Motion** uses the classes in `index.css`: `rise` (staggered rows; pass `index`), `fade-in`, `selection-bar`, and the dialog `pop`. Every animation must be switched off under `prefers-reduced-motion`.
- **Interaction**: a click selects, a click on the selected row clears it, ⌘-click adds to the selection, and the arrow opens a folder. Only the details pane and the multi-select bar offer Move to Bin; list rows do not.
- **Wording** is plain and calm. Say what will happen and whether there is a way back. Use `BIN` from `lib/bin.ts` for every user-facing "Bin" or "Trash".
- Fonts are Geist and Geist Mono. Sizes and paths use the mono face.
- Every clickable element gets a pointer cursor (set globally in `index.css`) and a visible focus ring.

## Code style

- Match the surrounding code: small functions, early returns, and few comments. A comment explains why, not what.
- TypeScript strict mode. Do not use `any` outside tests.
- Name things after what the person sees ("shelf", "bin", "details pane"), not after implementation details.
