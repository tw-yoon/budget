import SwiftUI

/// Grey rows in a list's shape while it loads for the first time, instead of
/// a spinner. The rows are invented text drawn redacted; they take no taps
/// and read to VoiceOver as one "Loading" element.
struct PlaceholderRow: View {
  var title: String
  var detail: String?
  var amount: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        if let detail { Text(detail).font(.footnote).foregroundStyle(.secondary) }
      }
      Spacer(minLength: 0)
      if let amount { Text(amount).monospacedDigit().lineLimit(1).fixedSize() }
    }
  }
}

extension View {
  /// Draws this as loading placeholders: redacted, untappable, one
  /// "Loading" element for VoiceOver.
  func loadingPlaceholder() -> some View {
    self
      .redacted(reason: .placeholder)
      .allowsHitTesting(false)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Loading")
  }
}

/// An inset-grouped List of placeholder rows, for the Settings lists. Section
/// headers stay readable, since they are the same once loaded.
struct PlaceholderList: View {
  struct Block: Identifiable {
    var header: String?
    var rows: [PlaceholderRow]
    var id: String { header ?? "" }
  }

  let groups: [Block]

  var body: some View {
    List {
      ForEach(groups) { group in
        Section {
          ForEach(group.rows.indices, id: \.self) { group.rows[$0] }
        } header: {
          if let header = group.header { Text(header).unredacted() }
        }
      }
    }
    .listStyle(.insetGrouped)
    .scrollDisabled(true)
    .loadingPlaceholder()
  }

  /// Settings → Categories: a name and its usage line.
  static let categories = PlaceholderList(groups: [
    Block(rows: [
      PlaceholderRow(title: "Groceries", detail: "120 transactions · 2 rules"),
      PlaceholderRow(title: "Dining", detail: "80 transactions · 1 rule"),
      PlaceholderRow(title: "Shopping", detail: "60 transactions"),
      PlaceholderRow(title: "Travel", detail: "20 transactions · 3 rules"),
      PlaceholderRow(title: "Utilities", detail: "12 transactions"),
      PlaceholderRow(title: "Entertainment", detail: "9 transactions"),
    ])
  ])

  /// Settings → Rules: Apply Now, then a match, its category and outcome.
  static let rules = PlaceholderList(groups: [
    Block(header: nil, rows: [PlaceholderRow(title: "Apply Now")]),
    Block(header: "Rules", rows: [
      PlaceholderRow(title: "Name contains \u{201C}Sample Mart\u{201D}", detail: "\u{2192} Groceries"),
      PlaceholderRow(title: "Merchant is \u{201C}Example Cafe\u{201D}", detail: "\u{2192} Dining"),
      PlaceholderRow(title: "Name contains \u{201C}Sample Air\u{201D}", detail: "\u{2192} Travel"),
      PlaceholderRow(title: "Name contains \u{201C}Example Power\u{201D}", detail: "\u{2192} Utilities"),
    ]),
  ])

  /// Settings → Connections: debit cards, then banks.
  static let connections = PlaceholderList(groups: [
    Block(header: "Debit Cards", rows: [
      PlaceholderRow(title: "Sample Debit", detail: "··0002 · Everyday Checking", amount: "$1,000.00")
    ]),
    Block(header: "Connected Banks", rows: [
      PlaceholderRow(title: "Example Bank", detail: "3 accounts"),
      PlaceholderRow(title: "Sample Credit Union", detail: "2 accounts"),
    ]),
  ])
}

#Preview("Categories loading") {
  NavigationStack {
    PlaceholderList.categories.navigationTitle("Categories")
  }
}

#Preview("Rules loading") {
  NavigationStack {
    PlaceholderList.rules.navigationTitle("Rules")
  }
}

#Preview("Connections loading") {
  NavigationStack {
    PlaceholderList.connections.navigationTitle("Connections")
  }
}
