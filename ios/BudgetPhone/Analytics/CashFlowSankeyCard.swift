import SwiftUI

/// Cash flow over time (../src/components/charts/CashFlowSankey.tsx). The
/// phone shows one month's Sankey at a time: the arrows pan, there is no
/// zoom and no drag, and a tap stands in for hover. Subcategories always
/// branch out (the web shows them only at widths of 560 px and up), and
/// names sit inside wide node columns rather than beside thin ones.
struct CashFlowSankeyCard: View {
  let months: [CashflowMonth]
  /// The flows extend from the income column to the right, one column
  /// after another (AnalyticsEntrance).
  var animatesIn = false
  @State private var window = MonthWindow(defaultSpan: 1, maxSpan: 1)
  @State private var selection: Selection?
  /// The readout's size, to keep it beside the tap and inside the plot.
  @State private var readoutSize: CGSize = .zero
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @AppStorage(AmountPrivacy.storageKey) private var hidesAmounts = false

  private static let height: CGFloat = 372

  private struct Selection: Equatable {
    let band: SankeyLayout.Band
    let point: CGPoint
  }

  var body: some View {
    let shown = Array(months[window.range.clamped(to: 0..<months.count)])
    let month = shown.first.map(CashflowSankey.month)
    let label = MonthWindow.label(shown.map(\.label))

    ChartCard(title: "Cash flow over time", subtitle: label) {
      // One Sankey on screen: pan only, no zoom.
      WindowNav(canEarlier: window.canEarlier, canLater: window.canLater) {
        selection = nil
        window.pan($0)
      }
    } content: {
      if months.isEmpty {
        empty(Text("No transactions to chart."))
      } else if let month, month.hubTotal > 0 {
        // Stays sharp with Hide Amounts on: the figures go, the shapes stay.
        chart(month)
        legend(month)
      } else {
        empty(
          VStack(spacing: 4) {
            Text("No cash flow in \(label).")
            Text("Use the arrows to find activity.").font(.caption)
          })
      }
    }
    .onChange(of: months.count, initial: true) { _, count in window.setTotal(count) }
    .onChange(of: months) { selection = nil }
  }

  private func empty(_ content: some View) -> some View {
    content
      .font(.subheadline)
      .foregroundStyle(.secondary)
      .multilineTextAlignment(.center)
      .frame(maxWidth: .infinity, minHeight: 288)
  }

  private func chart(_ month: CashflowSankey.Month) -> some View {
    GeometryReader { geometry in
      let layout = SankeyLayout(
        month: month, width: geometry.size.width, height: Self.height, hidesAmounts: hidesAmounts)
      ChartEntrance(animatesIn: animatesIn) { progress in
        Canvas { context, _ in
          layout.draw(in: &context, progress: progress)
        }
      }
      .contentShape(Rectangle())
      .gesture(
        SpatialTapGesture().onEnded { tap in
          if let band = layout.band(at: tap.location), band != selection?.band {
            selection = Selection(band: band, point: tap.location)
          } else {
            selection = nil
          }
        }
      )
      .overlay(alignment: .topLeading) {
        if let selection {
          // Explicit offsets: alignment guides inside this overlay were
          // ignored, which left the readout pinned over the month label.
          let x = selection.point.x, y = selection.point.y
          let size = readoutSize
          // Beside the tap; flipped to its left near the right edge, as the
          // web does.
          let left = x > geometry.size.width - size.width - 14 ? x - size.width - 14 : x + 14
          // Above the tap, but kept between the month label at the top and
          // the in/out totals line at the bottom, never over them.
          let top = max(layout.topPad, min(y - 46, Self.height - layout.botPad - size.height))
          readout(selection.band, month: month)
            .fixedSize()
            .onGeometryChange(for: CGSize.self) { $0.size } action: { readoutSize = $0 }
            .offset(x: max(0, left), y: top)
            .allowsHitTesting(false)
        }
      }
      .accessibilityElement()
      .accessibilityLabel(
        layout.bands.map {
          hidesAmounts ? AmountPrivacy.mask($0.accessibilityLabel, with: "hidden amount") : $0.accessibilityLabel
        }.joined(separator: ". "))
    }
    .frame(height: Self.height)
  }

  private func readout(_ band: SankeyLayout.Band, month: CashflowSankey.Month) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(month.label.uppercased())
        .font(.caption2)
        .foregroundStyle(.secondary)
      HStack(spacing: 6) {
        Rectangle()
          .fill(CategoryColors.color(hex: band.hex).opacity(band.faded ? 0.5 : 1))
          .frame(width: 8, height: 8)
        if let parent = band.parent {
          Text("\(parent) ›").foregroundStyle(.secondary)
        }
        if band.faded {
          Text(band.name).italic()
        } else {
          Text(band.name).fontWeight(.medium)
        }
      }
      AmountText(Formatters.currency(band.amount))
    }
    .chartReadout()
  }

  private func legend(_ month: CashflowSankey.Month) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) {
          swatch("Income", hex: CategoryColors.income)
          hubSwatch
          swatch("From savings", hex: CategoryColors.draw)
          swatch("To savings", hex: CategoryColors.saved)
        }
      } else {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
          GridRow {
            swatch("Income", hex: CategoryColors.income)
            swatch("From savings", hex: CategoryColors.draw)
          }
          GridRow {
            hubSwatch
            swatch("To savings", hex: CategoryColors.saved)
          }
        }
      }
      if month.drawn > 0 {
        AmountText("Drew \(Formatters.currency(month.drawn)) from savings over this span")
          .foregroundStyle(.red)
      } else if month.drawn < 0 {
        AmountText("Added \(Formatters.currency(-month.drawn)) to savings over this span")
          .foregroundStyle(.blue)
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private var hubSwatch: some View { swatch("Total cash flow", hex: CategoryColors.hubBar) }

  private func swatch(_ title: String, hex: String) -> some View {
    HStack(spacing: 6) {
      Rectangle()
        .fill(CategoryColors.color(hex: hex))
        .frame(width: 8, height: 8)
      Text(title)
    }
  }
}

/// One month's Sankey laid out in a `width` × `height` box. The flows are
/// the web's; the phone draws thin node bars and a solid hub bar, spread
/// edge to edge with equal (wide) ribbon runs between them, and writes each
/// name beside its bar, over the flows. When a category has subcategories,
/// the web's subcategory stage is a third column.
struct SankeyLayout {
  struct Band: Equatable {
    /// The node's own name; "Other" for a branched category's remainder.
    let name: String
    /// Set when `name` is a subcategory, so the readout can show the pair.
    var parent: String?
    let amount: Double
    let hex: String
    let ribbon: Path?
    /// The visible node column.
    let node: CGRect
    /// At least `hitMinHeight` tall, so a thin band can still be tapped.
    let hit: CGRect
    let ribbonOpacity: Double
    /// The colours the ribbon shades between, from the bar it leaves to the
    /// bar it reaches; nil means the band's own colour.
    var ribbonFrom: String? = nil
    var ribbonTo: String? = nil
    var nodeOpacity = 1.0
    /// The un-subcategorized remainder of a branched category.
    var faded = false
    var label: Label?

    var accessibilityLabel: String {
      let title = parent.map { "\($0) › \(name)" } ?? name
      return "\(title): \(Formatters.currency(amount))"
    }
  }

  /// A node's "Name $1.2K" label, drawn beside the node over its flows and
  /// fitted to the ribbon run (see `fit`).
  struct Label: Equatable {
    enum Style: Equatable { case node, sub, rest }
    let name: String
    let amount: Double
    let point: CGPoint
    let anchor: UnitPoint
    let maxWidth: CGFloat
    /// The band's height, which decides whether two lines fit.
    let height: CGFloat
    let style: Style
  }

  /// A node thinner than this gets no label; a tap reads it.
  static let labelMinHeight: CGFloat = 4
  /// One line of label text, and the gap kept between labels in a column.
  static let lineHeight: CGFloat = 14
  /// From a node's edge to its label.
  static let labelGap: CGFloat = 4
  static let hitMinHeight: CGFloat = 9
  static let narrow: CGFloat = 560

  let month: CashflowSankey.Month
  let width: CGFloat
  let height: CGFloat
  let topPad: CGFloat = 22
  let botPad: CGFloat = 30
  let pad: CGFloat = 7
  let subPad: CGFloat = 3
  /// Hide Amounts: node labels carry only names, the totals line dots.
  let hidesAmounts: Bool
  /// The width of every node column.
  let nodeW: CGFloat
  let scale: CGFloat
  let hub: CGRect
  /// True when some category branches into its subcategories.
  let hasSubStage: Bool
  /// Inflow bands, then each outflow band followed by its subcategory
  /// bands; the hub is `hubBand`.
  let bands: [Band]
  let hubBand: Band

  init(month: CashflowSankey.Month, width: CGFloat, height: CGFloat, hidesAmounts: Bool = false) {
    self.month = month
    self.hidesAmounts = hidesAmounts
    self.width = width
    self.height = height
    let topPad = self.topPad, pad = self.pad, subPad = self.subPad
    let usableH = height - topPad - botPad
    let maxNodes = CGFloat(max(1, month.inflow.count, month.outflow.count))
    let maxHub = max(1, month.hubTotal)
    let scale = (usableH - (maxNodes - 1) * pad) / maxHub * 0.92
    self.scale = scale
    let hasSubStage = month.outflow.contains { !($0.subs ?? []).isEmpty }
    self.hasSubStage = hasSubStage

    // Two or three thin node columns and the hub, edge to edge, with the
    // same ribbon run between each pair.
    let nodeW = max(8, (width * 0.03).rounded())
    self.nodeW = nodeW
    let columns: CGFloat = hasSubStage ? 3 : 2
    let hubW = nodeW
    let run = max(16, (width - columns * nodeW - hubW) / columns)
    let xInR = nodeW  // right edge of the inflow nodes
    let hubL = xInR + run
    let hubR = hubL + hubW
    let xSpL = hubR + run  // left edge of the spend nodes
    let xSubL = xSpL + nodeW + run  // left edge of the subcategory nodes
    let hubH = month.hubTotal * scale
    let hubTop = topPad + (usableH - hubH) / 2
    hub = CGRect(x: hubL, y: hubTop, width: hubW, height: max(1, hubH))

    func hitRect(_ node: CGRect) -> CGRect {
      let hh = max(node.height, Self.hitMinHeight)
      return CGRect(x: node.minX, y: node.midY - hh / 2, width: node.width, height: hh)
    }
    // Labels sit beside their node, over the flows: income names to the
    // right of their bars, spend and subcategory names to the left, so each
    // ribbon run holds one column's names.
    // Within a column a label that would touch the one above is dropped;
    // a tap still reads its node.
    let labelRoom = run - 2 * Self.labelGap
    var columnBottoms: [CGFloat: CGFloat] = [:]
    func label(_ name: String, _ amount: Double, beside node: CGRect, leftOf: Bool, style: Label.Style)
      -> Label?
    {
      guard node.height >= Self.labelMinHeight else { return nil }
      let extent = node.height >= Self.twoLineHeight ? 2 * Self.lineHeight : Self.lineHeight
      let top = node.midY - extent / 2
      if let bottom = columnBottoms[node.minX], top < bottom { return nil }
      columnBottoms[node.minX] = top + extent
      return Label(
        name: name, amount: amount,
        point: CGPoint(x: leftOf ? node.minX - Self.labelGap : node.maxX + Self.labelGap, y: node.midY),
        anchor: leftOf ? .trailing : .leading, maxWidth: labelRoom, height: node.height, style: style)
    }

    var bands: [Band] = []
    // Inflow side (left): income sources, then the savings drawdown.
    let inSpan = month.inflow.reduce(0) { $0 + $1.amount * scale } + CGFloat(month.inflow.count - 1) * pad
    var ny = topPad + (usableH - inSpan) / 2
    var hy = hubTop
    for n in month.inflow {
      let h = n.amount * scale
      let node = CGRect(x: 0, y: ny, width: nodeW, height: max(1, h))
      bands.append(
        Band(
          name: n.name, amount: n.amount, hex: n.hex,
          ribbon: Self.ribbon(x0: xInR, t0: ny, b0: ny + h, x1: hubL, t1: hy, b1: hy + h),
          node: node, hit: hitRect(node), ribbonOpacity: 0.5, ribbonTo: CategoryColors.hubBar,
          label: label(n.name, n.amount, beside: node, leftOf: false, style: .node)))
      ny += h + pad
      hy += h
    }

    // Outflow side (right): spend categories, then the surplus to savings.
    // A category with subcategories branches into them; whatever wasn't
    // subcategorized flows on as an "Other" node.
    let outSpan = month.outflow.reduce(0) { $0 + $1.amount * scale } + CGFloat(month.outflow.count - 1) * pad
    var oy = topPad + (usableH - outSpan) / 2
    hy = hubTop
    var subCursor = topPad  // keeps adjacent categories' sub stacks from overlapping
    for n in month.outflow {
      let h = n.amount * scale
      let node = CGRect(x: xSpL, y: oy, width: nodeW, height: max(1, h))
      bands.append(
        Band(
          name: n.name, amount: n.amount, hex: n.hex,
          ribbon: Self.ribbon(x0: hubR, t0: hy, b0: hy + h, x1: xSpL, t1: oy, b1: oy + h),
          node: node, hit: hitRect(node), ribbonOpacity: 0.5, ribbonFrom: CategoryColors.hubBar,
          label: label(n.name, n.amount, beside: node, leftOf: true, style: .node)))

      let named = n.subs ?? []
      if !named.isEmpty {
        let rest = n.amount - named.reduce(0) { $0 + $1.amount }
        let parts =
          named.map { (name: $0.name, amount: $0.amount, rest: false) }
          + (rest > 0.005 ? [(name: "Other", amount: rest, rest: true)] : [])
        let span = parts.reduce(0) { $0 + $1.amount * scale } + CGFloat(parts.count - 1) * subPad
        var sy = max(subCursor, oy + (h - span) / 2)
        var py = oy  // cursor along the parent node's right edge
        for p in parts {
          let sh = p.amount * scale
          let sub = CGRect(x: xSubL, y: sy, width: nodeW, height: max(1, sh))
          bands.append(
            // A solid, lighter shade of the parent's colour (lighter still
            // for the remainder); the flow shades from the parent into it.
            Band(
              name: p.name, parent: n.name, amount: p.amount,
              hex: CategoryColors.lighter(n.hex, by: p.rest ? 0.65 : 0.4),
              ribbon: Self.ribbon(x0: xSpL + nodeW, t0: py, b0: py + sh, x1: xSubL, t1: sy, b1: sy + sh),
              node: sub, hit: hitRect(sub),
              ribbonOpacity: p.rest ? 0.3 : 0.45, ribbonFrom: n.hex, faded: p.rest,
              label: label(p.name, p.amount, beside: sub, leftOf: true, style: p.rest ? .rest : .sub)))
          sy += sh + subPad
          py += sh
        }
        subCursor = sy - subPad + pad
      }
      oy += h + pad
      hy += h
    }
    self.bands = bands
    hubBand = Band(
      name: "Total cash flow", amount: month.hubTotal, hex: CategoryColors.hubBar, ribbon: nil,
      node: hub, hit: hub, ribbonOpacity: 0, label: nil)
  }

  /// ribbon: a filled cubic-bézier band between two vertical segments.
  static func ribbon(
    x0: CGFloat, t0: CGFloat, b0: CGFloat, x1: CGFloat, t1: CGFloat, b1: CGFloat
  ) -> Path {
    let mx = (x0 + x1) / 2
    var p = Path()
    p.move(to: CGPoint(x: x0, y: t0))
    p.addCurve(to: CGPoint(x: x1, y: t1), control1: CGPoint(x: mx, y: t0), control2: CGPoint(x: mx, y: t1))
    p.addLine(to: CGPoint(x: x1, y: b1))
    p.addCurve(to: CGPoint(x: x0, y: b0), control1: CGPoint(x: mx, y: b1), control2: CGPoint(x: mx, y: b0))
    p.closeSubpath()
    return p
  }

  /// What a tap at `point` lands on: a node's hit area, then a ribbon, then
  /// the hub. The last match wins, as the topmost element does on the web.
  func band(at point: CGPoint) -> Band? {
    bands.last { $0.hit.contains(point) }
      ?? bands.last { $0.ribbon?.contains(point) == true }
      ?? (hub.contains(point) ? hubBand : nil)
  }

  /// A bar is square-cornered, except on the diagram's own outer edges:
  /// the far-left bars round their left corners, the far-right bars their
  /// right ones.
  func barPath(_ rect: CGRect) -> Path {
    let r: CGFloat = 2
    let left = rect.minX <= 0.5 ? r : 0
    let right = rect.maxX >= width - 0.5 ? r : 0
    return UnevenRoundedRectangle(
      topLeadingRadius: left, bottomLeadingRadius: left, bottomTrailingRadius: right,
      topTrailingRadius: right
    ).path(in: rect)
  }

  /// From where the entrance's sweep has reached to fully shown: a bar or
  /// label fades in over this run as the sweep passes its left edge.
  static let revealFade: CGFloat = 28

  /// How far the entrance has uncovered the diagram, from its left edge:
  /// nothing at 0; at 1, past the right edge by `revealFade`, so every bar
  /// is fully shown.
  func reveal(_ progress: Double) -> CGFloat {
    (width + Self.revealFade) * min(1, max(0, progress))
  }

  /// A bar's or label's opacity while the sweep at `reveal` passes `x`.
  static func revealOpacity(at x: CGFloat, reveal: CGFloat) -> Double {
    Double(min(1, max(0, (reveal - x) / revealFade)))
  }

  /// `progress` is the entrance (AnalyticsEntrance): the flows are uncovered
  /// from the left, column by column, and bars, labels and the hub's month
  /// and totals fade in as the sweep reaches them. 1 draws it all.
  func draw(in context: inout GraphicsContext, progress: Double = 1) {
    let isNarrow = width < Self.narrow
    let reveal = reveal(progress)
    let sweeping = progress < 1
    /// A copy of the context faded for something whose left edge is `x`.
    func faded(at x: CGFloat) -> GraphicsContext {
      var layer = context
      if sweeping { layer.opacity *= Self.revealOpacity(at: x, reveal: reveal) }
      return layer
    }
    for band in bands {
      let color = CategoryColors.color(hex: band.hex)
      if let ribbon = band.ribbon {
        var layer = context
        if sweeping {
          layer.clip(to: Path(CGRect(x: -1, y: 0, width: max(0, reveal + 1), height: height)))
        }
        // Shades from the colour of the bar it leaves to the bar it reaches.
        let from = CategoryColors.color(hex: band.ribbonFrom ?? band.hex).opacity(band.ribbonOpacity)
        let to = CategoryColors.color(hex: band.ribbonTo ?? band.hex).opacity(band.ribbonOpacity)
        let box = ribbon.boundingRect
        layer.fill(
          ribbon,
          with: .linearGradient(
            Gradient(colors: [from, to]), startPoint: CGPoint(x: box.minX, y: box.midY),
            endPoint: CGPoint(x: box.maxX, y: box.midY)))
      }
      var bar = faded(at: band.node.minX)
      bar.fill(
        barPath(band.node), with: .color(color.opacity(band.nodeOpacity)))
      if let label = band.label {
        for line in Self.fit(label, hidesAmount: hidesAmounts, in: context) {
          bar.draw(line.text, at: line.point, anchor: label.anchor)
        }
      }
    }

    // The hub is a solid bar like the nodes, in its own colour (the web's is
    // grey), so the flows on either side can shade into it.
    var hubLayer = faded(at: hub.minX)
    hubLayer.fill(
      Path(hub), with: .color(CategoryColors.color(hex: CategoryColors.hubBar)))

    hubLayer.draw(
      Text(isNarrow ? CashflowSankey.shortLabel(month.label) : month.label)
        .font(.system(size: 11, weight: .semibold)).foregroundStyle(.primary),
      at: CGPoint(x: hub.midX, y: topPad - 8))
    // Dots in grey with Hide Amounts on, as AmountText does elsewhere.
    let figure = { (amount: Double) in
      hidesAmounts ? AmountPrivacy.dots : Formatters.compactCurrency(amount)
    }
    let income = Text("in \(figure(month.incomeTotal))")
      .foregroundStyle(
        hidesAmounts ? Color.secondary : CategoryColors.color(hex: CategoryColors.income))
    let spend = Text("  ·  out \(figure(month.spendTotal))").foregroundStyle(.secondary)
    let totals = Text("\(income)\(spend)")
    hubLayer.draw(totals.font(.system(size: 10)), at: CGPoint(x: hub.midX, y: height - 12))
  }

  static let twoLineHeight: CGFloat = 24

  /// The label as drawn, first that fits `maxWidth`: "Name $1.2K"; on a
  /// band tall enough, the name above the amount; "Name… $1.2K" with at
  /// least five letters of the name; the name alone, shortened as far as
  /// "Nam…"; just the amount; nothing. With `hidesAmount`, only the name
  /// steps.
  static func fit(
    _ label: Label, hidesAmount: Bool = false, in context: GraphicsContext
  ) -> [(text: GraphicsContext.ResolvedText, point: CGPoint)] {
    let amount = Formatters.compactCurrency(label.amount)
    func resolved(_ s: String) -> GraphicsContext.ResolvedText? {
      let text = context.resolve(
        styled(s, label.style).foregroundStyle(label.style == .rest ? Color.secondary : Color.primary))
      let fits = text.measure(in: CGSize(width: CGFloat.infinity, height: .infinity)).width <= label.maxWidth
      return fits ? text : nil
    }
    /// `truncate`, without a space before the "…" ("Home…", not "Home …").
    func shortened(_ max: Int) -> String {
      let cut = String(label.name.prefix(max - 1))
      return cut.trimmingCharacters(in: .whitespaces) + "…"
    }
    /// The full name, then shorter ones down to `minLength` characters
    /// including the "…".
    func names(_ minLength: Int) -> [String] {
      let n = label.name.count
      return [label.name]
        + (n > minLength
          ? stride(from: n - 1, through: minLength, by: -1).map { shortened($0) } : [])
    }
    let one = { (text: GraphicsContext.ResolvedText) in [(text: text, point: label.point)] }
    if hidesAmount { return names(4).lazy.compactMap(resolved).first.map(one) ?? [] }
    if let text = resolved("\(label.name) \(amount)") { return one(text) }
    if label.height >= twoLineHeight, let second = resolved(amount),
      let first = names(4).lazy.compactMap(resolved).first
    {
      return [
        (first, CGPoint(x: label.point.x, y: label.point.y - 6)),
        (second, CGPoint(x: label.point.x, y: label.point.y + 6)),
      ]
    }
    if let text = names(6).dropFirst().lazy.compactMap({ resolved("\($0) \(amount)") }).first {
      return one(text)
    }
    if let text = names(4).lazy.compactMap(resolved).first { return one(text) }
    return resolved(amount).map(one) ?? []
  }

  private static func styled(_ s: String, _ style: Label.Style) -> Text {
    switch style {
    case .node: Text(s).font(.system(size: 10, weight: .semibold))
    case .sub: Text(s).font(.system(size: 9.5, weight: .medium))
    case .rest: Text(s).font(.system(size: 9.5)).italic()
    }
  }
}
