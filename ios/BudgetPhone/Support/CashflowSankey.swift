import Foundation

/// The Cash-flow Sankey's data model: buildModel and foldTail in
/// ../src/components/charts/CashFlowSankey.tsx, for one month (the phone
/// shows one Sankey at a time).
enum CashflowSankey {
  static let topSpend = 7
  static let topIncome = 5

  struct Node: Equatable, Sendable {
    let name: String
    var amount: Double
    let hex: String
    /// Subcategory totals ("Parent > Sub" overrides), for the branch stage.
    var subs: [CashflowMonth.Sub]? = nil
  }

  /// MonthVM.
  struct Month: Equatable, Sendable {
    let key: String
    let label: String
    /// Income sources, then a "Savings" drawdown if in deficit.
    let inflow: [Node]
    /// Spend categories, then a "To savings" surplus.
    let outflow: [Node]
    let incomeTotal: Double
    let spendTotal: Double
    /// max(incomeTotal, spendTotal).
    var hubTotal: Double { max(incomeTotal, spendTotal) }
    /// Net pulled from savings (< 0 = added): the web's `drawn`.
    var drawn: Double { spendTotal - incomeTotal }
  }

  /// Keeps the `top` largest items and folds the rest into `otherName`,
  /// re-sorted largest first.
  static func foldTail(_ items: [Node], top: Int, otherName: String, otherHex: String) -> [Node] {
    guard items.count > top else { return items }
    var head = Array(items.prefix(top))
    let tail = items.dropFirst(top).reduce(0) { $0 + $1.amount }
    if let i = head.firstIndex(where: { $0.name == otherName }) {
      head[i].amount += tail
    } else {
      head.append(Node(name: otherName, amount: tail, hex: otherHex))
    }
    return head.sorted { $0.amount > $1.amount }
  }

  static func month(_ m: CashflowMonth) -> Month {
    let income = foldTail(
      m.income.map { Node(name: $0.source, amount: $0.amount, hex: CategoryColors.income) },
      top: topIncome, otherName: "Other income", otherHex: CategoryColors.income)
    let spend = foldTail(
      m.spend.map {
        Node(name: $0.category, amount: $0.amount, hex: CategoryColors.hex(for: $0.category), subs: $0.subs)
      },
      top: topSpend, otherName: "Other", otherHex: CategoryColors.hex(for: "Other"))
    let incomeTotal = income.reduce(0) { $0 + $1.amount }
    let spendTotal = spend.reduce(0) { $0 + $1.amount }
    let draw = max(0, spendTotal - incomeTotal)
    let surplus = max(0, incomeTotal - spendTotal)
    return Month(
      key: m.key,
      label: m.label,
      inflow: draw > 0 ? income + [Node(name: "Savings", amount: draw, hex: CategoryColors.draw)] : income,
      outflow: surplus > 0
        ? spend + [Node(name: "To savings", amount: surplus, hex: CategoryColors.saved)] : spend,
      incomeTotal: incomeTotal,
      spendTotal: spendTotal)
  }

  /// truncate: "Entertainm…" past `max` characters.
  static func truncate(_ s: String, _ max: Int) -> String {
    s.count > max ? String(s.prefix(max - 1)) + "…" : s
  }

  /// The narrow month label: "Jun 2026" → "Jun '26".
  static func shortLabel(_ label: String) -> String {
    guard let r = label.range(of: " 20") else { return label }
    return label.replacingCharacters(in: r, with: " '")
  }
}
