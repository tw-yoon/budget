import Foundation
import Testing
@testable import BudgetPhone

enum TestData {
  /// The invented response in Fixtures/accounts.json.
  static func accountsJSON() throws -> Data {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: "accounts", withExtension: "json"))
    return try Data(contentsOf: url)
  }

  static func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json"))
    return try Data(contentsOf: url)
  }

  /// The invented ledger page in Fixtures/transactions.json: a split with a
  /// shrunk remainder, a linked refund, the purchase it refunds, a Venmo
  /// cash-out with a breakdown, and a pending Zelle payment.
  static func transactions() throws -> TransactionsResponse {
    try JSONDecoder().decode(TransactionsResponse.self, from: fixture("transactions"))
  }

  static func transaction(_ id: String) throws -> TransactionDTO {
    try #require(transactions().transactions.first { $0.id == id })
  }

  /// A ledger page of copies of the fixture's first row, one per id, as the
  /// JSON the server would send.
  static func ledgerPage(_ ids: [String], page: Int, totalPages: Int, total: Int? = nil) throws -> Data {
    let root = try #require(
      JSONSerialization.jsonObject(with: fixture("transactions")) as? [String: Any])
    let template = try #require((root["transactions"] as? [[String: Any]])?.first)
    let rows = ids.map { id -> [String: Any] in
      var row = template
      row["id"] = id
      return row
    }
    return try JSONSerialization.data(withJSONObject: [
      "transactions": rows, "page": page, "limit": 50,
      "total": total ?? ids.count, "totalPages": totalPages,
    ])
  }

  /// The `page` query item of a stubbed request, for handlers that answer
  /// per page.
  static func page(of request: URLRequest) -> Int {
    let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
    return items.first { $0.name == "page" }.flatMap { $0.value.flatMap(Int.init) } ?? 0
  }

  static func query(of request: URLRequest, _ name: String) -> String? {
    URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == name }?.value
  }

  static func accounts() throws -> AccountsResponse {
    try JSONDecoder().decode(AccountsResponse.self, from: accountsJSON())
  }

  /// A credit account with every due-date field at a neutral default.
  static func card(
    manualDueDay: Int? = nil,
    nextPaymentDueDate: String? = nil,
    minimumPaymentAmount: Double? = nil,
    paymentIsOverdue: Bool? = nil,
    displayName: String? = nil,
    manualCreditLimit: Double? = nil,
    type: String = "CREDIT"
  ) -> AccountDTO {
    AccountDTO(
      id: "card", name: "Sample Card", officialName: nil, mask: "0002", type: type,
      subtype: "credit card", currentBalance: 100, availableBalance: 900,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Sample Card Co",
      isLiability: type == "CREDIT", nextPaymentDueDate: nextPaymentDueDate,
      lastStatementBalance: nil, minimumPaymentAmount: minimumPaymentAmount,
      paymentIsOverdue: paymentIsOverdue, displayName: displayName,
      manualDueDay: manualDueDay, manualCreditLimit: manualCreditLimit)
  }
}

extension TestData {
  /// One card as the server sends it, every field present, with invented
  /// values and no credits, rates or earnings.
  static func cardJSON(id: String, last4: String = "0001", name: String = "Gold", artUrl: String? = nil) -> String {
    let art = artUrl.map { "\"\($0)\"" } ?? "null"
    return #"{"id":"\#(id)","issuer":"AMEX","name":"\#(name)","last4":"\#(last4)","membershipStartYear":2024,"membershipStartMonth":null,"annualFee":0,"pointValueCents":1,"artUrl":\#(art),"linked":false,"linkedAccountName":null,"displayName":null,"benefits":[],"benefitCount":0,"benefitsUsedCount":0,"creditsYtd":0,"creditsAnnualMax":0,"rewardRates":[],"earnings":null,"earningsPeriodLabel":"Jan 2026 – Dec 2026"}"#
  }

  /// The invented cards in Fixtures/user-cards.json.
  static func userCards() throws -> [UserCardDTO] {
    try JSONDecoder().decode(UserCardsResponse.self, from: fixture("user-cards")).cards
  }
}

private final class BundleToken {}

/// Every suite that uses StubURLProtocol nests in here. `.serialized` on a
/// parent runs its child suites one at a time as well; without it, two
/// stubbed suites run side by side and answer each other's requests through
/// the one shared handler.
@Suite(.serialized) enum StubbedNetworkTests {}

/// Answers URLSession requests from a handler instead of the network, and
/// records what was sent. Tests that use it are `.serialized`, since the
/// handler is shared.
final class StubURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
  nonisolated(unsafe) static var requests: [URLRequest] = []
  nonisolated(unsafe) static var gates: [Gate] = []

  /// `gates` hold back the requests they match until the test opens them.
  static func session(
    _ handler: @escaping (URLRequest) throws -> (Int, Data), gates: [Gate] = []
  ) -> URLSession {
    self.handler = handler
    self.gates = gates
    requests = []
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return URLSession(configuration: config)
  }

  /// URLSession moves the body into a stream before it reaches a protocol.
  static func body(of request: URLRequest) -> Data? {
    if let data = request.httpBody { return data }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let n = stream.read(&buffer, maxLength: buffer.count)
      if n <= 0 { break }
      data.append(buffer, count: n)
    }
    return data
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.append(request)
    guard let gate = Self.gates.first(where: { $0.claim(request) }) else { return respond() }
    // Wait off the loading thread, so other requests keep being answered,
    // then answer on that thread's run loop, as URLProtocol expects.
    nonisolated(unsafe) let runLoop = CFRunLoopGetCurrent()!
    nonisolated(unsafe) let stub = self
    DispatchQueue.global().async {
      gate.hold()
      CFRunLoopPerformBlock(runLoop, CFRunLoopMode.commonModes.rawValue) { stub.respond() }
      CFRunLoopWakeUp(runLoop)
    }
  }

  private func respond() {
    do {
      let (status, data) = try Self.handler!(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}

/// Holds back the first stubbed request that matches, so a test can act
/// while that request is in flight: `await arrival()`, act, then `open()`.
final class Gate: @unchecked Sendable {
  private let matches: (URLRequest) -> Bool
  private let condition = NSCondition()
  private var claimed = false
  private var arrived = false
  private var isOpen = false

  init(_ matches: @escaping (URLRequest) -> Bool) { self.matches = matches }

  /// True once, for the first matching request.
  func claim(_ request: URLRequest) -> Bool {
    condition.lock()
    defer { condition.unlock() }
    guard !claimed, matches(request) else { return false }
    claimed = true
    return true
  }

  /// Called for the held request: marks it arrived and waits for `open`.
  func hold() {
    condition.lock()
    arrived = true
    while !isOpen { condition.wait() }
    condition.unlock()
  }

  func open() {
    condition.lock()
    isOpen = true
    condition.broadcast()
    condition.unlock()
  }

  private var hasArrived: Bool {
    condition.lock()
    defer { condition.unlock() }
    return arrived
  }

  /// Returns once the held request has reached the stub.
  func arrival() async {
    let deadline = ContinuousClock.now + .seconds(5)
    while !hasArrived {
      if ContinuousClock.now > deadline {
        Issue.record("the gated request never arrived")
        return
      }
      try? await Task.sleep(for: .milliseconds(1))
    }
  }
}
