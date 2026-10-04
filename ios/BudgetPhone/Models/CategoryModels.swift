import Foundation

// Mirrors of GET /api/categories and the category write routes
// (../src/app/api/categories/**). The ledger's pickers keep their own slim
// `CategoriesResponse`; these carry what Settings → Categories edits.

struct CategoriesAdminResponse: Decodable, Equatable, Sendable {
  let categories: [AdminCategory]
  let primaries: [String]
  /// Real Plaid primaries in use that no category maps. The web reads it
  /// with `?? []`, so a server without it decodes as empty.
  let unmappedPrimaries: [UnmappedPrimary]

  init(categories: [AdminCategory], primaries: [String], unmappedPrimaries: [UnmappedPrimary]) {
    self.categories = categories
    self.primaries = primaries
    self.unmappedPrimaries = unmappedPrimaries
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    categories = try c.decode([AdminCategory].self, forKey: .categories)
    primaries = try c.decode([String].self, forKey: .primaries)
    unmappedPrimaries = try c.decodeIfPresent([UnmappedPrimary].self, forKey: .unmappedPrimaries) ?? []
  }

  private enum CodingKeys: String, CodingKey { case categories, primaries, unmappedPrimaries }
}

struct AdminCategory: Decodable, Equatable, Sendable, Identifiable {
  let id: String
  let name: String
  let plaidPrimaries: [String]
  let transactionCount: Int
  let ruleCount: Int
  let resolvedTransactionCount: Int
  let subcategories: [AdminSubcategory]
  let splitCount: Int
}

struct AdminSubcategory: Decodable, Equatable, Sendable, Identifiable {
  struct PlaidLabel: Decodable, Equatable, Sendable {
    let code: String
    let name: String
  }
  let name: String
  let declared: Bool
  let transactionCount: Int
  let ruleCount: Int
  let plaidLabels: [PlaidLabel]
  let plaidTransactionCount: Int
  let renamed: Bool

  /// Unique within its category; the routes address a sub by name too.
  var id: String { name }
}

struct UnmappedPrimary: Decodable, Equatable, Sendable {
  let pfcPrimary: String
  let transactionCount: Int
}

/// A rename's 2xx body (category or subcategory).
struct RenameResult: Decodable, Equatable, Sendable {
  let merged: Bool
  let movedTransactions: Int
  let movedSplits: Int
}

/// A rename's 409 `merge: true` body: the server found the new name taken
/// and asks before moving anything. Only the category route sends
/// `movingResolved` and `movingSplits`.
struct MergePrompt: Decodable, Equatable, Sendable {
  let targetName: String
  let movingTransactions: Int
  let movingRules: Int
  let movingResolved: Int?
  let movingSplits: Int?
}

enum RenameOutcome: Equatable, Sendable {
  case done(RenameResult)
  case needsMerge(MergePrompt)
}

struct SubcategoryDeleteResult: Decodable, Equatable, Sendable {
  let movedTransactions: Int
  let movedSplits: Int
  let resetPlaidLabels: Int
}
