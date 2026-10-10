import Foundation

// Settings → Categories (../src/app/api/categories/**). Each body carries
// only its own fields, exactly as SettingsCategories.tsx sends them.

private struct NameBody: Encodable { let name: String }
private struct RenameBody: Encodable {
  let name: String
  let allowMerge: Bool
}
private struct PrimariesBody: Encodable { let plaidPrimaries: [String] }
private struct SubRenameBody: Encodable {
  let from: String
  let to: String
  let allowMerge: Bool
}
private struct MergeFlag: Decodable { let merge: Bool? }
private struct InUseBody: Decodable {
  let transactionCount: Int
  let ruleCount: Int
  let mappingCount: Int
  let splitCount: Int
}

extension APIClient {
  /// GET /api/categories — the list with counts, Plaid's primaries, and
  /// the primaries no category maps.
  func categoriesAdmin() async throws(APIError) -> CategoriesAdminResponse {
    try await get("api/categories", timeout: 15, saveAs: "categories")
  }

  /// The categories last saved — by this screen or the ledger's pickers,
  /// which read the same answer — for the next open.
  func savedCategories() -> CategoriesAdminResponse? { saved("categories", "api/categories") }

  /// POST /api/categories — `{ name }`.
  func createCategory(name: String) async throws(APIError) {
    _ = try await send("POST", "api/categories", body: encode(NameBody(name: name)), timeout: 15)
  }

  /// PATCH /api/categories/:id — `{ name, allowMerge }`. Renaming onto an
  /// existing name is answered with a merge prompt until `allowMerge` is true.
  func renameCategory(id: String, name: String, allowMerge: Bool) async throws(APIError) -> RenameOutcome {
    try await rename(
      "api/categories/\(id)", body: encode(RenameBody(name: name, allowMerge: allowMerge)))
  }

  /// PATCH /api/categories/:id — `{ plaidPrimaries }`, the full new list.
  func setPlaidPrimaries(id: String, _ primaries: [String]) async throws(APIError) {
    _ = try await send(
      "PATCH", "api/categories/\(id)", body: encode(PrimariesBody(plaidPrimaries: primaries)),
      timeout: 15)
  }

  /// DELETE /api/categories/:id — refused while in use, with the counts
  /// that explain why.
  func deleteCategory(id: String) async throws(APIError) {
    let (status, data) = try await sendRaw("DELETE", "api/categories/\(id)", timeout: 30)
    if (200..<300).contains(status) { return }
    if status == 409, let u = try? JSONDecoder().decode(InUseBody.self, from: data) {
      throw .server(
        status: 409,
        message: CategoryRules.stillUsed(
          transactions: u.transactionCount, rules: u.ruleCount, mappings: u.mappingCount,
          splits: u.splitCount))
    }
    throw Self.serverError(status: status, data: data)
  }

  /// POST /api/categories/:id/subcategories — `{ name }`.
  func createSubcategory(categoryId: String, name: String) async throws(APIError) {
    _ = try await send(
      "POST", "api/categories/\(categoryId)/subcategories", body: encode(NameBody(name: name)),
      timeout: 15)
  }

  /// PATCH /api/categories/:id/subcategories — `{ from, to, allowMerge }`,
  /// the same merge handshake as a category rename.
  func renameSubcategory(
    categoryId: String, from: String, to: String, allowMerge: Bool
  ) async throws(APIError) -> RenameOutcome {
    try await rename(
      "api/categories/\(categoryId)/subcategories",
      body: encode(SubRenameBody(from: from, to: to, allowMerge: allowMerge)))
  }

  /// DELETE /api/categories/:id/subcategories?name=… — what used it falls
  /// back to the bare category; renamed Plaid labels get Plaid's name back.
  func deleteSubcategory(categoryId: String, name: String) async throws(APIError) -> SubcategoryDeleteResult {
    try decode(
      await send(
        "DELETE", "api/categories/\(categoryId)/subcategories",
        query: [URLQueryItem(name: "name", value: name)], timeout: 30))
  }

  private func rename(_ path: String, body: Data) async throws(APIError) -> RenameOutcome {
    let (status, data) = try await sendRaw("PATCH", path, body: body, timeout: 30)
    if (200..<300).contains(status) { return .done(try decode(data)) }
    if status == 409, (try? JSONDecoder().decode(MergeFlag.self, from: data))?.merge == true {
      return .needsMerge(try decode(data))
    }
    throw Self.serverError(status: status, data: data)
  }
}
