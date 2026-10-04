import SwiftUI

/// TransactionLinkPicker.tsx: the purchases this money-in row most likely
/// pays back, best first, plus linking by a typed serial number.
struct LinkPurchaseView: View {
  let transactionId: String
  let store: TransactionsStore
  /// Runs after a successful link, e.g. to reload a Venmo or Zelle list.
  var onLinked: () async -> Void = {}

  @Environment(\.dismiss) private var dismiss
  @State private var candidates: [LinkCandidate]?
  @State private var typed = ""
  @State private var saving = false
  @State private var failure: String?

  var body: some View {
    Form {
      Section {
        if let candidates {
          if candidates.isEmpty {
            Text("No likely purchase found — enter a number below.")
              .foregroundStyle(.secondary)
          }
          ForEach(candidates) { c in
            Button { link(c.label) } label: { candidateRow(c) }
              .disabled(c.label == nil || saving)
          }
        } else {
          ProgressView()
        }
      } header: {
        Text("Likely purchases")
      }

      Section {
        HStack {
          Text("#")
          TextField("Number", text: $typed)
            .keyboardType(.numberPad)
          Button("Connect") { link(Int(typed)) }
            .disabled(Int(typed) == nil || saving)
        }
      } header: {
        Text("By number")
      } footer: {
        Text("The # shown to the left of a purchase's date in the ledger.")
      }
    }
    .tabBarScrollTracking()
    .navigationTitle("Connect to a Purchase")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      do throws(APIError) {
        candidates = try await store.linkCandidates(transactionId)
      } catch {
        candidates = []
        if error != .cancelled { failure = error.message }
      }
    }
    .alert("Couldn't Connect", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(failure ?? "")
    }
  }

  private func candidateRow(_ c: LinkCandidate) -> some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 2) {
        Text(c.name).foregroundStyle(.primary)
        Text(["#\(c.label.map(String.init) ?? "—")",
              Formatters.parseISO(c.date).map { Formatters.date($0) } ?? "",
              c.category].joined(separator: " · "))
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      Spacer()
      AmountText(Formatters.currency(c.amount)).monospacedDigit().foregroundStyle(.primary)
    }
  }

  private func link(_ label: Int?) {
    guard let label else { return }
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        try await store.setLink(transactionId, label: label)
        await onLinked()
        dismiss()
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}
