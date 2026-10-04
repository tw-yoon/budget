import SwiftUI

/// The sheets of Benefits → Cards. Each keeps its fields and shows the
/// server's message when a save fails, and dismisses once the store has
/// reloaded.

/// AddCardForm (../src/components/benefits/CardsSection.tsx): a preset, which
/// fills in the rates and credits, or a custom card.
struct AddCardSheet: View {
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  /// "" is a custom card, as on the web.
  @State private var presetSlug = ""
  @State private var issuer = "AMEX"
  @State private var name = ""
  @State private var last4 = ""
  @State private var startMonth: Int?
  @State private var startYear = Calendar.current.component(.year, from: .now)
  @State private var saving = false
  @State private var errorMessage: String?

  private var thisYear: Int { Calendar.current.component(.year, from: .now) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Card", selection: $presetSlug) {
            Text("Custom").tag("")
            ForEach(CardRules.issuers, id: \.self) { issuer in
              Section(Rewards.issuerLabel(issuer)) {
                ForEach(CardRules.presets.filter { $0.issuer == issuer }) { preset in
                  Text(CardRules.presetLabel(preset)).tag(preset.slug)
                }
              }
            }
          }
          .pickerStyle(.navigationLink)
          if presetSlug.isEmpty {
            Picker("Issuer", selection: $issuer) {
              ForEach(CardRules.issuers, id: \.self) { Text(Rewards.issuerLabel($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            TextField("Card name (optional, e.g. Platinum)", text: $name)
              .textInputAutocapitalization(.words)
          }
        }
        Section {
          TextField("Last 4 digits", text: $last4)
            .keyboardType(.numberPad)
            .onChange(of: last4) { _, new in
              let digits = CardRules.last4Input(new)
              if digits != new { last4 = digits }
            }
          Picker("Start Month", selection: $startMonth) {
            Text("None").tag(Int?.none)
            ForEach(1...12, id: \.self) { Text(CardRules.monthNames[$0 - 1]).tag(Int?.some($0)) }
          }
          Picker("Start Year", selection: $startYear) {
            ForEach((CardRules.earliestStartYear...thisYear).reversed(), id: \.self) { Text(String($0)).tag($0) }
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(last4.count != 4)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let card: NewUserCard = presetSlug.isEmpty
      ? .custom(issuer: issuer, name: trimmed.isEmpty ? nil : trimmed, last4: last4,
                startYear: startYear, startMonth: startMonth)
      : .preset(slug: presetSlug, last4: last4, startYear: startYear, startMonth: startMonth)
    run(.addCard(card), saving: $saving, error: $errorMessage, store: store, dismiss: dismiss)
  }
}

/// The card's start month, annual fee and point value. Save sends only what
/// changed.
struct CardEditSheet: View {
  let card: UserCardDTO
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  @State private var form: CardEditForm
  @State private var saving = false
  @State private var errorMessage: String?

  init(card: UserCardDTO, store: BenefitsStore) {
    self.card = card
    self.store = store
    _form = State(initialValue: CardEditForm(card: card))
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Start Month", selection: $form.startMonth) {
            Text("None").tag(Int?.none)
            ForEach(1...12, id: \.self) { Text(CardRules.monthNames[$0 - 1]).tag(Int?.some($0)) }
          }
          LabeledContent("Start Year", value: String(card.membershipStartYear))
        }
        Section {
          LabeledContent("Annual Fee") {
            HStack(spacing: 2) {
              Text("$").foregroundStyle(.secondary)
              TextField("0", text: $form.feeText)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(form.isFeeValid ? Color.primary : Color.red)
                .fixedSize()
            }
          }
          if form.showsPointValue {
            LabeledContent("Point Value") {
              HStack(spacing: 2) {
                TextField("1", text: $form.pointValueText)
                  .keyboardType(.decimalPad)
                  .multilineTextAlignment(.trailing)
                  .foregroundStyle(form.isPointValueValid ? Color.primary : Color.red)
                  .fixedSize()
                Text("¢").foregroundStyle(.secondary)
              }
            }
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle(CardRules.title(card))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Save", action: save)
              .disabled(!form.isValid || form.patch(against: card).isEmpty)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    run(.updateCard(id: card.id, form.patch(against: card)),
        saving: $saving, error: $errorMessage, store: store, dismiss: dismiss)
  }
}

/// AddRateForm: adds a rate, or overrides the card's rate for a category.
/// Opened from a rate, it starts from that rate.
struct RateSheet: View {
  let card: UserCardDTO
  let rate: RewardRateDTO?
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  @State private var category: String
  @State private var multiplier: String
  @State private var unit: String
  @State private var saving = false
  @State private var errorMessage: String?

  init(card: UserCardDTO, rate: RewardRateDTO?, store: BenefitsStore) {
    self.card = card
    self.rate = rate
    self.store = store
    _category = State(initialValue: rate?.category ?? "DINING")
    _multiplier = State(initialValue: rate.map { Formatters.plainNumber($0.multiplier) } ?? "")
    _unit = State(initialValue: rate?.unit ?? "X")
  }

  private var value: Double? { CardRules.number(multiplier).flatMap { $0 > 0 ? $0 : nil } }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Category", selection: $category) {
            ForEach(CardRules.rewardCategories, id: \.self) { Text(Rewards.label(for: $0)).tag($0) }
          }
          LabeledContent("Rate") {
            TextField("Rate", text: $multiplier)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
          }
          Picker("Unit", selection: $unit) {
            Text("x points").tag("X")
            Text("% cash").tag("PERCENT")
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle(rate == nil ? "Add Rate" : "Edit Rate")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Save", action: save).disabled(value == nil)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    guard let value else { return }
    run(.saveRate(NewRewardRate(userCardId: card.id, category: category, multiplier: value, unit: unit)),
        saving: $saving, error: $errorMessage, store: store, dismiss: dismiss)
  }
}

/// AddBenefitForm: a statement credit, tracked against a spending category
/// or logged by hand.
struct AddCreditSheet: View {
  let card: UserCardDTO
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var amount = ""
  @State private var period = "ANNUAL"
  /// "" tracks it by hand.
  @State private var category = ""
  @State private var saving = false
  @State private var errorMessage: String?

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var amountValue: Double? { CardRules.number(amount).flatMap { $0 > 0 ? $0 : nil } }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Benefit name (e.g. Airline Fee Credit)", text: $name)
            .textInputAutocapitalization(.words)
          HStack {
            Text("$")
            TextField("Amount", text: $amount).keyboardType(.decimalPad)
          }
          Picker("Period", selection: $period) {
            ForEach(CardRules.benefitPeriods, id: \.self) { Text(CardRules.periodLabel($0)).tag($0) }
          }
          Picker("Tracking", selection: $category) {
            Text("Track manually (no category)").tag("")
            ForEach(CardRules.trackableCategories, id: \.self) {
              Text("\(Formatters.humanizePfc($0)) spending").tag($0)
            }
          }
          .pickerStyle(.navigationLink)
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Credit")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(trimmedName.isEmpty || amountValue == nil)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    guard let amountValue else { return }
    let benefit = NewBenefit(
      userCardId: card.id, name: trimmedName, amount: amountValue, period: period,
      category: category.isEmpty ? nil : category)
    run(.addBenefit(benefit), saving: $saving, error: $errorMessage, store: store, dismiss: dismiss)
  }
}

/// A sheet's save: spinner on, the write, then dismiss, or the message.
@MainActor
private func run(
  _ write: CardWrite, saving: Binding<Bool>, error message: Binding<String?>,
  store: BenefitsStore, dismiss: DismissAction
) {
  saving.wrappedValue = true
  message.wrappedValue = nil
  Task {
    do throws(APIError) {
      try await store.perform(write)
      dismiss()
    } catch {
      saving.wrappedValue = false
      if error != .cancelled { message.wrappedValue = error.message }
    }
  }
}
