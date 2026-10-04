import SwiftUI

/// A card's face (../src/components/benefits/CardArt.tsx). The uploaded image when
/// there is one; otherwise, and while it loads or if it fails, a gradient seeded
/// on the card's identity, which carries the issuer and last four when there's room.
struct CardArtView: View {
  let card: UserCardDTO
  let artURL: URL?
  let width: CGFloat

  /// ISO/IEC 7810 ID-1, the ratio every bank card is cut to.
  private static let ratio: CGFloat = 1.586

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: width * 0.06)
    Group {
      if let artURL, let image = CardArtCache.shared.image(artURL) {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        fallback
      }
    }
    // Usually already fetched by BenefitsStore; this retries one that failed.
    .task(id: artURL) { if let artURL { CardArtCache.shared.load(artURL) } }
    .frame(width: width, height: width / Self.ratio)
    .clipShape(shape)
    .accessibilityElement()
    .accessibilityLabel(Rewards.shortLabel(card))
  }

  private var fallback: some View {
    let colors = CardArtColors.colors(
      issuer: card.issuer, seed: "\(card.issuer)-\(card.name ?? "")-\(card.last4)")
    return ZStack(alignment: .topLeading) {
      LinearGradient(colors: [colors.from, colors.to], startPoint: .topLeading, endPoint: .bottomTrailing)
      // A band of light across the face, so it reads as a card, not a swatch.
      LinearGradient(
        stops: [
          .init(color: .clear, location: 0.38), .init(color: .white.opacity(0.16), location: 0.5),
          .init(color: .clear, location: 0.62),
        ], startPoint: .topLeading, endPoint: .bottomTrailing)
      if width >= 60 {
        VStack(alignment: .leading) {
          Text(Rewards.issuerLabel(card.issuer))
            .font(.system(size: 9, weight: .semibold))
            .textCase(.uppercase)
            .foregroundStyle(.white.opacity(0.8))
          Spacer(minLength: 0)
          Text("··\(card.last4)")
            .font(.system(size: 10).monospacedDigit())
            .foregroundStyle(.white.opacity(0.7))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
      }
    }
  }
}
