import Foundation
import Testing
import UIKit
@testable import BudgetPhone

final class CardArtStub: @unchecked Sendable {
  var status = 200
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct CardArtCacheTests {
    let url = URL(string: "http://budget-mac.local:3000/api/card-art/sample.png")!
    let stub = CardArtStub()
    let directory = FileManager.default.temporaryDirectory.appending(path: "CardArtTests-\(UUID().uuidString)")

    /// A full-size face, larger than the cache keeps.
    nonisolated static let png: Data = UIGraphicsImageRenderer(
      size: CGSize(width: 1000, height: 630), format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()
    ).pngData { ctx in
      UIColor.systemTeal.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: 1000, height: 630))
    }

    func cache() -> CardArtCache {
      let stub = self.stub
      let session = StubURLProtocol.session { _ in (stub.status, stub.status == 200 ? Self.png : Data()) }
      return CardArtCache(session: session, directory: directory, token: { nil })
    }

    @Test func sendsTheToken() async throws {
      let session = StubURLProtocol.session { _ in (200, Self.png) }
      let c = CardArtCache(session: session, directory: directory, token: { "sample-token" })
      c.load(url)
      await c.settle()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer sample-token")
    }

    @Test func fetchesOnceShrunkAndKeepsItOnDisk() async throws {
      let c = cache()
      c.load(url)
      await c.settle()
      let image = try #require(c.image(url))
      #expect(max(image.size.width, image.size.height) * image.scale <= CGFloat(CardArtCache.maxPixelSize))
      c.load(url)
      await c.settle()
      #expect(StubURLProtocol.requests.count == 1, "fetched once per launch")
      let files = try FileManager.default.contentsOfDirectory(atPath: directory.path())
      #expect(files.count == 1)
    }

    @Test func aFailedFetchIsTriedAgain() async {
      stub.status = 500
      let c = cache()
      c.load(url)
      await c.settle()
      #expect(c.image(url) == nil)
      stub.status = 200
      c.load(url)
      await c.settle()
      #expect(c.image(url) != nil)
      #expect(StubURLProtocol.requests.count == 2)
    }

    @Test func theNextLaunchShowsTheDiskCopyBeforeTheServerAnswers() async {
      let first = cache()
      first.load(url)
      await first.settle()
      stub.status = 500
      let next = cache()
      next.load(url)
      #expect(next.image(url) != nil)
      await next.settle()
      #expect(next.image(url) != nil, "a failed refetch keeps the disk copy")
    }

    @Test func theStorePrefetchesEveryFace() async {
      let session = StubURLProtocol.session { r in
        if r.url?.path() == "/api/user-cards" {
          return (200, Data(#"{"cards":[\#(TestData.cardJSON(id: "c1", artUrl: "/api/card-art/sample.png"))]}"#.utf8))
        }
        return (200, Self.png)
      }
      let art = CardArtCache(session: session, directory: directory, token: { nil })
      let client = APIClient(baseURL: URL(string: "http://budget-mac.local:3000")!, session: session)
      let store = BenefitsStore(client: { client }, art: art)
      await store.load()
      await art.settle()
      #expect(art.image(url) != nil)
      #expect(StubURLProtocol.requests.map { $0.url?.path() } == ["/api/user-cards", "/api/card-art/sample.png"])
    }
  }
}
