import CryptoKit
import Foundation
import ImageIO
import Observation
import UIKit

/// Card faces, kept so Benefits draws them at once. The server sends each as
/// a full-size PNG with `no-cache`, so AsyncImage fetched megabytes per card
/// on every visit, and a fetch cancelled mid-scroll could leave a card on its
/// gradient until the app restarted. Here each face is fetched once per
/// launch, off any view's lifetime, shrunk to the largest size Benefits draws it, and
/// written to Caches, so the next launch shows it before the network answers.
/// A failed fetch is tried again the next time the card is asked for.
@MainActor
@Observable
final class CardArtCache {
  static let shared = CardArtCache()

  private(set) var images: [URL: UIImage] = [:]

  @ObservationIgnored private let session: URLSession
  @ObservationIgnored private let directory: URL?
  @ObservationIgnored private let token: @Sendable () -> String?
  @ObservationIgnored private var inFlight: [URL: Task<Void, Never>] = [:]
  /// Fetched from the server since launch. The bytes behind a name can be
  /// replaced, so a copy from disk is still fetched once.
  @ObservationIgnored private var fresh: Set<URL> = []

  /// Pixels on the longer side: the card detail's 240 pt face at 3×. Still
  /// a fraction of the server's full-size PNGs.
  nonisolated static let maxPixelSize = 720

  init(
    session: URLSession = .shared, directory: URL? = CardArtCache.defaultDirectory,
    token: @escaping @Sendable () -> String? = { AccessToken.saved() }
  ) {
    self.session = session
    self.directory = directory
    self.token = token
  }

  nonisolated static var defaultDirectory: URL? {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
      .appending(path: "CardArt", directoryHint: .isDirectory)
  }

  func image(_ url: URL) -> UIImage? { images[url] }

  func load(_ urls: some Sequence<URL>) {
    for url in urls { load(url) }
  }

  func load(_ url: URL) {
    if images[url] == nil, let file = file(url), let data = try? Data(contentsOf: file),
      let image = UIImage(data: data)
    {
      images[url] = image
    }
    guard !fresh.contains(url), inFlight[url] == nil else { return }
    inFlight[url] = Task { await fetch(url) }
  }

  /// Waits for every fetch under way. For tests.
  func settle() async {
    while let task = inFlight.values.first { await task.value }
  }

  private func fetch(_ url: URL) async {
    defer { inFlight[url] = nil }
    var request = URLRequest(url: url, timeoutInterval: 30)
    if let t = token() { request.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
    guard let (data, response) = try? await session.data(for: request),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let png = await Self.shrink(data), let image = UIImage(data: png)
    else { return }
    fresh.insert(url)
    images[url] = image
    if let directory, let file = file(url) {
      try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try? png.write(to: file, options: .atomic)
    }
  }

  /// Decodes straight to the small size, off the main actor, as PNG to keep
  /// the transparent corners some faces have.
  @concurrent nonisolated static func shrink(_ data: Data) async -> Data? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let thumb = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ] as CFDictionary)
    else { return nil }
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, thumb, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return out as Data
  }

  /// One file per full URL, so two servers never share a face.
  private func file(_ url: URL) -> URL? {
    let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
    let name = digest.map { String(format: "%02x", $0) }.joined()
    return directory?.appending(path: "\(name).png")
  }
}
