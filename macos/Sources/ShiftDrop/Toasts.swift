import AppKit
import ImageIO

private let toastWidth: CGFloat = 360

/// Rounded-rect mask for a blurred panel (layer corner radius doesn't clip behind-window blur).
func roundedMask(_ radius: CGFloat) -> NSImage {
    let edge = radius * 2 + 1
    let img = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { r in
        NSColor.black.set()
        NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius).fill()
        return true
    }
    img.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
    img.resizingMode = .stretch
    return img
}

/// The stack of notification cards in the top-right corner.
final class ToastCenter {
    private var toasts: [Toast] = []

    func new() -> Toast {
        let t = Toast(center: self)
        toasts.insert(t, at: 0)
        return t
    }

    func working(_ title: String, _ detail: String) -> Toast {
        let t = new()
        t.showWorking(title, detail)
        return t
    }

    func error(_ title: String, _ message: String) {
        new().showError(title, message)
    }

    func remove(_ t: Toast) {
        toasts.removeAll { $0 === t }
        layout()
    }

    func layout() {
        let mouse = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main else { return }
        let vf = screen.visibleFrame
        var top = vf.maxY - 12
        for t in toasts where t.isVisible {
            let h = t.frame.height
            let f = NSRect(x: vf.maxX - toastWidth - 12, y: top - h, width: toastWidth, height: h)
            t.setFrame(f, display: true, animate: false)
            top -= h + 10
        }
    }
}

final class Toast: NSPanel {
    private weak var center: ToastCenter?
    private let effect = NSVisualEffectView()
    private var outs: [URL] = []
    private var dismissAt: Date?
    private var timer: Timer?

    override var canBecomeKey: Bool { true }

    init(center: ToastCenter) {
        self.center = center
        super.init(contentRect: NSRect(x: 0, y: 0, width: toastWidth, height: 64),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        becomesKeyOnlyIfNeeded = true
        appearance = NSAppearance(named: .darkAqua)
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.maskImage = roundedMask(14)
        contentView = effect
    }

    // MARK: states

    func showWorking(_ title: String, _ detail: String) {
        rebuild(height: 60)
        let spinner = NSProgressIndicator(frame: NSRect(x: 16, y: 20, width: 20, height: 20))
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.startAnimation(nil)
        effect.addSubview(spinner)
        addLabels(title: title, detail: detail, x: 46, height: 60)
        present(after: nil)
    }

    func showResult(_ s: Summary) {
        outs = s.outs
        let h: CGFloat = 104
        rebuild(height: h)
        var x: CGFloat = 16
        if let thumb = s.thumb, let img = thumbnail(thumb) {
            let iv = NSImageView(frame: NSRect(x: 14, y: h - 14 - 48, width: 48, height: 48))
            iv.image = img
            iv.imageScaling = .scaleProportionallyUpOrDown
            iv.wantsLayer = true
            iv.layer?.cornerRadius = 8
            iv.layer?.masksToBounds = true
            effect.addSubview(iv)
            x = 72
        }
        let title = NSMutableAttributedString(string: s.title, attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.white])
        if !s.good.isEmpty {
            title.append(NSAttributedString(string: "   \(s.good)", attributes: [
                .font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: NSColor.systemGreen]))
        }
        addLabels(title: title, detail: s.detail, x: x, height: h)
        var bx = x - 6
        for (label, action) in [("Open", #selector(openResult)), ("Show in Finder", #selector(revealResult)),
                                ("Undo", #selector(undo))] {
            let b = NSButton(title: label, target: self, action: action)
            b.bezelStyle = .rounded
            b.controlSize = .small
            b.font = NSFont.systemFont(ofSize: 11)
            b.sizeToFit()
            b.frame.origin = NSPoint(x: bx, y: 8)
            effect.addSubview(b)
            bx += b.frame.width + 2
        }
        present(after: 7)
    }

    func showError(_ title: String, _ message: String) {
        let t = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.systemRed])
        rebuild(height: 72)
        addLabels(title: t, detail: message, x: 16, height: 72)
        present(after: 9)
    }

    func showInfo(_ title: String, _ detail: String) {
        rebuild(height: 60)
        addLabels(title: title, detail: detail, x: 16, height: 60)
        present(after: 2.5)
    }

    // MARK: actions

    @objc private func openResult() {
        if let first = outs.first { NSWorkspace.shared.open(first) }
        dismiss()
    }

    @objc private func revealResult() {
        NSWorkspace.shared.activateFileViewerSelecting(outs)
        dismiss()
    }

    /// Undo moves the new files to the Trash; the original was never touched.
    @objc private func undo() {
        var moved = 0
        for u in outs where (try? FileManager.default.trashItem(at: u, resultingItemURL: nil)) != nil { moved += 1 }
        showInfo("Undone", moved == 1 ? "Moved \(outs[0].lastPathComponent) to the Trash" : "Moved \(moved) files to the Trash")
    }

    @objc private func dismiss() {
        timer?.invalidate()
        orderOut(nil)
        center?.remove(self)
    }

    // MARK: layout helpers

    private func rebuild(height: CGFloat) {
        effect.subviews.forEach { $0.removeFromSuperview() }
        setContentSize(NSSize(width: toastWidth, height: height))
        let close = NSButton(title: "✕", target: self, action: #selector(dismiss))
        close.isBordered = false
        close.font = NSFont.systemFont(ofSize: 11)
        close.contentTintColor = NSColor.white.withAlphaComponent(0.6)
        close.frame = NSRect(x: toastWidth - 28, y: height - 26, width: 20, height: 18)
        effect.addSubview(close)
    }

    private func addLabels(title: Any, detail: String, x: CGFloat, height: CGFloat) {
        let w = toastWidth - x - 32
        let t: NSTextField
        if let a = title as? NSAttributedString {
            t = NSTextField(labelWithAttributedString: a)
        } else {
            t = NSTextField(labelWithString: title as? String ?? "")
            t.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
            t.textColor = .white
        }
        t.lineBreakMode = .byTruncatingTail
        t.frame = NSRect(x: x, y: height - 14 - 18, width: w, height: 18)
        effect.addSubview(t)
        let d = NSTextField(wrappingLabelWithString: detail)
        d.font = NSFont.systemFont(ofSize: 11)
        d.textColor = NSColor.white.withAlphaComponent(0.72)
        d.maximumNumberOfLines = 2
        d.lineBreakMode = .byTruncatingMiddle
        d.frame = NSRect(x: x, y: height - 14 - 18 - 30, width: w, height: 28)
        effect.addSubview(d)
    }

    private func present(after seconds: TimeInterval?) {
        orderFrontRegardless()
        center?.layout()
        timer?.invalidate()
        dismissAt = seconds.map { Date().addingTimeInterval($0) }
        guard dismissAt != nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self, let at = self.dismissAt else { return }
            if NSMouseInRect(NSEvent.mouseLocation, self.frame, false) {
                self.dismissAt = Date().addingTimeInterval(2)   // stay while the pointer is on it
            } else if Date() >= at {
                self.dismiss()
            }
        }
    }

    private func thumbnail(_ url: URL) -> NSImage? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                     kCGImageSourceCreateThumbnailWithTransform: true,
                                     kCGImageSourceThumbnailMaxPixelSize: 96]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }
}
