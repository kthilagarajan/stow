
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
  while ((nl = buffer.indexOf("\n")) >= 0) {
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
    stdout.writeData($.NSString.alloc.initWithUTF8String(JSON.stringify(result) + "\n").dataUsingEncoding($.NSUTF8StringEncoding))
  }
}
