import AppKit

enum Kind {
    case image, pdf, docx, text
}

/// An error whose message is fine to show to the user as-is.
struct UserError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

func friendly(_ error: Error) -> String {
    if let e = error as? UserError { return e.message }
    return error.localizedDescription
}

/// Output paths, file categories and sizes.
enum Files {
    static let imageExts: Set<String> = ["png", "jpg", "jpeg", "webp", "heic", "heif", "tif", "tiff",
                                         "avif", "bmp", "gif", "ico"]
    static let textExts: Set<String> = ["txt", "md", "csv", "log", "json", "xml", "html", "htm"]
    static let subfolder = "ShiftDrop"

    static func kind(_ url: URL) -> Kind? {
        let ext = url.pathExtension.lowercased()
        if imageExts.contains(ext) { return .image }
        if ext == "pdf" { return .pdf }
        if ext == "docx" { return .docx }
        if textExts.contains(ext) { return .text }
        return nil
    }

    /// File URLs on a pasteboard, with Finder aliases resolved to what they point at.
    static func fileURLs(_ pb: NSPasteboard) -> [URL] {
        let objs = pb.readObjects(forClasses: [NSURL.self],
                                  options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        return objs.compactMap { u -> URL? in
            let path = ((u as NSURL).filePathURL ?? u)
            let resolved = (try? URL(resolvingAliasFileAt: path)) ?? path
            return FileManager.default.fileExists(atPath: resolved.path) ? resolved : nil
        }
    }

    static func outputDir(for src: URL) throws -> URL {
        var dir = src.deletingLastPathComponent()
        if Settings.shared.output == .folder {
            dir.appendPathComponent(subfolder, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// Output path for `src`: sibling("a.jpg", "Compressed") -> "a Compressed.jpg" (never overwrites).
    static func sibling(_ src: URL, _ label: String = "", ext: String? = nil) throws -> URL {
        let stem = src.deletingPathExtension().lastPathComponent
        let name = label.isEmpty ? stem : "\(stem) \(label)"
        let e = ext ?? src.pathExtension
        return unique(try outputDir(for: src).appendingPathComponent(e.isEmpty ? name : "\(name).\(e)"))
    }

    /// `url`, or `name (1).ext`, `name (2).ext`... if it already exists.
    static func unique(_ url: URL) -> URL {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) { return url }
        let dir = url.deletingLastPathComponent()
        let stem = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var i = 1
        while true {
            let name = ext.isEmpty ? "\(stem) (\(i))" : "\(stem) (\(i)).\(ext)"
            let cand = dir.appendingPathComponent(name)
            if !fm.fileExists(atPath: cand.path) { return cand }
            i += 1
        }
    }

    /// Write to a hidden temp file, then rename: Finder never shows a half-written file.
    static func atomicWrite(_ out: URL, _ body: (URL) throws -> Void) throws {
        let fm = FileManager.default
        let tmp = out.deletingLastPathComponent().appendingPathComponent(".~\(out.lastPathComponent).part")
        try? fm.removeItem(at: tmp)
        do {
            try body(tmp)
            try fm.moveItem(at: tmp, to: out)
        } catch {
            try? fm.removeItem(at: tmp)
            throw error
        }
    }

    static func size(_ url: URL) -> Int64 {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    }

    static func human(_ bytes: Int64) -> String {
        var n = Double(bytes)
        for unit in ["B", "KB", "MB"] {
            if n < 1024 {
                return unit == "B" ? "\(Int(n)) B" : String(format: "%.1f %@", n, unit)
            }
            n /= 1024
        }
        return String(format: "%.1f GB", n)
    }
}
