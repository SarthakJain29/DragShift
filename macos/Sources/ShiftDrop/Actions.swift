import AppKit

struct MenuItem {
    let label: String
    var glyph: String = ""
    var hint: String = ""
    /// "convert:PNG" or "tool:Compress"
    let key: String
}

struct Ring {
    let name: String
    let items: [MenuItem]
}

/// What the menu offers for a set of files, and running the chosen action.
final class Actions {
    static let glyphs = ["Compress": "⇲", "Resize": "⤢", "Split": "✂", "Rotate": "⟳", "Merge": "⧉"]
    static let hints = ["Compress": "Shrink file size", "Resize": "Change dimensions", "Split": "One PDF per page",
                        "Rotate": "Turn pages 90°", "Merge": "Join into one PDF"]
    static let formatHints = ["JPG": "Small, universal", "PNG": "Lossless · transparency", "WEBP": "Smallest for web",
                              "HEIC": "iPhone format", "TIFF": "Print · archival", "AVIF": "Next-gen, tiny",
                              "BMP": "Uncompressed", "PDF": "Document", "ICO": "Windows icon", "GIF": "Legacy web",
                              "DOCX": "Editable Word", "TXT": "Plain text"]

    let toasts: ToastCenter

    init(toasts: ToastCenter) {
        self.toasts = toasts
    }

    func describe(_ urls: [URL]) -> String {
        urls.count > 1 ? "\(urls.count) files" : Files.human(Files.size(urls[0]))
    }

    static func buildRings(_ urls: [URL]) -> [Ring] {
        guard let first = urls.first, let kind = Files.kind(first) else { return [] }
        let same = urls.filter { Files.kind($0) == kind }
        let convert = Converters.targets(for: kind, ext: first.pathExtension).map { t -> MenuItem in
            var hint = formatHints[t] ?? ""
            if kind == .image && t == "PDF" && same.count > 1 { hint = "\(same.count) images → 1 PDF" }
            return MenuItem(label: t, hint: hint, key: "convert:\(t)")
        }
        var rings = [Ring(name: "Convert", items: convert)]
        let tools: [String]
        switch kind {
        case .image: tools = ["Compress", "Resize"]
        case .pdf: tools = ["Split", "Rotate"] + (same.count > 1 ? ["Merge"] : [])
        default: tools = []
        }
        if !tools.isEmpty {
            rings.append(Ring(name: "Tools", items: tools.map {
                MenuItem(label: $0, glyph: glyphs[$0] ?? "", hint: hints[$0] ?? "", key: "tool:\($0)")
            }))
        }
        return rings
    }

    /// The work for an action, plus the "working…" text. Used by the menu and the --run CLI.
    static func job(_ key: String, _ urls: [URL], resize: ResizeSpec? = nil) throws -> (String, [URL], () throws -> [URL]) {
        guard let first = urls.first, let kind = Files.kind(first) else { throw UserError("Unsupported file type.") }
        let srcs = urls.filter { Files.kind($0) == kind }
        let parts = key.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { throw UserError("Unknown action \(key).") }
        let name = parts[1]
        if parts[0] == "convert" {
            if kind == .image && name == "PDF" && srcs.count > 1 {
                return ("Combining \(srcs.count) images…", srcs, { [try Converters.imagesToPDF(srcs)] })
            }
            return ("Converting to \(name)…", srcs, { try srcs.flatMap { try Converters.convert($0, kind, name) } })
        }
        switch (kind, name) {
        case (.image, "Compress"):
            return ("Compressing…", srcs, { try srcs.map { try Converters.compressImage($0) } })
        case (.image, "Resize"):
            guard let spec = resize else { throw UserError("No size chosen.") }
            return ("Resizing…", srcs, { try srcs.map { try Converters.resizeImage($0, spec) } })
        case (.pdf, "Split"):
            return ("Splitting…", srcs, { try srcs.flatMap { try Converters.splitPDF($0) } })
        case (.pdf, "Rotate"):
            return ("Rotating…", srcs, { try srcs.map { try Converters.rotatePDF($0) } })
        case (.pdf, "Merge"):
            return ("Merging…", srcs, { [try Converters.mergePDFs(srcs)] })
        default:
            throw UserError("\(name) isn't available for this file.")
        }
    }

    func run(_ item: MenuItem, _ urls: [URL]) {
        var spec: ResizeSpec?
        if item.key == "tool:Resize" {
            guard let s = askResize(urls) else { return }
            spec = s
        }
        do {
            let (working, srcs, work) = try Self.job(item.key, urls, resize: spec)
            submit(item.key, srcs, working, work)
        } catch {
            toasts.error("Couldn't start \(item.label)", friendly(error))
        }
    }

    /// Run in the background. A spinner card appears only if it takes longer than 150 ms.
    func submit(_ action: String, _ srcs: [URL], _ working: String, _ work: @escaping () throws -> [URL]) {
        var finished = false
        var card: Toast?
        let names = srcs.count == 1 ? srcs[0].lastPathComponent : "\(srcs.count) files"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            if !finished { card = self.toasts.working(working, names) }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let outcome = Result { Report.summarize(action, srcs, try work()) }
            DispatchQueue.main.async {
                finished = true
                let t = card ?? self.toasts.new()
                switch outcome {
                case .success(let summary): t.showResult(summary)
                case .failure(let error): t.showError("Couldn't finish", friendly(error))
                }
            }
        }
    }

    /// Small dialog: resize by percent, longest side, width or height.
    func askResize(_ urls: [URL]) -> ResizeSpec? {
        let alert = NSAlert()
        let first = urls[0]
        let current = Report.dimString(Report.dims(first))
        alert.messageText = urls.count > 1 ? "Resize \(urls.count) images" : "Resize \(first.lastPathComponent)"
        alert.informativeText = current.isEmpty ? "Saved as a copy next to the original." : "Now \(current). Saved as a copy next to the original."
        alert.addButton(withTitle: "Resize")
        alert.addButton(withTitle: "Cancel")

        let modes: [(ResizeSpec.Mode, String)] = [(.percent, "Percent"), (.longest, "Longest side (px)"),
                                                   (.width, "Width (px)"), (.height, "Height (px)")]
        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 160, height: 26), pullsDown: false)
        popup.addItems(withTitles: modes.map(\.1))
        let field = NSTextField(frame: NSRect(x: 170, y: 2, width: 80, height: 22))
        field.stringValue = "50"
        field.alignment = .right
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 250, height: 28))
        box.addSubview(popup)
        box.addSubview(field)
        alert.accessoryView = box
        alert.window.initialFirstResponder = field

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn,
              let value = Int(field.stringValue.trimmingCharacters(in: .whitespaces)), value > 0 else { return nil }
        return ResizeSpec(mode: modes[popup.indexOfSelectedItem].0, value: value)
    }
}
