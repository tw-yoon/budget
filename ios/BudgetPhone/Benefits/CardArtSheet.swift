import SwiftUI

/// The cut card face before it's saved (the preview in
/// ../src/components/benefits/CardArtPicker.tsx). Nothing uploads until Save.
struct CardArtSheet: View {
  let card: UserCardDTO
  let cut: CardCrop.Cut
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  @State private var saving = false
  @State private var errorMessage: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          if let image = UIImage(data: cut.png) {
            Image(uiImage: image)
              .resizable()
              .scaledToFit()
              .frame(maxWidth: 280)
              .frame(maxWidth: .infinity)
              .accessibilityLabel("The card as it will be saved")
          }
        } footer: {
          Text(verbatim: "\(cut.sourceWidth)×\(cut.sourceHeight) · cut by \(cut.from)")
            .frame(maxWidth: .infinity)
        }
        .listRowBackground(Color.clear)
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Card Image")
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
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.perform(.putArt(id: card.id, png: cut.png))
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
