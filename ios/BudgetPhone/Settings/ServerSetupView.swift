import SwiftUI

/// Shown until a server is saved. Saving one swaps RootView over to the tabs.
struct ServerSetupView: View {
  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text("Budget on your iPhone reads and edits the same data as Budget on your Mac. Enter the address of the Mac that runs it and its access token.")
            .foregroundStyle(.secondary)
        }
        ServerForm()
      }
      .navigationTitle("Connect to Budget")
    }
  }
}
