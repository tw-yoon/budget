import SwiftUI

/// One ledger row, in the web row's order: title and amount, the serial /
/// date / account line, badges, then the category line. Compact, it is one
/// line: number, short date, title, amount (CompactRow's layout).
///
/// One view for both densities, so a switch morphs each row rather than
/// swapping it for another: the title and amount keep their place in the
/// view and glide, the number and date slide in at the leading edge, the
/// lower lines fade, and the list animates the row's height. At
/// accessibility sizes, where compact stacks differently, it is CompactRow.
struct TransactionRow: View {
  let transaction: TransactionDTO
  var compact = false

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  /// As CompactRow's: fits "Sep 30" and "#1234" at the current text size.
  @ScaledMetric(relativeTo: .footnote) private var dateWidth: CGFloat = 44
  @ScaledMetric(relativeTo: .footnote) private var numberWidth: CGFloat = 42

  var body: some View {
    let t = transaction
    let amount = Ledger.signedAmount(t.amount)
    Group {
      if compact && dynamicTypeSize.isAccessibilitySize {
        CompactRow(
          number: CompactRows.number(t.label), date: CompactRows.shortDate(t.date), title: t.title,
          amount: amount.text, amountColor: amount.isOutflow ? .primary : .green)
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          if compact {
            Text(CompactRows.number(t.label))
              .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
              .lineLimit(1)
              .frame(width: numberWidth, alignment: .leading)
              .transition(.move(edge: .leading).combined(with: .opacity))
            Text(CompactRows.shortDate(t.date))
              .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
              .frame(width: dateWidth, alignment: .leading)
              .transition(.move(edge: .leading).combined(with: .opacity))
          }
          VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: compact ? 8 : 12) {
              Text(t.title)
                .font(compact ? .body : .body.weight(.medium))
                .lineLimit(compact ? 1 : 2)
              Spacer(minLength: compact ? 8 : 0)
              VStack(alignment: .trailing, spacing: 2) {
                AmountText(amount.text)
                  .monospacedDigit()
                  .lineLimit(1)
                  .fixedSize()
                  .foregroundStyle(amount.isOutflow ? Color.primary : Color.green)
                if !compact && !t.refunds.isEmpty {
                  AmountText("net \(Formatters.currency(t.netAmount))")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.green)
                    .transition(.opacity)
                }
              }
            }
            if !compact {
              Group {
                Text(t.detailLine())
                  .font(.footnote)
                  .foregroundStyle(.secondary)
                  .lineLimit(1)
                let badges = t.badges
                if !badges.isEmpty {
                  FlowLayout(spacing: 4) {
                    ForEach(badges, id: \.text) { BadgeView(badge: $0) }
                  }
                }
                CategoryLine(transaction: t)
              }
              .transition(.opacity)
            }
          }
        }
        .padding(.vertical, compact ? 0 : 2)
      }
    }
    .foregroundStyle(t.pending ? .secondary : .primary)
    .accessibilityElement(children: .combine)
  }
}

/// The category, with CUSTOM for an override or a lock for a row whose
/// category comes from its link.
struct CategoryLine: View {
  let transaction: TransactionDTO

  var body: some View {
    HStack(spacing: 6) {
      Text(transaction.categoryLabel)
        .font(.footnote)
        .foregroundStyle(.secondary)
      if transaction.linkedTo != nil {
        Image(systemName: "lock.fill")
          .font(.caption2)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Category from linked purchase")
      } else if transaction.userCategory != nil {
        Text("CUSTOM")
          .font(.caption2.weight(.semibold))
          .padding(.horizontal, 4)
          .background(Color.blue.opacity(0.15), in: .rect(cornerRadius: 3))
          .foregroundStyle(.blue)
      }
    }
  }
}

struct BadgeView: View {
  let badge: TransactionDTO.Badge

  var body: some View {
    Text(badge.text)
      .font(.caption2.weight(.medium))
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(color.opacity(0.15), in: .capsule)
      .foregroundStyle(color)
  }

  private var color: Color {
    switch badge.tone {
    case .violet: .purple
    case .green: .green
    case .amber: .orange
    case .slate: .secondary
    }
  }
}

/// Lays badges out left to right, wrapping onto new lines as needed.
struct FlowLayout: Layout {
  var spacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    arrange(width: proposal.width ?? .infinity, subviews: subviews).size
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let origins = arrange(width: bounds.width, subviews: subviews).origins
    for (view, origin) in zip(subviews, origins) {
      view.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
    }
  }

  private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
    var origins: [CGPoint] = []
    var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, maxX: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        x = 0
        y += lineHeight + spacing
        lineHeight = 0
      }
      origins.append(CGPoint(x: x, y: y))
      x += size.width + spacing
      maxX = max(maxX, x - spacing)
      lineHeight = max(lineHeight, size.height)
    }
    return (CGSize(width: maxX, height: y + lineHeight), origins)
  }
}
