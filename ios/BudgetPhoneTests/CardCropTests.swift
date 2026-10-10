import Foundation
import ImageIO
import Testing
import UIKit
@testable import BudgetPhone

/// The port of ../src/lib/card-crop.ts, and cutting a screenshot with it.
struct CardCropTests {
  typealias Rect = CardCrop.Rect

  @Test func thePresetCutsWhereTheWebDoes() throws {
    // The size it was measured on, and the size the phone writes.
    let small = try #require(CardCrop.preset(width: 603, height: 1311))
    #expect(CardCrop.rect(small.crop, width: 603, height: 1311) == Rect(x: 30, y: 192, width: 543, height: 342))
    let full = try #require(CardCrop.preset(width: 1206, height: 2622))
    #expect(CardCrop.rect(full.crop, width: 1206, height: 2622) == Rect(x: 60, y: 384, width: 1086, height: 684))
  }

  @Test func otherShapesHaveNoPreset() {
    #expect(CardCrop.preset(width: 1000, height: 1000) == nil)
    #expect(CardCrop.preset(width: 1170, height: 2000) == nil)
    #expect(CardCrop.preset(width: 0, height: 100) == nil)
  }

  @Test func fractionsClampToThePicture() {
    let f = CardCrop.Fractions(x: 0.9, y: 0.9, width: 0.5, height: 0.5)
    #expect(CardCrop.rect(f, width: 100, height: 100) == Rect(x: 90, y: 90, width: 10, height: 10))
    #expect(CardCrop.rect(f, width: 0, height: 100) == nil)
  }

  @Test func cornerRadiusScalesWithTheCard() {
    #expect(CardCrop.cornerRadius(width: 543) == 18)
    #expect(CardCrop.cornerRadius(width: 1086) == 36)
    #expect(CardCrop.cornerRadius(width: 0) == 0)
  }

  @Test func longestRun() {
    #expect(CardCrop.longestRun([false, true, true, false, true]) == 1..<3)
    #expect(CardCrop.longestRun([true, true, true]) == 0..<3)
    #expect(CardCrop.longestRun([false, false]) == nil)
  }

  /// RGBA bytes: a flat background with a solid block on it.
  static func picture(
    width: Int, height: Int, bg: UInt8 = 200, block: Rect, fill: UInt8 = 40
  ) -> [UInt8] {
    var px = [UInt8](repeating: 0, count: width * height * 4)
    for y in 0..<height {
      for x in 0..<width {
        let inside = x >= block.x && x < block.x + block.width && y >= block.y && y < block.y + block.height
        let v = inside ? fill : bg
        let i = (y * width + x) * 4
        px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255
      }
    }
    return px
  }

  @Test func disagreeingCornersAreNotTrusted() {
    // The block covers the top-left corner, so the corners aren't all background.
    let px = Self.picture(width: 50, height: 50, block: Rect(x: 0, y: 0, width: 10, height: 10))
    #expect(CardCrop.differenceMap(px, width: 50, height: 50) == nil)
  }

  @Test func edgesFindTheCardAndDeriveItsHeight() throws {
    let card = Rect(x: 50, y: 100, width: 300, height: 189)
    let px = Self.picture(width: 400, height: 800, block: card)
    let diff = try #require(CardCrop.differenceMap(px, width: 400, height: 800))
    let found = try #require(CardCrop.detect(diff, width: 400, height: 800))
    // 300 / (85.6 / 53.98), rounded.
    #expect(found == Rect(x: 50, y: 100, width: 300, height: 189))
  }

  @Test func aPlainPictureHasNoCard() throws {
    let px = Self.picture(width: 40, height: 40, block: Rect(x: 0, y: 0, width: 0, height: 0))
    let diff = try #require(CardCrop.differenceMap(px, width: 40, height: 40))
    #expect(CardCrop.detect(diff, width: 40, height: 40) == nil)
  }

  // MARK: - Cutting

  static func png(width: Int, height: Int, card: CGRect) -> Data {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).pngData { ctx in
      UIColor(white: 0.95, alpha: 1).setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
      UIColor(red: 0.1, green: 0.3, blue: 0.6, alpha: 1).setFill()
      ctx.fill(card)
    }
  }

  static func image(_ png: Data) throws -> CGImage {
    let source = try #require(CGImageSourceCreateWithData(png as CFData, nil))
    return try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
  }

  static func alpha(_ image: CGImage, _ x: Int, _ y: Int) throws -> UInt8 {
    let px = try #require(CardCrop.rgba(image))
    return px[(y * image.width + x) * 4 + 3]
  }

  @Test func aWalletScreenshotIsCutByThePreset() async throws {
    let data = Self.png(width: 1206, height: 2622, card: CGRect(x: 60, y: 384, width: 1086, height: 684))
    let cut = try #require(await CardCrop.cut(data))
    #expect(cut.from == "iPhone preset")
    #expect(cut.sourceWidth == 1206 && cut.sourceHeight == 2622)
    let out = try Self.image(cut.png)
    #expect(out.width == 1086 && out.height == 684)
    // Rounded corners are transparent; the middle is the card, opaque.
    #expect(try Self.alpha(out, 0, 0) == 0)
    #expect(try Self.alpha(out, 1085, 683) == 0)
    #expect(try Self.alpha(out, 543, 342) == 255)
    let px = try #require(CardCrop.rgba(out))
    let mid = (342 * out.width + 543) * 4
    #expect(px[mid + 2] > px[mid])  // blue, not the backdrop
  }

  @Test func anotherScreenIsCutByItsEdges() async throws {
    let data = Self.png(width: 400, height: 800, card: CGRect(x: 50, y: 100, width: 300, height: 189))
    let cut = try #require(await CardCrop.cut(data))
    #expect(cut.from == "edges")
    let out = try Self.image(cut.png)
    #expect(out.width == 300 && out.height == 189)
  }

  @Test func anAlreadyCroppedCardIsKeptWhole() async throws {
    let data = Self.png(width: 300, height: 189, card: CGRect(x: 0, y: 0, width: 300, height: 189))
    let cut = try #require(await CardCrop.cut(data))
    #expect(cut.from == "whole image")
    let out = try Self.image(cut.png)
    #expect(out.width == 300 && out.height == 189)
  }

  @Test func notAnImageIsNil() async {
    #expect(await CardCrop.cut(Data("not an image".utf8)) == nil)
  }
}
