import Foundation
import ImageIO
import PDFKit

/// What a finished action shows in its notification.
struct Summary {
    let title: String
    let detail: String
    let outs: [URL]
    let srcs: [URL]
    var good: String = ""

    var thumb: URL? { outs.first { Files.kind($0) == .image } }
}

/// Turns "what just happened" into a short, useful summary: sizes saved, new dimensions, pages.
enum Report {
    static func dims(_ url: URL) -> (Int, Int)? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = p[kCGImagePropertyPixelWidth] as? Int, let h = p[kCGImagePropertyPixelHeight] as? Int else {
            return nil
        }
        let orientation = p[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? (h, w) : (w, h)
    }

    static func pages(_ url: URL) -> Int? {
        PDFDocument(url: url)?.pageCount
    }

    static func dimString(_ d: (Int, Int)?) -> String {
        d.map { "\($0.0)×\($0.1)" } ?? ""
    }

    /// ("2.4 MB → 610 KB", "75% smaller")
    static func sizeChange(_ before: Int64, _ after: Int64) -> (String, String) {
        let text = "\(Files.human(before)) → \(Files.human(after))"
        guard before > 0 else { return (text, "") }
        let pct = (1 - Double(after) / Double(before)) * 100
        if pct >= 1 { return (text, "\(Int(pct.rounded()))% smaller") }
        if pct <= -1 { return (text, "\(Int((-pct).rounded()))% larger") }
        return (text, "same size")
    }

    static func summarize(_ action: String, _ srcs: [URL], _ outs: [URL], _ extra: String = "") -> Summary {
        guard let o0 = outs.first else {
            return Summary(title: action, detail: extra.isEmpty ? "Nothing was written" : extra, outs: [], srcs: srcs)
        }
        let src = srcs.first ?? o0
        let before = srcs.reduce(Int64(0)) { $0 + Files.size($1) }
        let after = outs.reduce(Int64(0)) { $0 + Files.size($1) }
        let parts = action.split(separator: ":", maxSplits: 1).map(String.init)
        let kind = parts.first ?? "", name = parts.count > 1 ? parts[1] : ""

        if kind == "convert" {
            let title: String
            if srcs.count > 1 && outs.count == 1 {
                title = "\(srcs.count) files → 1 \(name)"
            } else if outs.count > 1 && srcs.count == 1 {
                title = "\(pages(src) ?? outs.count) pages → \(outs.count) \(name)s"
            } else if outs.count > 1 {
                title = "\(outs.count) files → \(name)"
            } else {
                title = "\(src.pathExtension.uppercased()) → \(name)"
            }
            var bits = [outs.count == 1 ? o0.lastPathComponent : "\(o0.lastPathComponent) …"]
            if Files.kind(o0) == .image, let d = dims(o0) { bits.append(dimString(d)) }
            if o0.pathExtension.lowercased() == "pdf", let n = pages(o0) { bits.append("\(n) page\(n == 1 ? "" : "s")") }
            bits.append(Files.human(after))
            return Summary(title: title, detail: bits.joined(separator: " · "), outs: outs, srcs: srcs)
        }

        switch name {
        case "Compress":
            var (sizes, verdict) = sizeChange(before, after)
            if verdict.hasSuffix("larger") || verdict == "same size" { verdict = "already well compressed" }
            return Summary(title: srcs.count > 1 ? "Compressed \(srcs.count) files" : "Compressed",
                           detail: sizes, outs: outs, srcs: srcs, good: verdict)
        case "Resize":
            if outs.count > 1 {
                return Summary(title: "Resized \(outs.count) images",
                               detail: "\(Files.human(before)) → \(Files.human(after))", outs: outs, srcs: srcs)
            }
            let d0 = dims(src), d1 = dims(o0)
            let detail = d0 != nil && d1 != nil ? "\(dimString(d0)) → \(dimString(d1))" : dimString(d1)
            return Summary(title: "Resized", detail: "\(detail) · \(o0.lastPathComponent)", outs: outs, srcs: srcs)
        case "Split":
            return Summary(title: "Split into \(outs.count) PDFs", detail: "\(o0.lastPathComponent) …", outs: outs, srcs: srcs)
        case "Merge":
            let n = pages(o0) ?? 0
            return Summary(title: "Merged \(srcs.count) PDFs",
                           detail: "\(n) pages · \(Files.human(after)) · \(o0.lastPathComponent)", outs: outs, srcs: srcs)
        case "Rotate":
            let n = pages(o0) ?? 0
            return Summary(title: "Rotated 90°", detail: "\(n) page\(n == 1 ? "" : "s") · \(o0.lastPathComponent)",
                           outs: outs, srcs: srcs)
        default:
            return Summary(title: name.isEmpty ? action : name,
                           detail: "\(o0.lastPathComponent) · \(Files.human(after))", outs: outs, srcs: srcs)
        }
    }
}
