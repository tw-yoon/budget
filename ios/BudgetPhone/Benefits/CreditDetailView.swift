import SwiftUI

/// One statement credit (BenefitRow and YearStrip in
/// ../src/components/benefits/UserCardItem.tsx): its progress, the credits
/// placed in each window with the purchase each paid back, the perk switch, a
/// logged amount, the keywords credits match on, the year's windows, and Delete.
struct CreditDetailView: View {
  let cardId: String
  let id: String
  let store: BenefitsStore

  @Environment(\.dismiss) private var dismiss
  @State private var usedText = ""
  @State private var confirmingDelete = false
  @State private var saveError: String?
  @State private var picking: PerkPickerSheet.Kind?
  /// The keyword alert: open, which row it edits (nil adds one), and its text.
  @State private var keywordAlert = false
  @State private var keywordIndex: Int?
  @State private var keywordText = ""
  @FocusState private var usedFocused: Bool

  private var benefit: BenefitDTO? {
    store.card(id: cardId)?.benefits.first { $0.id == id }
  }

  var body: some View {
    Group {
      if let benefit {
        list(benefit)
      } else {
        ContentUnavailableView("No Credit", systemImage: "creditcard")
          .onAppear { dismiss() }
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

  private func list(_ benefit: BenefitDTO) -> some View {
    List {
      Section { CreditProgress(benefit: benefit) }

      let windows = CardRules.creditWindows(benefit, now: .now)
      ForEach(windows) { window in
        Section {
          ForEach(window.credits) { credit in creditRows(credit, benefit: benefit) }
          if window.id == windows.last?.id { addTransaction(benefit) }
        } header: {
          Text(window.label)
        }
      }
      if windows.isEmpty { Section { addTransaction(benefit) } }

      Section {
        Toggle("Perk", isOn: Binding(
          get: { CardRules.perkOn(benefit) },
          set: { write(.updateBenefit(id: benefit.id, .perkActive($0))) }))
        .disabled(store.isSaving)
        LabeledContent("Used") {
          HStack(spacing: 2) {
            Text("$").foregroundStyle(.secondary)
            TextField("0", text: $usedText)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
              .focused($usedFocused)
              .fixedSize()
          }
        }
        Button("Save Used Amount") {
          guard let n = CardRules.number(usedText), n >= 0 else { return }
          usedFocused = false
          write(.updateBenefit(id: benefit.id, .usedManual(n)))
        }
        .disabled(store.isSaving || (CardRules.number(usedText).map { $0 < 0 } ?? true))
        if benefit.source == "manual" {
          Button(CardRules.canAuto(benefit) ? "Auto" : "Clear") {
            usedText = ""
            write(.updateBenefit(id: benefit.id, .usedManual(nil)))
          }
          .disabled(store.isSaving)
        }
      }

      Section {
        ForEach(Array(benefit.matchText.enumerated()), id: \.offset) { i, keyword in
          Button(keyword) { editKeyword(i, keyword) }
            .foregroundStyle(.primary)
            .disabled(store.isSaving)
        }
        .onDelete { offsets in
          var list = benefit.matchText
          list.remove(atOffsets: offsets)
          write(.updateBenefit(id: benefit.id, .matchText(list)))
        }
        .deleteDisabled(store.isSaving)
        Button("Add Keyword…") { editKeyword(nil, "") }
          .disabled(store.isSaving)
      } header: {
        Text("Keywords")
      }

      if benefit.yearBreakdown.count > 1 {
        Section {
          ForEach(benefit.yearBreakdown) { window in
            Button {
              write(.updateBenefit(
                id: benefit.id, .window(key: window.key, value: CardRules.windowCycleValue(window))))
            } label: {
              WindowRow(window: window)
            }
            .foregroundStyle(.primary)
            .disabled(store.isSaving)
            .accessibilityHint(window.manual ? "Clears the override" : window.captured ? "Marks not captured" : "Marks captured")
          }
        } header: {
          Text("This Year")
        } footer: {
          AmountText(CardRules.yearSummary(benefit))
        }
      }

      Section {
        Button("Delete Credit", role: .destructive) { confirmingDelete = true }
          .disabled(store.isSaving)
      }
    }
    .listStyle(.insetGrouped)
    .tabBarScrollTracking()
    .navigationTitle(benefit.name)
    .navigationBarTitleDisplayMode(.inline)
    .sheet(item: $picking) { PerkPickerSheet(kind: $0, store: store) }
    .onAppear {
      if usedText.isEmpty && benefit.source == "manual" { usedText = Formatters.plainNumber(benefit.used) }
    }
    .alert(keywordIndex == nil ? "Add Keyword" : "Edit Keyword", isPresented: $keywordAlert) {
      TextField("Keyword", text: $keywordText)
      Button("Save") { saveKeyword(benefit) }
      Button("Cancel", role: .cancel) {}
    }
    .alert(CardRules.deleteCreditPrompt(benefit), isPresented: $confirmingDelete) {
      Button("Delete", role: .destructive) { write(.deleteBenefit(id: benefit.id), thenDismiss: true) }
      Button("Cancel", role: .cancel) {}
    }
  }

  /// A credit, then the purchase it paid back or a way to pick one.
  @ViewBuilder private func creditRows(_ credit: PerkCreditDTO, benefit: BenefitDTO) -> some View {
    PerkRow(
      name: credit.name,
      detail: "\(Formatters.day(credit.date)) · \(credit.how == "auto" ? "Matched" : "Confirmed")",
      amount: Ledger.signedAmount(-credit.amount).text)
    .swipeActions {
      Button("Detach") { write(.decidePerk(transactionId: credit.id, .notThisPerk(benefitId: benefit.id))) }
        .tint(.orange)
        .disabled(store.isSaving)
    }
    if let p = credit.purchase {
      HStack(alignment: .firstTextBaseline) {
        Image(systemName: "arrow.turn.down.right").foregroundStyle(.secondary).accessibilityHidden(true)
        PairRow(fixed: true) {
          Text("\(p.name) · \(Formatters.day(p.date))")
        } value: {
          AmountText(Formatters.currency(p.amount)).monospacedDigit()
        }
      }
      .font(.subheadline)
      .swipeActions {
        Button("Unlink") { write(.pickPurchase(creditId: credit.id, purchaseId: nil)) }.tint(.orange)
          .disabled(store.isSaving)
      }
    } else {
      Button("Pick Purchase") { picking = .purchase(creditId: credit.id) }
        .font(.subheadline)
        .disabled(store.isSaving)
    }
  }

  private func editKeyword(_ index: Int?, _ text: String) {
    keywordIndex = index
    keywordText = text
    keywordAlert = true
  }

  /// Sends the whole list; the server trims, dedupes and refuses generic words.
  private func saveKeyword(_ benefit: BenefitDTO) {
    let keyword = keywordText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !keyword.isEmpty else { return }
    var list = benefit.matchText
    if let i = keywordIndex {
      guard list.indices.contains(i) else { return }
      list[i] = keyword
    } else {
      list.append(keyword)
    }
    write(.updateBenefit(id: benefit.id, .matchText(list)))
  }

  private func addTransaction(_ benefit: BenefitDTO) -> some View {
    Button("Add Transaction…") { picking = .credit(benefitId: benefit.id) }
      .disabled(store.isSaving)
  }

  private func write(_ write: CardWrite, thenDismiss: Bool = false) {
    Task {
      do throws(APIError) {
        try await store.perform(write)
        if thenDismiss { dismiss() }
      } catch {
        if error != .cancelled { saveError = error.message }
      }
    }
  }
}

/// One window of the year: its label, used of target, and whether it was
/// captured, partly used, upcoming or pinned by hand.
private struct WindowRow: View {
  let window: BenefitPeriodDTO

  var body: some View {
    HStack(spacing: 10) {
      symbol.frame(width: 22)
      PairRow {
        VStack(alignment: .leading, spacing: 0) {
          Text(window.label)
          if window.manual { Text("Manual").font(.footnote).foregroundStyle(.secondary) }
        }
      } value: {
        AmountText("\(Formatters.currency(window.used)) / \(Formatters.currency(window.target))")
          .monospacedDigit()
      }
    }
    .opacity(window.future && !window.manual ? 0.6 : 1)
  }

  @ViewBuilder private var symbol: some View {
    if window.captured {
      Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        .accessibilityLabel("Captured")
    } else if window.used > 0 {
      Image(systemName: "circle.lefthalf.filled").foregroundStyle(.orange)
        .accessibilityLabel("Partly used")
    } else if window.future {
      Image(systemName: "circle.dashed").foregroundStyle(.secondary)
        .accessibilityLabel("Upcoming")
    } else {
      Image(systemName: "circle").foregroundStyle(.secondary)
        .accessibilityLabel("Not captured")
    }
  }
}
