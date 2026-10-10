import Foundation

/// GET /api/update — `UpdateStatusDTO` in ../src/types/index.ts.
struct UpdateStatus: Codable, Equatable, Sendable {
  var version: String
  var latest: String?
  var available: Bool
  var canUpdate: Bool
  var updating: Bool
  var failed: String?
  var checkedAt: String
}

/// Where an Install stands after one poll — `pollOutcome` in ../src/lib/update-poll.ts.
/// Done is the update's end without a failure, not a version change (a release
/// may ship without a bump); POST writes the state files before it answers.
enum UpdatePoll: Equatable {
  case waiting, done, failed(String)

  static func outcome(_ s: UpdateStatus?) -> UpdatePoll {
    guard let s else { return .waiting }
    if let failed = s.failed { return .failed(failed) }
    if !s.updating { return .done }
    return .waiting
  }
}

/// GET /api/update/phone — `PhoneUpdateStatusDTO` in ../src/types/index.ts.
struct PhoneUpdateStatus: Codable, Equatable, Sendable {
  var available: Bool
  var installing: Bool
  var failed: String?
  var lastInstalled: String?
}
