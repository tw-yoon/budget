import SwiftUI

/// Benefits → Cards → To Review: credit-like transactions the app couldn't
/// place on a perk by itself. Each answer is a yes for one perk or "not a
/// perk" (PUT /api/perk-credits/:id).
struct PerkReviewView: View {
  let store: BenefitsStore
  @State private var choosing: PerkQuestionDTO?
  @State private var saveError: String?

  var body: some View {
    List {
      ForEach(store.questions) { q in
        let perks = store.card(id: q.cardId)?.benefits ?? []
        let suggested = perks.first { $0.id == q.suggestedBenefitId }
        Section {
          PerkRow(
            name: q.name, detail: "\(Formatters.day(q.date)) · \(q.cardName)",
            amount: Ledger.signedAmount(-q.amount).text)
          if let suggested {
            Button(suggested.name) { write(.decidePerk(transactionId: q.id, .yes(benefitId: suggested.id))) }
          }
          Button("Other Perk…") { choosing = q }
          Button("Not a Perk") { write(.decidePerk(transactionId: q.id, .notAPerk)) }
        } footer: {
          if let note = CardRules.questionNote(q, perk: suggested) { Text(note) }
        }
      }
    }
    .disabled(store.isSaving)
    .listStyle(.insetGrouped)
    .tabBarScrollTracking()
    .overlay {
      if store.questions.isEmpty {
        ContentUnavailableView("Nothing to Review", systemImage: "checkmark.circle")
      }
    }
    .navigationTitle("To Review")
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await store.load() }
    .confirmationDialog(
      "Other Perk",
      isPresented: Binding(get: { choosing != nil }, set: { if !$0 { choosing = nil } }),
      presenting: choosing
    ) { q in
      // Flat-value perks count by switch; the server refuses a "yes" for them.
      ForEach((store.card(id: q.cardId)?.benefits ?? []).filter { $0.autoMode != "perk" }) { perk in
        Button(perk.name) { write(.decidePerk(transactionId: q.id, .yes(benefitId: perk.id))) }
      }
    }
    .alert(
      "Couldn't Save",
      isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })
    ) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(saveError ?? "")
    }
  }

  private func write(_ write: CardWrite) {
    Task {
      do throws(APIError) {
        try await store.perform(write)
      } catch {
        if error != .cancelled { saveError = error.message }
      }
    }
  }
}
