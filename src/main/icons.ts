import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FileIconSet } from '../shared/types'

// Drawn off the main process. app.getFileIcon runs there and stalls the first click, and it can only
// draw whichever appearance the app is in right now.
const SCRIPT = `
ObjC.import("AppKit")
ObjC.import("Foundation")
function visible(rep) {
  if (!rep) return false
  var w = Number(rep.pixelsWide)
  var h = Number(rep.pixelsHigh)
  if (!(w > 0) || !(h > 0)) return false
  for (var i = 0; i < 16; i++) {
    var x = Math.floor(((i % 4) + 0.5) * w / 4)
    var y = Math.floor((Math.floor(i / 4) + 0.5) * h / 4)
    var color = rep.colorAtXY(x, y)
    if (color && color.alphaComponent > 0.2) return true
  }
  return false
}
function encode(rep) {
  if (!visible(rep)) return ""
  var png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary)
  if (!png) return ""
  return ObjC.unwrap(png.base64EncodedStringWithOptions(0))
}
function paint(icon, appearanceName) {
  if (!icon) return ""
  icon.setSize($.NSMakeSize(64, 64))
  var view = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, 64, 64))
  view.setImage(icon)
  view.setImageScaling($.NSImageScaleProportionallyUpOrDown)
  view.setAppearance($.NSAppearance.appearanceNamed(appearanceName))
  var bounds = view.bounds
  var rep = view.bitmapImageRepForCachingDisplayInRect(bounds)
  if (rep) view.cacheDisplayInRectToBitmapImageRep(bounds, rep)
  var encoded = encode(rep)
  if (encoded) return encoded
  // Some document icons never appear in an offscreen image view. Draw them directly.
  rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, 128, 128, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0
  )
  rep.setSize($.NSMakeSize(64, 64))
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
  $.NSAppearance.setCurrentAppearance($.NSAppearance.appearanceNamed(appearanceName))
  icon.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, 64, 64), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1)
  $.NSGraphicsContext.restoreGraphicsState
  return encode(rep)
}
function render(filePath, appearanceName) {
  try {
    var workspace = $.NSWorkspace.sharedWorkspace
    var encoded = paint(workspace.iconForFile(filePath), appearanceName)
    if (encoded) return encoded
    var name = String(filePath).split("/").pop()
    var dot = name.lastIndexOf(".")
    if (dot > 0) encoded = paint(workspace.iconForFileType(name.slice(dot)), appearanceName)
    if (encoded) return encoded
    return paint(workspace.iconForFileType(dot > 0 ? "public.data" : "public.folder"), appearanceName)
  } catch (e) {
    return ""
  }
}
var stdin = $.NSFileHandle.fileHandleWithStandardInput
var stdout = $.NSFileHandle.fileHandleWithStandardOutput
var buffer = ""
while (true) {
  var chunk = stdin.availableData
  if (!chunk || chunk.length == 0) break
  buffer += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(chunk, $.NSUTF8StringEncoding))
  var nl
  while ((nl = buffer.indexOf("\\n")) >= 0) {
    var line = buffer.slice(0, nl)
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    var paths = JSON.parse(line)
    var result = {}
    for (var i = 0; i < paths.length; i++) {
      var filePath = paths[i]
      var light = ""
      var dark = ""
      try { light = render(filePath, "NSAppearanceNameAqua") } catch (e) { light = "" }
      try { dark = render(filePath, "NSAppearanceNameDarkAqua") } catch (e) { dark = "" }
      result[filePath] = { light: light, dark: dark }
    }
    stdout.writeData($.NSString.alloc.initWithUTF8String(JSON.stringify(result) + "\\n").dataUsingEncoding($.NSUTF8StringEncoding))
  }
}
`

interface IconJob {
  paths: string[]
  resolve: (icons: Record<string, FileIconSet>) => void
}

let helper: ChildProcess | null = null
let scriptPath = ''
let stdout = ''
let pending: IconJob | null = null
let timer: NodeJS.Timeout | null = null
const queue: IconJob[] = []
const memory = new Map<string, FileIconSet>()

export function warmFileIcons(): void {
  if (process.platform !== 'darwin') return
  ensureHelper()
}

export function stopFileIcons(): void {
  helper?.kill('SIGKILL')
  helper = null
}

export function fileIcons(paths: string[]): Promise<Record<string, FileIconSet>> {
  const unique = [
    ...new Set(
      paths.filter((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 4096 && !entry.includes('\0'))
    )
  ].slice(0, 80)
  if (unique.length === 0 || process.platform !== 'darwin') return Promise.resolve({})
  const ready: Record<string, FileIconSet> = {}
  const missing = unique.filter((filePath) => {
    const saved = memory.get(filePath)
    if (!saved) return true
    ready[filePath] = saved
    return false
  })
  if (missing.length === 0) return Promise.resolve(ready)
  return new Promise((resolve) => {
    queue.push({
      paths: missing,
      resolve: (icons) => {
        for (const [filePath, icon] of Object.entries(icons)) {
          if (icon.light.startsWith('data:image/png') || icon.dark.startsWith('data:image/png')) memory.set(filePath, icon)
        }
        resolve({ ...ready, ...icons })
      }
    })
    pump()
  })
}

function ensureHelper(): ChildProcess | null {
  if (helper && helper.exitCode === null && !helper.killed) return helper
  try {
    if (!scriptPath) {
      scriptPath = path.join(os.tmpdir(), 'stow-file-icons.js')
      fs.writeFileSync(scriptPath, SCRIPT)
    }
    helper = spawn('osascript', ['-l', 'JavaScript', scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    helper = null
    return null
  }
  stdout = ''
  helper.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
    if (stdout.length > 8_000_000) stdout = stdout.slice(-8_000_000)
    let nl = stdout.indexOf('\n')
    while (nl >= 0) {
      const line = stdout.slice(0, nl)
      stdout = stdout.slice(nl + 1)
      nl = stdout.indexOf('\n')
      deliver(line)
    }
  })
  helper.on('error', () => {
    failPending()
  })
  helper.on('close', () => {
    helper = null
    failPending()
    if (queue.length > 0) pump()
  })
  return helper
}

function pump(): void {
  if (pending || queue.length === 0) return
  const child = ensureHelper()
  const job = queue.shift()
  if (!job) return
  if (!child?.stdin) {
    job.resolve({})
    pump()
    return
  }
  pending = job
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    pending = null
    job.resolve({})
    helper?.kill('SIGKILL')
    helper = null
  }, 45_000)
  try {
    child.stdin.write(`${JSON.stringify(job.paths)}\n`)
  } catch {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
    job.resolve({})
  }
}

function pngIcon(raw: string | undefined): string {
  if (!raw || !raw.startsWith('iVBORw0KGgo')) return ''
  return `data:image/png;base64,${raw}`
}

function deliver(line: string): void {
  const job = pending
  if (!job) return
  pending = null
  if (timer) clearTimeout(timer)
  timer = null
  const icons: Record<string, FileIconSet> = {}
  try {
    const parsed = JSON.parse(line) as Record<string, { light?: string; dark?: string }>
    for (const filePath of job.paths) {
      const pair = parsed[filePath]
      if (!pair) continue
      icons[filePath] = { light: pngIcon(pair.light), dark: pngIcon(pair.dark) }
    }
  } catch {
    // The helper spoke out of turn. This batch falls back to the plain icon.
  }
  job.resolve(icons)
  pump()
}

function failPending(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const job = pending
  pending = null
  job?.resolve({})
}
