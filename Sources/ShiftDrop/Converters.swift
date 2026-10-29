import AppKit
import CoreText
import ImageIO
import PDFKit

/// Format conversions and file tools. Every function takes source files and returns the
/// output files it wrote (next to the source; the source itself is never changed).
enum Converters {
    /// Image formats in menu order, with the ImageIO type that writes them.
    static let imageFormats: [(name: String, uti: String)] = [
        ("PNG", "public.png"), ("JPG", "public.jpeg"), ("HEIC", "public.heic"),
        ("WEBP", "org.webmproject.webp"), ("TIFF", "public.tiff"), ("AVIF", "public.avif"),
        ("BMP", "com.microsoft.bmp"), ("GIF", "com.compuserve.gif"), ("ICO", "com.microsoft.ico"),
    ]
    static let lossy: Set<String> = ["JPG", "HEIC", "WEBP", "AVIF"]
    static let noAlpha: Set<String> = ["JPG", "BMP"]

    /// Types this Mac's ImageIO can write (WEBP/AVIF writing depends on the macOS version).
    static let writable: Set<String> = Set((CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? [])

    static func uti(_ format: String) -> String? {
        imageFormats.first { $0.name == format }.flatMap { writable.contains($0.uti) ? $0.uti : nil }
    }

    static func formatName(ext: String) -> String {
        switch ext.lowercased() {
        case "jpg", "jpeg": return "JPG"
        case "tif", "tiff": return "TIFF"
        case "heic", "heif": return "HEIC"
        default: return ext.uppercased()
        }
    }

    static func targets(for kind: Kind, ext: String) -> [String] {
        switch kind {
        case .image:
            let current = formatName(ext: ext)
            return imageFormats.map(\.name).filter { $0 != current && uti($0) != nil } + ["PDF"]
        case .pdf: return ["JPG", "PNG", "TXT"]
        case .docx: return ["PDF", "TXT"]
        case .text: return ["PDF", "DOCX"]
        }
    }

    static func convert(_ src: URL, _ kind: Kind, _ target: String) throws -> [URL] {
        guard targets(for: kind, ext: src.pathExtension).contains(target) else {
            throw UserError("Can't convert \(src.pathExtension.uppercased()) to \(target).")
        }
        switch (kind, target) {
        case (.image, "PDF"): return [try imagesToPDF([src])]
        case (.image, _): return [try imageTo(src, target)]
        case (.pdf, "TXT"): return [try pdfToText(src)]
        case (.pdf, _): return try pdfToImages(src, target)
        case (.docx, "PDF"): return [try attributedToPDF(try readDocx(src), out: try Files.sibling(src, ext: "pdf"))]
        case (.docx, _): return [try writeText(try readDocx(src).string, src)]
        case (.text, "PDF"): return [try attributedToPDF(plainAttributed(try readText(src), mono: true),
                                                         out: try Files.sibling(src, ext: "pdf"))]
        case (.text, _): return [try textToDocx(src)]
        }
    }

    // MARK: - images

    /// Decode the first frame with the camera's EXIF rotation applied.
    static func loadImage(_ url: URL) throws -> CGImage {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(src) > 0 else {
            throw UserError("Couldn't read this image.")
        }
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] ?? [:]
        let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0
        let h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(w, h, 1),
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else {
            throw UserError("Couldn't decode this image.")
        }
        return img
    }

    static func hasAlpha(_ img: CGImage) -> Bool {
        switch img.alphaInfo {
        case .none, .noneSkipFirst, .noneSkipLast: return false
        default: return true
        }
    }

    /// Redraw into an sRGB bitmap of the given size (optionally onto white, for formats without alpha).
    static func redraw(_ img: CGImage, width: Int? = nil, height: Int? = nil, onWhite: Bool = false,
                       canvas: CGSize? = nil) throws -> CGImage {
        let w = width ?? img.width, h = height ?? img.height
        let cw = Int(canvas?.width ?? CGFloat(w)), ch = Int(canvas?.height ?? CGFloat(h))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: cw, height: ch, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw UserError("Not enough memory for this image.")
        }
        ctx.interpolationQuality = .high
        if onWhite {
            ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            ctx.fill(CGRect(x: 0, y: 0, width: cw, height: ch))
        }
        ctx.draw(img, in: CGRect(x: (cw - w) / 2, y: (ch - h) / 2, width: w, height: h))
        guard let out = ctx.makeImage() else { throw UserError("Couldn't render this image.") }
        return out
    }

    static func writeImage(_ img: CGImage, to out: URL, format: String, quality: Double? = nil) throws {
        guard let type = uti(format) else { throw UserError("This Mac can't write \(format) files.") }
        var image = img
        if noAlpha.contains(format) && hasAlpha(img) { image = try redraw(img, onWhite: true) }
        if format == "ICO" {
            // icons max out at 256 px and must be square
            let k = min(1, 256 / CGFloat(max(img.width, img.height)))
            let w = max(1, Int(CGFloat(img.width) * k)), h = max(1, Int(CGFloat(img.height) * k))
            let side = max(w, h)
            image = try redraw(img, width: w, height: h, canvas: CGSize(width: side, height: side))
        }
        try Files.atomicWrite(out) { tmp in
            guard let dest = CGImageDestinationCreateWithURL(tmp as CFURL, type as CFString, 1, nil) else {
                throw UserError("Couldn't create the \(format) file.")
            }
            var opts: [CFString: Any] = [:]
            if lossy.contains(format) {
                opts[kCGImageDestinationLossyCompressionQuality] = quality ?? Double(Settings.shared.quality) / 100
            }
            CGImageDestinationAddImage(dest, image, opts as CFDictionary)
            if !CGImageDestinationFinalize(dest) { throw UserError("Couldn't write the \(format) file.") }
        }
    }

    static func imageTo(_ src: URL, _ format: String) throws -> URL {
        let img = try loadImage(src)
        let out = try Files.sibling(src, ext: format.lowercased())
        try writeImage(img, to: out, format: format)
        return out
    }

    /// One or more images -> a single PDF, one page per image (150 dpi page size).
    static func imagesToPDF(_ srcs: [URL]) throws -> URL {
        let images = try srcs.map { try redraw(try loadImage($0), onWhite: true) }
        let out = try Files.sibling(srcs[0], srcs.count > 1 ? "Combined" : "", ext: "pdf")
        try Files.atomicWrite(out) { tmp in
            guard let ctx = CGContext(tmp as CFURL, mediaBox: nil, nil) else {
                throw UserError("Couldn't create the PDF.")
            }
            for img in images {
                var box = CGRect(x: 0, y: 0, width: CGFloat(img.width) * 72 / 150, height: CGFloat(img.height) * 72 / 150)
                ctx.beginPage(mediaBox: &box)
                ctx.interpolationQuality = .high
                ctx.draw(img, in: box)
                ctx.endPage()
            }
            ctx.closePDF()
        }
        return out
    }

    /// Format to save an edited copy of `src` in: the same one when this Mac can write it.
    static func formatLike(_ src: URL, _ img: CGImage) -> String {
        let f = formatName(ext: src.pathExtension)
        if uti(f) != nil { return f }
        return hasAlpha(img) ? "PNG" : "JPG"
    }

    static func compressImage(_ src: URL, quality: Double = 0.72) throws -> URL {
        let img = try loadImage(src)
        var format = formatLike(src, img)
        if !lossy.contains(format) {
            // PNG keeps its transparency; everything else lossless becomes a JPG
            format = (format == "PNG" && hasAlpha(img)) ? "PNG" : "JPG"
        }
        let out = try Files.sibling(src, "Compressed", ext: format == formatName(ext: src.pathExtension)
                                    ? src.pathExtension : format.lowercased())
        try writeImage(img, to: out, format: format, quality: quality)
        return out
    }

    static func resizeImage(_ src: URL, _ spec: ResizeSpec) throws -> URL {
        let img = try loadImage(src)
        let (w, h) = spec.dims(for: (img.width, img.height))
        let resized = try redraw(img, width: w, height: h)
        let format = formatLike(src, img)
        let ext = format == formatName(ext: src.pathExtension) ? src.pathExtension : format.lowercased()
        let out = try Files.sibling(src, "\(w)x\(h)", ext: ext)
        try writeImage(resized, to: out, format: format)
        return out
    }

    // MARK: - PDF

    static func openPDF(_ url: URL) throws -> PDFDocument {
        guard let doc = PDFDocument(url: url) else { throw UserError("Couldn't open this PDF.") }
        if doc.isLocked { throw UserError("This PDF is password-protected. Remove the password first.") }
        return doc
    }

    static func render(_ page: PDFPage, dpi: Int) throws -> CGImage {
        let box = page.bounds(for: .mediaBox)
        let rotated = page.rotation % 180 != 0
        let size = rotated ? CGSize(width: box.height, height: box.width) : box.size
        let scale = CGFloat(dpi) / 72
        let w = max(1, Int((size.width * scale).rounded())), h = max(1, Int((size.height * scale).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
            throw UserError("Not enough memory to render this page.")
        }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.interpolationQuality = .high
        ctx.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: ctx)
        guard let img = ctx.makeImage() else { throw UserError("Couldn't render this page.") }
        return img
    }

    static func pdfToImages(_ src: URL, _ format: String) throws -> [URL] {
        let doc = try openPDF(src)
        let n = doc.pageCount
        return try (0..<n).compactMap { i -> URL? in
            guard let page = doc.page(at: i) else { return nil }
            let img = try render(page, dpi: Settings.shared.pdfDPI)
            let out = try Files.sibling(src, n > 1 ? "page \(i + 1)" : "", ext: format.lowercased())
            try writeImage(img, to: out, format: format)
            return out
        }
    }

    static func pdfToText(_ src: URL) throws -> URL {
        let doc = try openPDF(src)
        let text = (0..<doc.pageCount).map { doc.page(at: $0)?.string ?? "" }.joined(separator: "\n\u{0C}\n")
        return try writeText(text, src)
    }

    static func write(_ doc: PDFDocument, to out: URL) throws -> URL {
        try Files.atomicWrite(out) { tmp in
            if !doc.write(to: tmp) { throw UserError("Couldn't write the PDF.") }
        }
        return out
    }

    static func splitPDF(_ src: URL) throws -> [URL] {
        let doc = try openPDF(src)
        return try (0..<doc.pageCount).compactMap { i -> URL? in
            guard let page = doc.page(at: i)?.copy() as? PDFPage else { return nil }
            let single = PDFDocument()
            single.insert(page, at: 0)
            return try write(single, to: try Files.sibling(src, "page \(i + 1)", ext: "pdf"))
        }
    }

    static func rotatePDF(_ src: URL) throws -> URL {
        let doc = try openPDF(src)
        for i in 0..<doc.pageCount {
            if let page = doc.page(at: i) { page.rotation = (page.rotation + 90) % 360 }
        }
        return try write(doc, to: try Files.sibling(src, "Rotated", ext: "pdf"))
    }

    static func mergePDFs(_ srcs: [URL]) throws -> URL {
        let merged = PDFDocument()
        for src in srcs {
            let doc = try openPDF(src)
            for i in 0..<doc.pageCount {
                if let page = doc.page(at: i)?.copy() as? PDFPage { merged.insert(page, at: merged.pageCount) }
            }
        }
        return try write(merged, to: try Files.sibling(srcs[0], "Merged", ext: "pdf"))
    }

    // MARK: - text and Word

    static func readText(_ src: URL) throws -> String {
        let data = try Data(contentsOf: src)
        for enc in [String.Encoding.utf8, .utf16, .windowsCP1252, .isoLatin1] {
            if let s = String(data: data, encoding: enc) {
                return s.hasPrefix("\u{FEFF}") ? String(s.dropFirst()) : s
            }
        }
        return String(decoding: data, as: UTF8.self)
    }

    static func readDocx(_ src: URL) throws -> NSAttributedString {
        // AppKit's document readers are happiest on the main thread
        var result: Result<NSAttributedString, Error>!
        let work = {
            result = Result {
                try NSAttributedString(url: src, options: [.documentType: NSAttributedString.DocumentType.officeOpenXML],
                                       documentAttributes: nil)
            }
        }
        if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
        do { return try result.get() } catch { throw UserError("Couldn't read this Word document.") }
    }

    static func plainAttributed(_ text: String, mono: Bool) -> NSAttributedString {
        let font = mono ? NSFont.monospacedSystemFont(ofSize: 9.5, weight: .regular) : NSFont.systemFont(ofSize: 11)
        let para = NSMutableParagraphStyle()
        para.lineBreakMode = .byWordWrapping
        return NSAttributedString(string: text, attributes: [.font: font, .paragraphStyle: para,
                                                             .foregroundColor: NSColor.black])
    }

    static func writeText(_ text: String, _ src: URL) throws -> URL {
        let out = try Files.sibling(src, ext: "txt")
        try Files.atomicWrite(out) { tmp in try text.write(to: tmp, atomically: false, encoding: .utf8) }
        return out
    }

    static func textToDocx(_ src: URL) throws -> URL {
        let s = plainAttributed(try readText(src), mono: false)
        let data = try s.data(from: NSRange(location: 0, length: s.length),
                              documentAttributes: [.documentType: NSAttributedString.DocumentType.officeOpenXML])
        let out = try Files.sibling(src, ext: "docx")
        try Files.atomicWrite(out) { tmp in try data.write(to: tmp) }
        return out
    }

    /// Lay text out on US Letter pages with 0.75" margins.
    static func attributedToPDF(_ text: NSAttributedString, out: URL) throws -> URL {
        try Files.atomicWrite(out) { tmp in
            var media = CGRect(x: 0, y: 0, width: 612, height: 792)
            guard let ctx = CGContext(tmp as CFURL, mediaBox: &media, nil) else {
                throw UserError("Couldn't create the PDF.")
            }
            let setter = CTFramesetterCreateWithAttributedString(text as CFAttributedString)
            let path = CGPath(rect: media.insetBy(dx: 54, dy: 54), transform: nil)
            var start = 0
            repeat {
                ctx.beginPage(mediaBox: &media)
                let frame = CTFramesetterCreateFrame(setter, CFRange(location: start, length: 0), path, nil)
                CTFrameDraw(frame, ctx)
                ctx.endPage()
                let shown = CTFrameGetVisibleStringRange(frame).length
                if shown == 0 { break }
                start += shown
            } while start < text.length
            ctx.closePDF()
        }
        return out
    }
}

/// How to resize: by percent, longest side, width or height.
struct ResizeSpec {
    enum Mode: String, CaseIterable { case percent, longest, width, height }
    let mode: Mode
    let value: Int

    /// "percent:50", "longest:1200", "width:800", "height:600"
    init?(parse s: String) {
        let parts = s.split(separator: ":")
        guard parts.count == 2, let m = Mode(rawValue: String(parts[0])), let v = Int(parts[1]), v > 0 else { return nil }
        mode = m
        value = v
    }

    init(mode: Mode, value: Int) {
        self.mode = mode
        self.value = value
    }

    func dims(for size: (Int, Int)) -> (Int, Int) {
        let (w, h) = (Double(size.0), Double(size.1))
        let k: Double
        switch mode {
        case .percent: k = Double(value) / 100
        case .longest: k = Double(value) / max(w, h)
        case .width: k = Double(value) / w
        case .height: k = Double(value) / h
        }
        return (max(1, Int((w * k).rounded())), max(1, Int((h * k).rounded())))
    }
}
