import SwiftUI

/// A rotating quarter on the card page: its summary, and "Not activated"
/// when it's entered but not switched on.
struct RotatingRow: View {
  let bonus: RotatingBonusDTO?
  let year: Int
  let quarter: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(CardRules.rotatingSummary(bonus, year: year, quarter: quarter))
      if let bonus, !bonus.activated {
        Text("Not activated").font(.footnote).foregroundStyle(.secondary)
      }
    }
  }
}

/// The quarters other than the current one, newest first; tapping one opens
/// its form.
struct PastQuartersView: View {
  let id: String
  let store: BenefitsStore
  let current: String
  @State private var editing: RotatingBonusDTO?

  var body: some View {
    let card = store.card(id: id)
    List {
      ForEach(card.map { CardRules.pastQuarters($0, current: current) } ?? []) { bonus in
        Button { editing = bonus } label: {
          RotatingRow(bonus: bonus, year: bonus.year, quarter: bonus.quarter)
        }
        .foregroundStyle(.primary)
      }
    }
    .listStyle(.insetGrouped)
    .navigationTitle("Past Quarters")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(item: $editing) { bonus in
      if let card {
        RotatingSheet(card: card, year: bonus.year, quarter: bonus.quarter, store: store)
      }
    }
  }
}

/// One quarter's bonus: rate, cap, what it covers and whether it's activated.
/// Save sends the whole quarter; Delete Quarter removes it.
struct RotatingSheet: View {
  let card: UserCardDTO
  let year: Int
  let quarter: Int
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  @State private var multiplier: String
  @State private var cap: String
  @State private var categories: Set<String>
  @State private var merchants: [Line]
  @State private var excluded: [Line]
  @State private var activated: Bool
  @State private var saving = false
  @State private var confirmingDelete = false
  @State private var errorMessage: String?
  @FocusState private var focused: UUID?

  struct Line: Identifiable {
    let id = UUID()
    var text: String
  }

  private let exists: Bool

  init(card: UserCardDTO, year: Int, quarter: Int, store: BenefitsStore) {
    self.card = card
    self.year = year
    self.quarter = quarter
    self.store = store
    let existing = card.rotating.first { $0.year == year && $0.quarter == quarter }
    exists = existing != nil
    let start = existing.map {
      RotatingBonusBody(
        multiplier: $0.multiplier, unit: $0.unit, categories: $0.categories, merchants: $0.merchants,
        excludeMerchants: $0.excludeMerchants, cap: $0.cap, activated: $0.activated)
    } ?? CardRules.newRotatingDefaults(card)
    _multiplier = State(initialValue: Formatters.plainNumber(start.multiplier))
    _cap = State(initialValue: start.cap.map(Formatters.plainNumber) ?? "")
    _categories = State(initialValue: Set(start.categories))
    _merchants = State(initialValue: start.merchants.map { Line(text: $0) })
    _excluded = State(initialValue: start.excludeMerchants.map { Line(text: $0) })
    _activated = State(initialValue: start.activated)
  }

  /// nil until the form can be saved.
  private var draft: RotatingBonusBody? {
    guard let rate = CardRules.number(multiplier), rate > 0 else { return nil }
    let capText = cap.trimmingCharacters(in: .whitespaces)
    let capValue = CardRules.number(capText)
    if !capText.isEmpty && (capValue ?? 0) <= 0 { return nil }
    let names = { (lines: [Line]) in
      lines.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    let picked = CardRules.rotatingCategories.filter(categories.contains)
    guard !picked.isEmpty || !names(merchants).isEmpty else { return nil }
    return RotatingBonusBody(
      multiplier: rate, unit: CardRules.baseUnit(card), categories: picked, merchants: names(merchants),
      excludeMerchants: names(excluded), cap: capText.isEmpty ? nil : capValue, activated: activated)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          LabeledContent("Rate") {
            TextField("Rate", text: $multiplier)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
            Text(CardRules.baseUnit(card) == "PERCENT" ? "%" : "x").foregroundStyle(.secondary)
          }
          LabeledContent("Cap") {
            TextField("No cap", text: $cap)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
          }
        }
        Section("Categories") {
          ForEach(CardRules.rotatingCategories, id: \.self) { category in
            let on = categories.contains(category)
            Button {
              if on { categories.remove(category) } else { categories.insert(category) }
            } label: {
              HStack {
                Text(CardRules.rotatingLabel(for: category))
                Spacer()
                if on { Image(systemName: "checkmark").foregroundStyle(.tint) }
              }
            }
            .foregroundStyle(.primary)
            .accessibilityAddTraits(on ? .isSelected : [])
          }
        }
        lines("Merchants", add: "Add Merchant", $merchants)
        lines("Excluded Merchants", add: "Add Excluded Merchant", $excluded)
        Section {
          Toggle("Activated", isOn: $activated)
        }
        if exists {
          Section {
            Button("Delete Quarter", role: .destructive) { confirmingDelete = true }
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .confirmationDialog("Delete Q\(quarter) \(year)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
        Button("Delete Quarter", role: .destructive) {
          run(.deleteRotating(cardId: card.id, year: year, quarter: quarter),
              saving: $saving, error: $errorMessage, store: store, dismiss: dismiss)
        }
        Button("Cancel", role: .cancel) {}
      }
      .navigationTitle(String("Q\(quarter) \(year)"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Save", action: save).disabled(draft == nil)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func lines(_ title: String, add: String, _ items: Binding<[Line]>) -> some View {
    Section(title) {
      ForEach(items) { $line in
        TextField("Merchant", text: $line.text)
          .textInputAutocapitalization(.words)
          .autocorrectionDisabled()
          .focused($focused, equals: line.id)
      }
      .onDelete { items.wrappedValue.remove(atOffsets: $0) }
      Button(add) {
        let line = Line(text: "")
        items.wrappedValue.append(line)
        focused = line.id
      }
    }
  }

  private func save() {
    guard let body = draft else { return }
    run(.saveRotating(cardId: card.id, year: year, quarter: quarter, body),
        saving: $saving, error: $errorMessage, store: store, dismiss: dismiss)
  }
}
