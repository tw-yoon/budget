import SwiftUI

/// Settings → Load Times (Pro mode): how long the main screens' loads took on
/// this phone, split into server, network and reading time, to find what is
/// really slow. The phone's own; the web has no counterpart.
struct LoadTimesView: View {
  var loadTimes: LoadTimes = .shared
  @State private var entries: [LoadTime] = []

  var body: some View {
    List {
      if entries.isEmpty {
        Text("No loads yet. Open a few screens, then come back.")
          .foregroundStyle(.secondary)
      } else {
        Section("Median by Screen") {
          ForEach(LoadTimeSummary.byPath(entries), id: \.path) { s in
            LoadTimeRow(title: s.path, detail: LoadTimeSummary.loads(s.count), value: s.median)
          }
        }
        Section("Recent") {
          ForEach(entries) { e in
            LoadTimeRow(title: LoadTimeSummary.screen(e.path), detail: LoadTimeSummary.parts(e), value: e.total)
          }
        }
      }
    }
    .navigationTitle("Load Times")
    .refreshable { entries = loadTimes.all }
    .onAppear { entries = loadTimes.all }
  }
}

private struct LoadTimeRow: View {
  let title: String
  let detail: String
  let value: Double
  @Environment(\.dynamicTypeSize) private var size

  var body: some View {
    let layout = size.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
      : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
    layout {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        Text(detail).font(.footnote).foregroundStyle(.secondary)
      }
      if !size.isAccessibilitySize { Spacer() }
      Text(LoadTimeSummary.ms(value))
        .monospacedDigit()
        .lineLimit(1)
        .fixedSize()
    }
  }
}

enum LoadTimeSummary {
  struct PathSummary: Equatable {
    let path: String
    let count: Int
    let median: Double
  }

  /// One line per screen, slowest median first.
  static func byPath(_ entries: [LoadTime]) -> [PathSummary] {
    Dictionary(grouping: entries, by: { screen($0.path) })
      .map { PathSummary(path: $0.key, count: $0.value.count, median: median($0.value.map(\.total))) }
      .sorted { $0.median != $1.median ? $0.median > $1.median : $0.path < $1.path }
  }

  static func median(_ values: [Double]) -> Double {
    let s = values.sorted()
    guard !s.isEmpty else { return 0 }
    return s.count.isMultiple(of: 2) ? (s[s.count / 2 - 1] + s[s.count / 2]) / 2 : s[s.count / 2]
  }

  /// "api/analytics/spending" → "analytics/spending".
  static func screen(_ path: String) -> String {
    path.hasPrefix("api/") ? String(path.dropFirst(4)) : path
  }

  /// "Server 12 · Network 180 · Reading 8 ms"; without a server figure, the request whole.
  static func parts(_ e: LoadTime) -> String {
    let reading = "Reading \(Int(e.reading.rounded()))"
    guard let server = e.server, let network = e.network else {
      return "Request \(Int(e.request.rounded())) · \(reading) ms"
    }
    return "Server \(Int(server.rounded())) · Network \(Int(network.rounded())) · \(reading) ms"
  }

  static func loads(_ n: Int) -> String { n == 1 ? "1 load" : "\(n) loads" }

  static func ms(_ value: Double) -> String { "\(Int(value.rounded())) ms" }
}
