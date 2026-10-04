import Testing
@testable import BudgetPhone

/// The signal Settings sends the Activity tab when transaction categories change.
@MainActor
struct DataChangesTests {
  @Test func eachChangeBumpsTheVersion() {
    let changes = DataChanges()
    #expect(changes.categoriesVersion == 0)
    changes.categoriesChanged()
    changes.categoriesChanged()
    #expect(changes.categoriesVersion == 2)
    changes.accountsChanged()
    #expect(changes.accountsVersion == 1)
    #expect(changes.categoriesVersion == 2)
  }
}
