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

  private func save() {
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
