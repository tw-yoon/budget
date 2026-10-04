/// The five tabs, in the bar's order.
enum AppTab: CaseIterable, Hashable {
  case accounts, activity, analytics, benefits, settings

  var title: String {
    switch self {
    case .accounts: "Accounts"
    // "Activity", not "Transactions": the long label made the tab bar uneven.
    case .activity: "Activity"
    case .analytics: "Analytics"
    case .benefits: "Benefits"
    case .settings: "Settings"
    }
  }

  var systemImage: String {
    switch self {
    case .accounts: "building.columns"
    case .activity: "list.bullet.rectangle"
    case .analytics: "chart.pie"
    case .benefits: "creditcard"
    case .settings: "gear"
    }
  }
}
