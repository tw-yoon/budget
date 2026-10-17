import Foundation
import UserNotifications

/// Thin wrapper over the notification center; the rules are in PerkReminders.plan.
@MainActor enum PerkReminderScheduler {
  static let firedKey = "perkRemindersFired"

  static func removeAll() async {
    let center = UNUserNotificationCenter.current()
    let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(PerkReminders.idPrefix) }
    center.removePendingNotificationRequests(withIdentifiers: ids)
  }

  static func reschedule(cards: [UserCardDTO]) async {
    let center = UNUserNotificationCenter.current()
    let defaults = UserDefaults.standard
    guard defaults.bool(forKey: PerkReminders.storageKey) else { return await removeAll() }
    // A denied permission must not burn the once-per-window reminder.
    let status = await center.notificationSettings().authorizationStatus
    let delivers = status == .authorized || status == .provisional

    let now = Date()
    let pending = await center.pendingNotificationRequests().map(\.identifier)
    let fired = Set(defaults.stringArray(forKey: firedKey) ?? [])
    let changes = PerkReminders.changes(cards: cards, now: now, calendar: .current, fired: fired, pending: pending)
    center.removePendingNotificationRequests(withIdentifiers: changes.remove)
    for r in changes.add {
      let content = UNMutableNotificationContent()
      content.title = r.title
      content.body = r.body
      content.sound = .default
      let trigger: UNNotificationTrigger =
        r.soon
        ? UNTimeIntervalNotificationTrigger(timeInterval: 60, repeats: false)
        : UNCalendarNotificationTrigger(
          dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: r.fireDate),
          repeats: false)
      if (try? await center.add(UNNotificationRequest(identifier: r.id, content: content, trigger: trigger))) != nil,
        delivers
      {
        // Re-read: an overlapping reschedule may have recorded others meanwhile.
        defaults.set(Array(Set(defaults.stringArray(forKey: firedKey) ?? []).union([r.id])), forKey: firedKey)
      }
    }
  }
}
