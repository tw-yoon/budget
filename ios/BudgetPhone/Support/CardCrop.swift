import CoreGraphics
import Foundation
import ImageIO

/// Finding the card in a Wallet screenshot (../src/lib/card-crop.ts), and
/// cutting it out the way CardArtPicker does (cropToCard in
/// ../src/components/benefits/CardArtPicker.tsx): a known screen gets its
/// preset rectangle; anything else has its edges read; failing both, the
/// whole picture is kept. The constants and the order of the steps are the
/// web's, so a screenshot cuts the same on either.
enum CardCrop {
  struct Rect: Equatable, Sendable {
    var x: Int
    var y: Int
    var width: Int
    var height: Int
  }

  /// A crop as fractions of the picture, so one preset covers a screen at any scale.
  struct Fractions: Equatable, Sendable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
  }

  struct Preset: Sendable {
    let name: String
    /// width / height of the screenshots this was measured on.
    let aspect: Double
    let crop: Fractions
  }

  static let presets: [Preset] = [
    // Measured on an iPhone 16 Pro: the card 543 x 342 at 30, 192.
    Preset(
      name: "iPhone", aspect: 603.0 / 1311.0,
      crop: Fractions(x: 30.0 / 603, y: 192.0 / 1311, width: 543.0 / 603, height: 342.0 / 1311))
  ]

  /// A row counts as part of the card when this much of it differs.
  static let minRowFill = 0.5
  /// How much of a column must be covered for it to be part of the card.
  static let minColFill = 0.85
  /// Columns are judged over the top of the card's rows, not all of them.
  static let colProbe = 0.6
  /// How strong a column must be, against the card's interior, to be card.
  static let sideStrength = 0.6
  /// How much of a line must still be covered for the box to grow over it.
  static let edgeFill = 0.25
  /// How far a channel may drift from the background and still count as background.
  static let defaultTolerance = 22
  /// ID-1, 85.60 × 53.98 mm. The bottom edge is derived from it, not measured.
  static let cardRatio = 85.6 / 53.98
  /// How far a picture's shape may be from a preset's and still be that screen.
  static let aspectSlack = 0.02
  /// 18 px on a 543-wide card, what Wallet draws.
  static let cornerRadius = 18.0 / 543.0

  // MARK: - The web's helpers

  /// `presetFor`: the preset for a picture, or nil when none fits.
  static func preset(width: Int, height: Int) -> Preset? {
    guard width > 0, height > 0 else { return nil }
    let aspect = Double(width) / Double(height)
    return presets.first { abs(aspect - $0.aspect) <= aspectSlack }
  }

  /// `fromFractions`: back to pixels for a given picture, clamped to it.
  static func rect(_ f: Fractions, width: Int, height: Int) -> Rect? {
    guard width > 0, height > 0 else { return nil }
    // Math.round rounds halves up; Swift's .rounded() rounds them away from
    // zero. The same for the positive values here.
    func r(_ v: Double) -> Int { Int((v).rounded()) }
    let x = max(0, min(width - 1, r(f.x * Double(width))))
    let y = max(0, min(height - 1, r(f.y * Double(height))))
    let w = max(1, min(width - x, r(f.width * Double(width))))
    let h = max(1, min(height - y, r(f.height * Double(height))))
    return Rect(x: x, y: y, width: w, height: h)
  }

  /// `cornerRadiusFor`: the corner radius for a card cut to this width.
  static func cornerRadius(width: Int) -> Int {
    max(0, Int((Double(width) * cornerRadius).rounded()))
  }

  /// `differenceMap`: how far each pixel is from the background (the
  /// corners' average), or nil when the corners disagree.
  static func differenceMap(
    _ rgba: [UInt8], width: Int, height: Int, tolerance: Int = defaultTolerance
  ) -> [UInt8]? {
    guard width > 0, height > 0, rgba.count >= width * height * 4 else { return nil }
    func at(_ x: Int, _ y: Int) -> [Int] {
      let i = (y * width + x) * 4
      return [Int(rgba[i]), Int(rgba[i + 1]), Int(rgba[i + 2])]
    }
    let corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)]
    let bg = (0..<3).map { c in Int((Double(corners.reduce(0) { $0 + $1[c] }) / 4).rounded()) }
    let agrees = corners.allSatisfy { p in (0..<3).allSatisfy { abs(p[$0] - bg[$0]) <= tolerance } }
    guard agrees else { return nil }

    var diff = [UInt8](repeating: 0, count: width * height)
    rgba.withUnsafeBufferPointer { px in
      for p in 0..<diff.count {
        let i = p * 4
        diff[p] = UInt8(
          max(abs(Int(px[i]) - bg[0]), abs(Int(px[i + 1]) - bg[1]), abs(Int(px[i + 2]) - bg[2])))
      }
    }
    return diff
  }

  /// The longest unbroken run of true values, as start..<end.
  static func longestRun(_ keep: [Bool]) -> Range<Int>? {
    var best: Range<Int>?
    var start = -1
    for i in 0...keep.count {
      if i < keep.count && keep[i] {
        if start < 0 { start = i }
      } else if start >= 0 {
        if best == nil || i - start > best!.count { best = start..<i }
        start = -1
      }
    }
    return best
  }

  /// `detectCardRect`: the card's bounding box, or nil when no run of rows
  /// looks like one.
  static func detect(
    _ diff: [UInt8], width: Int, height: Int, tolerance: Int = defaultTolerance
  ) -> Rect? {
    guard width > 0, height > 0, diff.count >= width * height else { return nil }
    let t = UInt8(clamping: tolerance)
    func on(_ x: Int, _ y: Int) -> Int { diff[y * width + x] > t ? 1 : 0 }

    var rowKeep: [Bool] = []
    for y in 0..<height {
      var n = 0
      for x in 0..<width { n += on(x, y) }
      rowKeep.append(Double(n) >= Double(width) * minRowFill)
    }
    guard let rows = longestRun(rowKeep) else { return nil }
    let top = rows.lowerBound, bottom = rows.upperBound

    let bandH = bottom - top
    let probeEnd = top + max(1, Int((Double(bandH) * colProbe).rounded()))
    let probeH = probeEnd - top

    var colKeep: [Bool] = []
    for x in 0..<width {
      var n = 0
      for y in top..<probeEnd { n += on(x, y) }
      colKeep.append(Double(n) >= Double(probeH) * minColFill)
    }
    guard let cols = longestRun(colKeep) else { return nil }
    let left = cols.lowerBound, right = cols.upperBound

    func strength(_ x: Int) -> Double {
      var sum = 0
      for y in top..<probeEnd { sum += Int(diff[y * width + x]) }
      return Double(sum) / Double(probeH)
    }
    let quarter = (right - left) / 4
    var inner: [Double] = []
    if left + quarter < right - quarter {
      for x in (left + quarter)..<(right - quarter) { inner.append(strength(x)) }
    }
    inner.sort()
    let reference = inner.isEmpty ? 0 : inner[inner.count / 2]
    let floor = reference * sideStrength

    let middle = (left + right) / 2
    var x0 = middle
    while x0 - 1 >= 0 && strength(x0 - 1) >= floor { x0 -= 1 }
    var x1 = middle
    while x1 + 1 < width && strength(x1 + 1) >= floor { x1 += 1 }
    x1 += 1  // exclusive

    let rowFloor = Double(x1 - x0) * edgeFill
    func rowCover(_ y: Int) -> Int {
      var n = 0
      for x in x0..<x1 { n += on(x, y) }
      return n
    }
    // Only the top grows over a soft join; the sides are already tight.
    var y0 = top
    while y0 > 0 && Double(rowCover(y0 - 1)) >= rowFloor { y0 -= 1 }

    // The bottom follows from the width: a bank card is cut to a fixed ratio.
    let w = x1 - x0
    let h = min(Int((Double(w) / cardRatio).rounded()), height - y0)
    return Rect(x: x0, y: y0, width: w, height: h)
  }

  // MARK: - Cutting

  struct Cut: Sendable {
    /// The card face, corners rounded and transparent.
    let png: Data
    let sourceWidth: Int
    let sourceHeight: Int
    /// "iPhone preset", "edges" or "whole image", as the web words it.
    let from: String
  }

  /// cropToCard: decode, find the card, round its corners, re-encode as PNG.
  /// Nil when the picture can't be read.
  @concurrent nonisolated static func cut(_ data: Data) async -> Cut? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return nil }
    let width = image.width, height = image.height

    var box: Rect?
    var from = ""
    if let preset = preset(width: width, height: height) {
      box = rect(preset.crop, width: width, height: height)
      from = "\(preset.name) preset"
    }
    if box == nil {
      if let rgba = rgba(image), let diff = differenceMap(rgba, width: width, height: height) {
        box = detect(diff, width: width, height: height)
      }
      from = box == nil ? "whole image" : "edges"
    }
    // No preset and nothing card-shaped — an already-cropped image, or a photo.
    let r = box ?? Rect(x: 0, y: 0, width: width, height: height)

    guard
      let cropped = image.cropping(to: CGRect(x: r.x, y: r.y, width: r.width, height: r.height)),
      let ctx = CGContext(
        data: nil, width: r.width, height: r.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let bounds = CGRect(x: 0, y: 0, width: r.width, height: r.height)
    let radius = CGFloat(cornerRadius(width: r.width))
    if radius > 0, radius * 2 <= min(bounds.width, bounds.height) {
      ctx.addPath(CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil))
      ctx.clip()
    }
    ctx.draw(cropped, in: bounds)

    guard let out = ctx.makeImage() else { return nil }
    let png = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(png, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, out, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return Cut(png: png as Data, sourceWidth: width, sourceHeight: height, from: from)
  }

  /// The picture's pixels as sRGB RGBA bytes, top row first.
  nonisolated static func rgba(_ image: CGImage) -> [UInt8]? {
    let w = image.width, h = image.height
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    let drawn = bytes.withUnsafeMutableBytes { buf -> Bool in
      guard
        let ctx = CGContext(
          data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
          space: CGColorSpace(name: CGColorSpace.sRGB)!,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    return drawn ? bytes : nil
  }
}
