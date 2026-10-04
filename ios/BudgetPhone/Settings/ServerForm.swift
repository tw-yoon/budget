import SwiftUI

/// The server field and its Test Connection button, shared by first-launch
/// setup and Settings. Saves only an address that parses.
struct ServerForm: View {
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var draft = ""
  @State private var tokenDraft = ""
  @State private var testResult: Result<Int, APIError>?
  @State private var testing = false

  var body: some View {
    Section {
      TextField("https://your-mac.your-tailnet.ts.net", text: $draft)
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onSubmit(save)
      SecureField("Access token", text: $tokenDraft)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .textContentType(.password)
        .onSubmit(save)
      Button(testing ? "Testing…" : "Save and Test Connection", action: saveAndTest)
        .disabled(ServerAddress.normalize(draft) == nil || testing)
        .tint(.primary)
      if let testResult {
        switch testResult {
        case .success(let count):
          Label("Connected — \(count) accounts", systemImage: "checkmark.circle.fill")
            .foregroundStyle(.green)
        case .failure(let error):
          Label(error.message, systemImage: "xmark.circle.fill")
            .foregroundStyle(.red)
        }
      }
    } header: {
      Text("Server")
    } footer: {
      Text(
        "The Mac's https:// address ending in .ts.net, with no port. Budget only accepts connections through Tailscale, so keep Tailscale connected, at home too. The access token is on the Mac, in Budget's web Settings → Remote Access."
      )
    }
    .onAppear {
      draft = server
      tokenDraft = AccessToken.saved() ?? ""
    }
  }

  /// True when the server address or token differs from what was saved, so
  /// the saved data belongs to someone else's server. Compares the cleaned-up
  /// forms, so stray spaces or a trailing slash don't count as a change.
  static func changed(oldServer: String, oldToken: String?, newServer: String, newToken: String) -> Bool {
    func clean(_ s: String) -> String { ServerAddress.normalize(s)?.absoluteString ?? "" }
    return clean(oldServer) != clean(newServer)
      || (AccessToken.normalize(oldToken ?? "") ?? "") != (AccessToken.normalize(newToken) ?? "")
  }

  private func save() {
    // An address that doesn't parse isn't saved, so it can't count as a change.
    let newServer = ServerAddress.normalize(draft)?.absoluteString ?? server
    // Reading never crosses owners; this also removes the old files from disk.
    if Self.changed(oldServer: server, oldToken: AccessToken.saved(), newServer: newServer, newToken: tokenDraft) {
      ResponseCache.shared.clear()
    }
    if let url = ServerAddress.normalize(draft) {
      server = url.absoluteString
      draft = server
    }
    AccessToken.save(tokenDraft)
  }

  private func saveAndTest() {
    guard let url = ServerAddress.normalize(draft) else { return }
    testing = true
    Task {
      defer { testing = false }
      do throws(APIError) {
        let response = try await APIClient(baseURL: url, token: AccessToken.normalize(tokenDraft)).accounts()
        testResult = .success(response.summary.accountCount)
        save()
      } catch {
        testResult = .failure(error)
      }
    }
  }
}
