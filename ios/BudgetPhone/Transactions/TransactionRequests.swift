import Foundation

// Request bodies for the Transactions writes, each exactly what the web
// sends (TransactionTable.tsx, TransactionLinkPicker.tsx, P2pCategorizer.tsx).

/// PATCH /api/transactions/:id — set a category, or `reset` to Plaid's.
struct CategoryUpdate: Encodable, Equatable, Sendable {
  let category: String?
  let subcategory: String?
  /// `{ category: null }` — the web's Reset. The server clears the override.
  static let reset = CategoryUpdate(category: nil, subcategory: nil)

  static func set(_ category: String, subcategory: String?) -> CategoryUpdate {
    let sub = subcategory?.trimmingCharacters(in: .whitespaces)
    return CategoryUpdate(category: category, subcategory: (sub?.isEmpty ?? true) ? nil : sub)
  }

  private enum CodingKeys: String, CodingKey { case category, subcategory }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(category, forKey: .category)  // null on reset
    if category != nil { try c.encode(subcategory, forKey: .subcategory) }
  }
}

/// PATCH /api/transactions/:id — `linkedToLabel: null` unlinks.
struct LinkUpdate: Encodable, Equatable, Sendable {
  let linkedToLabel: Int?

  private enum CodingKeys: String, CodingKey { case linkedToLabel }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(linkedToLabel, forKey: .linkedToLabel)  // explicit null
  }
}

/// POST /api/transactions/:id/splits.
struct NewSplit: Encodable, Equatable, Sendable {
  let amount: Double
  let category: String
  let subcategory: String?

  init(amount: Double, category: String, subcategory: String?) {
    self.amount = amount
    self.category = category
    let sub = subcategory?.trimmingCharacters(in: .whitespaces)
    self.subcategory = (sub?.isEmpty ?? true) ? nil : sub
  }

  private enum CodingKeys: String, CodingKey { case amount, category, subcategory }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(amount, forKey: .amount)
    try c.encode(category, forKey: .category)
    try c.encode(subcategory, forKey: .subcategory)  // explicit null
  }
}
