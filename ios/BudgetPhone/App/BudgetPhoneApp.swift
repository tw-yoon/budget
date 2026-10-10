import SwiftUI

@main
struct BudgetPhoneApp: App {
  init() {
    // Before RootView reads the server, so a handed-over one skips setup.
    SetupHandoff.apply(environment: ProcessInfo.processInfo.environment)
  }

  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}
