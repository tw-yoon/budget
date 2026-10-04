import SwiftUI

/// The full-screen failure of a load with nothing to show: what went wrong
/// in plain language, what to check, and Retry (see `ConnectionProblem`).
struct ErrorView: View {
  let error: APIError
  let server: String
  let retry: () -> Void

  private var problem: ConnectionProblem { ConnectionProblem(error) }

  var body: some View {
    ContentUnavailableView {
      Label(problem.title, systemImage: problem.systemImage)
    } description: {
      VStack(spacing: 12) {
        Text(problem.message)
        if !problem.steps.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(problem.steps.enumerated()), id: \.offset) { index, step in
              HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(index + 1).").monospacedDigit()
                Text(step).fixedSize(horizontal: false, vertical: true)
              }
            }
          }
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        if error.isUnreachable || error == .notConfigured {
          VStack(spacing: 4) {
            Text(server)
            if let detail = error.detail { Text(detail) }
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
      }
    } actions: {
      Button("Retry", action: retry).buttonStyle(.borderedProminent)
    }
  }
}
