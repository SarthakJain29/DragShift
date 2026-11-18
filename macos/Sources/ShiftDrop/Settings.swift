import AppKit
import ServiceManagement

enum TriggerKey: String, CaseIterable {
    case shift, control, option

    var flag: NSEvent.ModifierFlags {
        switch self {
        case .shift: return .shift
        case .control: return .control
        case .option: return .option
        }
    }

    var title: String {
        switch self {
        case .shift: return "Shift ⇧"
        case .control: return "Control ⌃"
        case .option: return "Option ⌥"
        }
    }

    var symbol: String {
        switch self {
        case .shift: return "⇧"
        case .control: return "⌃"
        case .option: return "⌥"
        }
    }
}

enum OutputPlace: String {
    case next, folder
}

/// User preferences, backed by UserDefaults (safe to read from worker threads).
final class Settings {
    static let shared = Settings()
    private let d = UserDefaults.standard

    var triggerKey: TriggerKey {
        get { TriggerKey(rawValue: d.string(forKey: "triggerKey") ?? "") ?? .control }
        set { d.set(newValue.rawValue, forKey: "triggerKey") }
    }

    var output: OutputPlace {
        get { OutputPlace(rawValue: d.string(forKey: "output") ?? "") ?? .next }
        set { d.set(newValue.rawValue, forKey: "output") }
    }

    /// Quality for JPG / HEIC / WEBP / AVIF conversions, 1...100.
    var quality: Int {
        get { (d.object(forKey: "quality") as? Int) ?? 90 }
        set { d.set(newValue, forKey: "quality") }
    }

    /// Resolution for PDF -> image conversions.
    var pdfDPI: Int {
        get { (d.object(forKey: "pdfDPI") as? Int) ?? 200 }
        set { d.set(newValue, forKey: "pdfDPI") }
    }

    var enabled: Bool {
        get { (d.object(forKey: "enabled") as? Bool) ?? true }
        set { d.set(newValue, forKey: "enabled") }
    }

    var welcomed: Bool {
        get { d.bool(forKey: "welcomed") }
        set { d.set(newValue, forKey: "welcomed") }
    }

    var startAtLogin: Bool {
        SMAppService.mainApp.status == .enabled
    }

    func setStartAtLogin(_ on: Bool) throws {
        if on {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}
