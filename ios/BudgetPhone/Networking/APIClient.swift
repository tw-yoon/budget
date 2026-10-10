import Foundation

enum APIError: Error, Equatable, Sendable {
  /// No server address saved yet.
  case notConfigured
  /// The request never got an HTTP answer: wrong address, Mac asleep, off
  /// the home network.
  case unreachable(String)
  /// A non-2xx answer. `message` is the route's `{ error }` when it sent one.
  case server(status: Int, message: String)
  /// A 2xx answer whose body didn't match the models.
  case decoding(String)
  /// The request was cancelled (the view disappeared, or a newer request
  /// superseded it) rather than actually failing. Never shown to the user:
  /// callers are expected to treat it as a silent no-op.
  case cancelled
  /// 401: the access token is missing, wrong, or was reset on the Mac.
  case unauthorized

  /// Plain-language reason, safe to show as is.
  var message: String {
    if isUnreachable { return Self.unreachableMessage }
    switch self {
    case .notConfigured: return "No server is set."
    case .unreachable: return Self.unreachableMessage
    case .server(_, let m): return m
    case .decoding(let m): return "Unexpected response from the server. \(m)"
    case .cancelled: return "Cancelled."
    case .unauthorized: return "The server rejected the access token. Paste the current one in Settings → Server."
    }
  }

  static let unreachableMessage =
    "Can't reach your Mac. Check that Tailscale is on and the Mac is awake with Budget running."

  /// The phone got no answer from Budget. 502-504 come from Tailscale's
  /// proxy on the Mac when Budget isn't running; Budget never sends them.
  var isUnreachable: Bool {
    switch self {
    case .unreachable: true
    case .server(let status, _): [502, 503, 504].contains(status)
    default: false
    }
  }

  /// The system's or server's own text behind an unreachable failure, for
  /// small print. Nil for every other kind.
  var detail: String? {
    switch self {
    case .unreachable(let m): m
    case .server(_, let m) where isUnreachable: m
    default: nil
    }
  }

  /// One line over data that is still showing after a failed load.
  var loadBanner: String {
    if isUnreachable { return "Showing saved data — can't reach your Mac." }
    if self == .unauthorized {
      return "Showing saved data — access token not accepted. Re-enter it in Settings → Server."
    }
    return message
  }
}

/// Calls against the web app's own API. The Accounts calls live here; each
/// other screen adds its own in an `APIClient+<Screen>.swift` extension,
/// all going through `send`, `encode` and `decode` below.
struct APIClient: Sendable {
  let baseURL: URL
  var session: URLSession = .shared
  var token: String? = nil
  var cache: ResponseCache? = nil
  var loadTimes: LoadTimes? = nil

  /// The saved server with the saved token; nil until a server is set.
  static func saved() -> APIClient? {
    ServerAddress.saved().map {
      APIClient(baseURL: $0, token: AccessToken.saved(), cache: .shared, loadTimes: .shared)
    }
  }

  func accounts() async throws(APIError) -> AccountsResponse {
    try await get("api/accounts", timeout: 15, saveAs: "accounts")
  }

  /// The accounts last saved, for the next launch to show before the server answers.
  func savedAccounts() -> AccountsResponse? { saved("accounts", "api/accounts") }

  /// When `savedAccounts()` was saved.
  func savedAccountsDate() -> Date? {
    cache?.date("accounts", request: cacheRequest("api/accounts", []), owner: owner)
  }

  /// Calls Plaid once per linked bank, hence the long timeout. A bank that
  /// fails comes back in `errors`; the call itself still succeeds.
  func refreshBalances() async throws(APIError) -> RefreshResult {
    try decode(await send("POST", "api/plaid/refresh-balances", body: Data("{}".utf8), timeout: 60))
  }

  func updateAccount(id: String, patch: AccountPatch) async throws(APIError) {
    _ = try await send("PATCH", "api/accounts/\(id)", body: encode(patch), timeout: 15)
  }

  private struct ErrorBody: Decodable { let error: String }

  /// `CancellationError` doesn't always survive the trip through
  /// `URLProtocolClient`'s Objective-C bridging with its native type intact
  /// — it can come back as a plain `NSError` in `Swift.CancellationError`'s
  /// domain instead. Check both forms, plus the `URLError` iOS itself uses
  /// when it cancels the underlying task.
  private static func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError { return true }
    if let urlError = error as? URLError, urlError.code == .cancelled { return true }
    let nsError = error as NSError
    return nsError.domain == "Swift.CancellationError"
  }

  /// The address a request goes to. The cache keys on it, so what is saved
  /// matches what was sent.
  func url(_ path: String, query: [URLQueryItem] = []) -> URL {
    var url = baseURL.appending(path: path)
    if !query.isEmpty {
      url.append(queryItems: query)
      // URLComponents leaves "+" bare, and the server's URLSearchParams reads
      // a bare "+" as a space ("Snacks + Treats" would arrive as "Snacks   Treats").
      if var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
        components.percentEncodedQuery = components.percentEncodedQuery?
          .replacingOccurrences(of: "+", with: "%2B")
        url = components.url ?? url
      }
    }
    return url
  }

  /// Server and token, as the cache's owner. Hashed there, never stored.
  private var owner: String { baseURL.absoluteString + "\n" + (token ?? "") }

  /// Path plus query: what tells one saved answer from another.
  private func cacheRequest(_ path: String, _ query: [URLQueryItem]) -> String {
    let built = url(path, query: query)
    let q = URLComponents(url: built, resolvingAgainstBaseURL: false)?.percentEncodedQuery
    return built.path + (q.map { "?" + $0 } ?? "")
  }

  /// A GET that decodes, then — only once it decoded — saves the bytes under
  /// `saveAs` for `saved(_:_:query:)` to show at the next launch. Its timing
  /// goes to `loadTimes`. `saveIf`, when given, is asked as the answer
  /// arrives, for a save that depends on what the user did meanwhile.
  func get<T: Decodable>(
    _ path: String, query: [URLQueryItem] = [], timeout: TimeInterval, saveAs name: String? = nil,
    saveIf shouldSave: (@Sendable () -> Bool)? = nil
  ) async throws(APIError) -> T {
    let clock = ContinuousClock()
    let start = clock.now
    let (status, data, response) = try await exchange("GET", path, query: query, body: nil, timeout: timeout)
    guard (200..<300).contains(status) else { throw Self.serverError(status: status, data: data) }
    let received = clock.now
    let value: T = try decode(data)
    loadTimes?.record(LoadTime(
      date: .now, path: path, request: (received - start).milliseconds,
      server: LoadTimes.serverMilliseconds(response.value(forHTTPHeaderField: "Server-Timing")),
      reading: (clock.now - received).milliseconds))
    if let name, shouldSave?() ?? true { save(data, as: name, path, query: query) }
    return value
  }

  /// Keeps `data` as the saved answer to a GET of `path`, for a write whose
  /// result the next launch should open with.
  func save(_ data: Data, as name: String, _ path: String, query: [URLQueryItem] = []) {
    cache?.write(data, name: name, request: cacheRequest(path, query), owner: owner)
  }

  /// The answer last saved for exactly this request, or nil. Bytes that no
  /// longer decode count as nothing saved.
  func saved<T: Decodable>(_ name: String, _ path: String, query: [URLQueryItem] = []) -> T? {
    guard
      let data = cache?.read(name, request: cacheRequest(path, query), owner: owner)
    else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  /// The request itself: any HTTP status comes back with its body, for the
  /// few routes whose non-2xx bodies carry more than `{ error }` (a
  /// category merge prompt, a delete refused in use).
  func sendRaw(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
    timeout: TimeInterval
  ) async throws(APIError) -> (status: Int, data: Data) {
    let (status, data, _) = try await exchange(method, path, query: query, body: body, timeout: timeout)
    return (status, data)
  }

  /// `sendRaw`, keeping the response for its headers.
  private func exchange(
    _ method: String, _ path: String, query: [URLQueryItem], body: Data?, timeout: TimeInterval
  ) async throws(APIError) -> (status: Int, data: Data, response: HTTPURLResponse) {
    let url = url(path, query: query)
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      if Self.isCancellation(error) { throw .cancelled }
      throw .unreachable(error.localizedDescription)
    }

    guard let http = response as? HTTPURLResponse else {
      throw .unreachable("No HTTP response.")
    }
    return (http.statusCode, data, http)
  }

  func send(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
    timeout: TimeInterval
  ) async throws(APIError) -> Data {
    let (status, data) = try await sendRaw(method, path, query: query, body: body, timeout: timeout)
    guard (200..<300).contains(status) else { throw Self.serverError(status: status, data: data) }
    return data
  }

  /// A non-2xx answer as `.server`, with the route's `{ error }` when it sent one.
  static func serverError(status: Int, data: Data) -> APIError {
    if status == 401 { return .unauthorized }
    let message =
      (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
      ?? HTTPURLResponse.localizedString(forStatusCode: status)
    return .server(status: status, message: message)
  }

  func decode<T: Decodable>(_ data: Data) throws(APIError) -> T {
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw .decoding(String(describing: error))
    }
  }

  func encode<T: Encodable>(_ value: T) throws(APIError) -> Data {
    do { return try JSONEncoder().encode(value) } catch {
      throw .decoding(error.localizedDescription)
    }
  }
}
