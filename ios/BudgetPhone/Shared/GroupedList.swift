import SwiftUI

/// The pieces of an inset-grouped list, for lists drawn with a lazy stack in
/// a ScrollView rather than a List: a List snaps its rows to a new height,
/// so a switch between full and compact rows jumped. In a lazy stack the
/// heights glide and the rows below follow. Sized as iOS 26's own
/// inset-grouped List, so these lists match the Lists elsewhere.
enum GroupedList {
  static let minRowHeight: CGFloat = 52
  static let cardRadius: CGFloat = 26
  /// The card's margin from the screen's edge, and a row's inset inside it.
  static let inset: CGFloat = 16
}

extension View {
  /// A section header's text, as a List's.
  func groupedHeader() -> some View {
    self
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(.secondary)
      .padding(.horizontal, 2 * GroupedList.inset)
      .padding(.top, 12)
      .padding(.bottom, 8)
  }

  /// A section footer's text, as a List's.
  func groupedFooter() -> some View {
    self
      .font(.footnote)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 2 * GroupedList.inset)
      .padding(.top, 8)
      .padding(.bottom, 12)
  }

  /// One row inside a card: its insets, minimum height and, unless it is the
  /// last, a separator under it.
  func groupedRow(isLast: Bool) -> some View {
    self
      .padding(.horizontal, GroupedList.inset)
      .padding(.vertical, 11)
      .frame(maxWidth: .infinity, minHeight: GroupedList.minRowHeight, alignment: .leading)
      .contentShape(.rect)
      .overlay(alignment: .bottom) {
        if !isLast { Divider().padding(.horizontal, GroupedList.inset) }
      }
  }

  /// The rounded card a section's rows sit on.
  func groupedCard() -> some View {
    self
      .background(Color(.secondarySystemGroupedBackground))
      .clipShape(.rect(cornerRadius: GroupedList.cardRadius))
      .padding(.horizontal, GroupedList.inset)
  }
}

/// A row's press highlight, as a List row's.
struct GroupedRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? Color(.systemGray4) : .clear)
  }
}
