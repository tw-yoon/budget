import SwiftUI

/// One card (UserCardItem in ../src/components/benefits/UserCardItem.tsx):
/// its details, credits against the fee, earning rates, points earned and
/// statement credits. Edit changes the start month, fee and point value.
struct CardDetailView: View {
  let id: String
  let store: BenefitsStore

  @Environment(\.dismiss) private var dismiss
  @State private var sheet: Sheet?
  @State private var confirmingRemove = false
  @State private var saveError: String?

  enum Sheet: Identifiable {
    case edit
    case rate(RewardRateDTO?)
    case credit
    var id: String {
      switch self {
      case .edit: "edit"
      case .rate(let r): "rate-\(r?.id ?? "")"
      case .credit: "credit"
      }
    }
  }

  var body: some View {
    Group {
      if let card = store.card(id: id) {
        list(card)
      } else {
        // Removed here or elsewhere.
        ContentUnavailableView("No Card", systemImage: "creditcard")
          .onAppear { dismiss() }
      }
    }
    .sheet(item: $sheet) { sheet in
      if let card = store.card(id: id) {
        switch sheet {
        case .edit: CardEditSheet(card: card, store: store)
        case .rate(let rate): RateSheet(card: card, rate: rate, store: store)
        case .credit: AddCreditSheet(card: card, store: store)
        }
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

  private func list(_ card: UserCardDTO) -> some View {
    List {
      Section {
        CardArtView(card: card, artURL: card.artUrl.flatMap(store.artURL), width: 240)
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())
      }
      details(card)
      fee(card)
      rates(card)
      EarningsSection(card: card)
      credits(card)
      Section {
        Button("Remove Card", role: .destructive) { confirmingRemove = true }
          .disabled(store.isSaving)
      }
    }
    .listStyle(.insetGrouped)
    .listSectionSpacing(.compact)
    .tabBarScrollTracking()
    .navigationTitle(CardRules.title(card))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Edit") { sheet = .edit }
      }
    }
    .refreshable { await store.load() }
    .alert(CardRules.removeCardPrompt(card), isPresented: $confirmingRemove) {
      Button("Remove", role: .destructive) { write(.deleteCard(id: card.id), thenDismiss: true) }
      Button("Cancel", role: .cancel) {}
    }
  }

  private func details(_ card: UserCardDTO) -> some View {
    Section {
      PairRow("Issuer") { Text(Rewards.issuerLabel(card.issuer)) }
      PairRow("Number") { Text("··\(card.last4)").monospacedDigit() }
      PairRow("Member Since", fixed: false) {
        Text([CardRules.memberSince(card), CardRules.yearsHeld(card)].compactMap(\.self).joined(separator: " · "))
      }
      PairRow("Annual Fee") { AmountText(Formatters.currency(card.annualFee)).monospacedDigit() }
      PairRow("Linked", fixed: false) { Text(card.linked ? card.linkedAccountName ?? "" : "Not linked") }
    }
  }

  private func fee(_ card: UserCardDTO) -> some View {
    let summary = CardRules.feeSummary(card)
    return Section {
      VStack(alignment: .leading, spacing: 8) {
        if summary.hasFee {
          ProgressView(value: summary.fill).tint(summary.breakEven ? .green : .indigo)
        }
        AmountText(summary.text).font(.subheadline).foregroundStyle(.secondary)
      }
      .padding(.vertical, 2)
    } header: {
      Text("Credits vs. Annual Fee")
    }
  }

  private func rates(_ card: UserCardDTO) -> some View {
    Section {
      ForEach(card.rewardRates) { rate in
        Button { sheet = .rate(rate) } label: {
          VStack(alignment: .leading, spacing: 2) {
            PairRow(rate.categoryLabel) { Text(rate.display).monospacedDigit() }
            if let notes = rate.notes, !notes.isEmpty {
              Text(notes).font(.footnote).foregroundStyle(.secondary)
            }
          }
        }
        .foregroundStyle(.primary)
        .swipeActions {
          Button("Delete", systemImage: "trash", role: .destructive) {
            write(.deleteRate(id: rate.id))
          }
        }
      }
      Button("Add Rate") { sheet = .rate(nil) }
    } header: {
      Text("Earning Rates")
    } footer: {
      if card.rewardRates.isEmpty {
        Text("No earning rates yet — add one below, or re-add this card from a preset.")
      }
    }
  }

  private func credits(_ card: UserCardDTO) -> some View {
    Section {
      ForEach(card.benefits) { benefit in
        NavigationLink(value: CreditRoute(cardId: card.id, id: benefit.id)) {
          CreditProgress(benefit: benefit)
        }
      }
      Button("Add Credit") { sheet = .credit }
    } header: {
      Text("Statement Credits")
    } footer: {
      if card.benefits.isEmpty { Text("No credits yet — add one below.") }
    }
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

/// What the card earned on its own spending (EarningsSection in
/// UserCardItem.tsx). Read-only; the point value is edited under Edit.
private struct EarningsSection: View {
  let card: UserCardDTO

  var body: some View {
    Section {
      if let e = card.earnings {
        if e.byCategory.isEmpty {
          Text("No spending on this card in this window yet.").foregroundStyle(.secondary)
        } else {
          let isPoints = e.unit == "X"
          ForEach(e.byCategory) { row in
            VStack(alignment: .leading, spacing: 2) {
              PairRow {
                HStack(spacing: 0) {
                  Text(row.categoryLabel)
                  if !row.isBonus { Text(" base").foregroundStyle(.secondary) }
                }
              } value: {
                AmountText(isPoints ? CardRules.formatEarned(row.earned, isPoints: true)
                  : Formatters.currency(row.earned)).monospacedDigit()
              }
              AmountText("\(Formatters.currency(row.spend)) · \(row.rate) · \(CardRules.formatVsBest(row.vsBest)) vs. next best")
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
          }
          VStack(alignment: .leading, spacing: 2) {
            AmountText(
              "\(Formatters.currency(e.totalSpend)) spent · \(CardRules.formatEarned(e.totalEarned, isPoints: isPoints))"
                + (isPoints ? " ≈ \(Formatters.currency(e.totalValue))" : "")
            )
            AmountText(CardRules.formatIncremental(e.incrementalValue))
              .foregroundStyle(e.incrementalValue >= 0 ? Color.teal : Color.orange)
          }
          .font(.subheadline)
          .monospacedDigit()
        }
      } else {
        Text("Link this card to an account to estimate what it earns.").foregroundStyle(.secondary)
      }
    } header: {
      HStack {
        Text("Points Earned")
        Spacer()
        Text(card.earningsPeriodLabel)
      }
    } footer: {
      if let e = card.earnings, e.unit == "X", !e.byCategory.isEmpty {
        Text("Valued at \(Formatters.plainNumber(card.pointValueCents))¢ per point · estimated from categories, before caps and exclusions")
      }
    }
  }
}

/// A credit's name, progress and hint (BenefitRow's top half).
struct CreditProgress: View {
  let benefit: BenefitDTO

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      PairRow(benefit.name) {
        HStack(spacing: 0) {
          AmountText(Formatters.currency(benefit.cappedUsed))
          AmountText(" / \(Formatters.currency(benefit.amount))").foregroundStyle(.secondary)
        }
        .monospacedDigit()
      }
      ProgressView(value: min(1, max(0, benefit.pct))).tint(benefit.pct >= 1 ? .green : .indigo)
      Text((benefit.pct >= 1 ? "✓ " : "") + CardRules.creditHint(benefit))
        .font(.footnote).foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
  }
}

/// A label and its value on one line, stacked at accessibility sizes. A
/// figure never wraps mid-value; free text (`fixed: false`) may wrap.
struct PairRow<Label: View, Value: View>: View {
  let label: Label
  let value: Value
  var fixed = true
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  init(fixed: Bool = true, @ViewBuilder label: () -> Label, @ViewBuilder value: () -> Value) {
    self.label = label()
    self.value = value()
    self.fixed = fixed
  }

  var body: some View {
    let shown = value
      .lineLimit(fixed ? 1 : nil)
      .fixedSize(horizontal: fixed, vertical: false)
      .foregroundStyle(.secondary)
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) { label; shown }
    } else {
      HStack(alignment: .firstTextBaseline) {
        label
        Spacer(minLength: 8)
        shown.multilineTextAlignment(.trailing)
      }
    }
  }
}

extension PairRow where Label == Text {
  init(_ title: String, fixed: Bool = true, @ViewBuilder value: () -> Value) {
    self.init(fixed: fixed, label: { Text(title) }, value: value)
  }
}
