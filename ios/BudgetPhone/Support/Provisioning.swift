import Foundation

/// When this install was signed and when the signature runs out, from the
/// app's own embedded.mobileprovision: a signed blob with a plist inside.
/// A free Apple ID signs for 7 days. Absent in the simulator.
struct Provisioning: Equatable {
  let created: Date
  let expires: Date

  static func current() -> Provisioning? {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return parse(data)
  }

  static func parse(_ data: Data) -> Provisioning? {
    guard let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
      let plist = try? PropertyListSerialization.propertyList(
        from: data[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
      let created = plist["CreationDate"] as? Date,
      let expires = plist["ExpirationDate"] as? Date
    else { return nil }
    return Provisioning(created: created, expires: expires)
  }
}
