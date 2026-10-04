import Foundation

/// What the full-screen error shows for a failed load, in plain language
/// (../docs/superpowers/specs/2026-10-04-ios-cant-reach-mac-design.md).
struct ConnectionProblem: Equatable {
  let title: String
  let systemImage: String
  let message: String
  /// Numbered by the view; empty unless the person has things to check.
  let steps: [String]

  init(_ error: APIError) {
    if error.isUnreachable || error == .notConfigured {
      title = "Can't Reach Your Mac"
      systemImage = "wifi.exclamationmark"
      message = "Budget on this iPhone can't connect to your Mac. Check these, then tap Retry:"
      steps = [
        "Tailscale is on — open the Tailscale app on this iPhone and turn it on.",
        "Your Mac is on and awake.",
        "Budget is running on your Mac.",
      ]
    } else if error == .unauthorized {
      title = "Access Token Needed"
      systemImage = "key"
      message =
        "Your Mac didn't accept this iPhone's access token. Go to Settings → Server and paste the current token. You'll find it on the Mac in Budget's Settings → Remote Access."
      steps = []
    } else {
      title = "Something Went Wrong"
      systemImage = "exclamationmark.triangle"
      message = error.message
      steps = []
    }
  }
}
