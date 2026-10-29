import AppKit

// Geometry (points). The window is larger than the petals to leave room for the hover pop.
private let menuSize: CGFloat = 400
private let rOut: CGFloat = 158
private let rIn: CGFloat = 60
private let rHub: CGFloat = 50
private let gap: CGFloat = 7       // px between petals, the same width from hub to rim
private let corner: CGFloat = 5   // petal corner rounding, done by stroking an inset shape

/// Angles (degrees, counter-clockwise from 3 o'clock) of petal `i` of `n`:
/// the first petal is centred at 12 o'clock and they go round clockwise.
private func petalAngles(_ n: Int, _ i: Int) -> (CGFloat, CGFloat) {
    let span = 360 / CGFloat(n)
    let start = 90 + span / 2 - CGFloat(i + 1) * span
    return (start, start + span)
}

/// Ring sector between a0...a1, trimmed by `trim` px along both straight edges at every radius.
private func sectorPath(_ c: NSPoint, _ r0: CGFloat, _ r1: CGFloat, _ a0: CGFloat, _ a1: CGFloat,
                        trim: CGFloat) -> NSBezierPath {
    let d0 = trim / r0 * 180 / .pi, d1 = trim / r1 * 180 / .pi
    let p = NSBezierPath()
    p.appendArc(withCenter: c, radius: r1, startAngle: a0 + d1, endAngle: a1 - d1, clockwise: false)
    p.appendArc(withCenter: c, radius: r0, startAngle: a1 - d0, endAngle: a0 + d0, clockwise: true)
    p.close()
    p.lineJoinStyle = .round
    p.lineWidth = corner * 2
    return p
}

private func easeOutBack(_ x: CGFloat) -> CGFloat {
    let c1: CGFloat = 1.70158, c3 = c1 + 1
    return 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2)
}

final class RadialPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// The radial drop menu that pops up under the cursor while you Shift+drag a file.
/// The petals are a real blur of what's behind them (NSVisualEffectView masked to the menu's shape).
final class RadialMenu: NSObject {
    var onActivate: ((MenuItem, [URL]) -> Void)?
    var describe: ([URL]) -> String = { _ in "" }

    let panel: RadialPanel
    private let effect = NSVisualEffectView()
    private let canvas: RadialCanvas

    private(set) var paths: [URL] = []
    private var rings: [Ring] = []
    private var ringIndex = 0
    private var hover = -1            // petal index, -2 = hub, -1 = none
    private var springs: [CGFloat] = []
    private var hubSpring: CGFloat = 0
    private var hubText = ""
    private var gotDrag = false
    private var hubArmed = false
    private(set) var clickMode = false

    private var appear: CGFloat = 1   // pop-in 0...1 (overshoots)
    private var appearStart: CFTimeInterval = 0
    private var swap: CGFloat = 1     // ring-swap 0...1
    private var swapStart: CFTimeInterval = 0
    private var frameTimer: Timer?
    private var hubTimer: Timer?
    private var clickMonitor: Any?

    var isVisible: Bool { panel.isVisible }
    var hasFiles: Bool { !paths.isEmpty }
    private var items: [MenuItem] { rings.isEmpty ? [] : rings[ringIndex].items }
    private var center: NSPoint { NSPoint(x: menuSize / 2, y: menuSize / 2) }

    override init() {
        let frame = NSRect(x: 0, y: 0, width: menuSize, height: menuSize)
        panel = RadialPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        canvas = RadialCanvas(frame: frame)
        super.init()
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.appearance = NSAppearance(named: .darkAqua)

        let root = NSView(frame: frame)
        effect.frame = frame
        effect.autoresizingMask = [.width, .height]
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        root.addSubview(effect)
        canvas.autoresizingMask = [.width, .height]
        canvas.owner = self
        canvas.registerForDraggedTypes([.fileURL])
        root.addSubview(canvas)
        panel.contentView = root
    }

    // MARK: show / hide

    func popup(at pos: NSPoint, paths files: [URL]?, click: Bool) {
        let screen = NSScreen.screens.first { NSMouseInRect(pos, $0.frame, false) } ?? NSScreen.main
        var origin = NSPoint(x: pos.x - menuSize / 2, y: pos.y - menuSize / 2)
        if let f = screen?.frame {
            origin.x = min(max(origin.x, f.minX), f.maxX - menuSize)
            origin.y = min(max(origin.y, f.minY), f.maxY - menuSize)
        }
        panel.setFrameOrigin(origin)
        hover = -1
        gotDrag = false
        hubArmed = false   // drags start on the hub: don't flip rings until they leave it
        clickMode = click
        if let files, !files.isEmpty {
            load(files)
        } else {
            paths = []
            rings = []
            springs = []
            hubText = "Drop here"
        }
        appear = 0
        appearStart = CACurrentMediaTime()
        swap = 1
        updateMask()
        canvas.needsDisplay = true
        if click {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
            panel.makeFirstResponder(canvas)
            clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
                self?.close()
            }
        } else {
            panel.orderFrontRegardless()
        }
        startFrames()
    }

    func close() {
        guard panel.isVisible else { return }
        panel.orderOut(nil)
        frameTimer?.invalidate()
        frameTimer = nil
        hubTimer?.invalidate()
        if let m = clickMonitor { NSEvent.removeMonitor(m) }
        clickMonitor = nil
        clickMode = false
    }

    private func load(_ files: [URL]) {
        paths = files
        rings = Actions.buildRings(files).filter { !$0.items.isEmpty }
        ringIndex = 0
        springs = Array(repeating: 0, count: items.count)
        hubText = rings.isEmpty ? "Not supported" : describe(files)
        updateMask()
        canvas.needsDisplay = true
    }

    func nextRing() {
        guard rings.count > 1 else { return }
        ringIndex = (ringIndex + 1) % rings.count
        hover = -1
        springs = Array(repeating: 0, count: items.count)
        swap = 0
        swapStart = CACurrentMediaTime()
        startFrames()
    }

    // MARK: animation

    private func startFrames() {
        guard frameTimer == nil else { return }
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        frameTimer = t
    }

    private func tick() {
        let now = CACurrentMediaTime()
        var changed = false
        if appear < 1 || now - appearStart < 0.2 {
            appear = easeOutBack(min(1, CGFloat((now - appearStart) / 0.19)))
            changed = true
        }
        if swap < 1 {
            swap = min(1, CGFloat((now - swapStart) / 0.22))
            changed = true
        }
        for i in springs.indices {
            let target: CGFloat = i == hover ? 1 : 0
            var v = springs[i] + (target - springs[i]) * 0.32
            if abs(v - target) < 0.003 { v = target }
            if v != springs[i] { springs[i] = v; changed = true }
        }
        let ht: CGFloat = hover == -2 ? 1 : 0
        var nh = hubSpring + (ht - hubSpring) * 0.3
        if abs(nh - ht) < 0.003 { nh = ht }
        if nh != hubSpring { hubSpring = nh; changed = true }
        if changed {
            updateMask()
            canvas.needsDisplay = true
        }
    }

    // MARK: geometry

    private var scale: CGFloat {
        let swapScale = 0.92 + 0.08 * (1 - pow(1 - swap, 3))
        return (0.82 + 0.18 * appear) * swapScale
    }

    private func petal(_ i: Int, _ n: Int) -> (path: NSBezierPath, mid: CGFloat, pop: CGFloat) {
        let (a0, a1) = petalAngles(n, i)
        let s = i < springs.count ? springs[i] : 0
        let mid = (a0 + a1) / 2 * .pi / 180
        let pop = s * 7
        let c = NSPoint(x: center.x + cos(mid) * pop, y: center.y + sin(mid) * pop)
        let r0 = rIn * scale + corner, r1 = (rOut + s * 4) * scale - corner
        return (sectorPath(c, r0, r1, a0, a1, trim: gap / 2 + corner), mid, pop)
    }

    private func hubPath() -> NSBezierPath {
        let r = (rHub + hubSpring * 3) * scale - corner
        let p = NSBezierPath(ovalIn: NSRect(x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r))
        p.lineWidth = corner * 2
        return p
    }

    /// The blur only shows through the menu's shape.
    private func updateMask() {
        let n = items.count
        let shapes = (0..<n).map { petal($0, n).path } + [hubPath()]
        effect.maskImage = NSImage(size: NSSize(width: menuSize, height: menuSize), flipped: false) { _ in
            NSColor.black.set()
            for p in shapes {
                p.fill()
                p.stroke()
            }
            return true
        }
    }

    /// Petal index under a point in view coordinates; -2 = hub, -1 = nothing.
    func hit(_ p: NSPoint) -> Int {
        let dx = p.x - center.x, dy = p.y - center.y
        let d = hypot(dx, dy)
        if d <= rHub + 4 { return -2 }
        let n = items.count
        if n == 0 || d < rIn - 6 || d > rOut + 24 { return -1 }
        let angle = atan2(dy, dx) * 180 / .pi
        let span = 360 / CGFloat(n)
        var i = Int(((90 - angle) / span).rounded()) % n
        if i < 0 { i += n }
        return i
    }

    func setHover(_ h: Int) {
        guard h != hover else { return }
        hover = h
        if h >= 0 { hubArmed = true }   // visited a petal: resting on the hub may now flip rings
        hubTimer?.invalidate()
        if h == -2 && hubArmed && rings.count > 1 {
            hubTimer = Timer.scheduledTimer(withTimeInterval: 0.42, repeats: false) { [weak self] _ in self?.nextRing() }
        }
        startFrames()
        canvas.needsDisplay = true
    }

    // MARK: drawing

    func draw() {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let n = items.count
        let fade = 0.35 + 0.65 * swap
        for i in 0..<n {
            let (path, mid, pop) = petal(i, n)
            let s = i < springs.count ? springs[i] : 0
            fill(ctx, path, NSColor.white, alpha: (0.07 + 0.16 * s) * fade)
            if s > 0.01 { fill(ctx, path, NSColor.controlAccentColor, alpha: 0.45 * s) }
            let r = (rIn + rOut) / 2 * scale + pop
            let p = NSPoint(x: center.x + cos(mid) * r, y: center.y + sin(mid) * r)
            let item = items[i]
            let fg = NSColor.white.withAlphaComponent(fade)
            if item.glyph.isEmpty {
                text(item.label, at: p, size: n > 8 ? 13 : 15, weight: .semibold, color: fg)
            } else {
                text(item.glyph, at: NSPoint(x: p.x, y: p.y + 9), size: 20, weight: .regular, color: fg)
                text(item.label, at: NSPoint(x: p.x, y: p.y - 12), size: 11, weight: .medium, color: fg)
            }
        }

        fill(ctx, hubPath(), NSColor.white, alpha: 0.10 + 0.12 * hubSpring)
        var top = hubText, bottom = ""
        if hover >= 0 && hover < n {
            top = items[hover].label
            bottom = items[hover].hint
        } else if rings.count > 1 {
            let other = rings[(ringIndex + 1) % rings.count].name
            bottom = "\(rings[ringIndex].name)\n\(Settings.shared.triggerKey.symbol) for \(other)"
        } else if let r = rings.first {
            bottom = r.name
        }
        text(top, at: NSPoint(x: center.x, y: center.y + (bottom.isEmpty ? 0 : 11)), size: 13, weight: .semibold,
             color: .white, width: 86)
        if !bottom.isEmpty {
            text(bottom, at: NSPoint(x: center.x, y: center.y - 12), size: 9.5, weight: .regular,
                 color: NSColor.white.withAlphaComponent(0.7), width: 86)
        }
    }

    /// Fill + round-joined stroke as one layer, so the overlap doesn't double the alpha.
    private func fill(_ ctx: CGContext, _ path: NSBezierPath, _ color: NSColor, alpha: CGFloat) {
        ctx.saveGState()
        ctx.setAlpha(alpha)
        ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        color.set()
        path.fill()
        path.stroke()
        ctx.endTransparencyLayer()
        ctx.restoreGState()
    }

    private func text(_ s: String, at p: NSPoint, size: CGFloat, weight: NSFont.Weight, color: NSColor,
                      width: CGFloat = 110) {
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        para.lineBreakMode = .byWordWrapping
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.55)
        shadow.shadowBlurRadius = 3
        shadow.shadowOffset = NSSize(width: 0, height: -1)
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight),
                                                    .foregroundColor: color, .paragraphStyle: para, .shadow: shadow]
        let str = NSAttributedString(string: s, attributes: attrs)
        let bounds = str.boundingRect(with: NSSize(width: width, height: 200), options: [.usesLineFragmentOrigin])
        let rect = NSRect(x: p.x - width / 2, y: p.y - bounds.height / 2, width: width, height: bounds.height)
        str.draw(with: rect, options: [.usesLineFragmentOrigin])
    }

    // MARK: drag & drop

    func dragEntered(_ info: NSDraggingInfo) -> NSDragOperation {
        let files = Files.fileURLs(info.draggingPasteboard)
        guard !files.isEmpty else { return [] }
        gotDrag = true
        if files != paths { load(files) }
        return .copy   // never let the drop move or delete the original
    }

    func dragUpdated(_ info: NSDraggingInfo) -> NSDragOperation {
        setHover(hit(canvas.convert(info.draggingLocation, from: nil)))
        return gotDrag ? .copy : []
    }

    func dragExited() {
        setHover(-1)
    }

    func performDrop(_ info: NSDraggingInfo) -> Bool {
        let idx = hit(canvas.convert(info.draggingLocation, from: nil))
        guard idx >= 0 && idx < items.count else {
            close()
            return false
        }
        let item = items[idx], files = paths
        close()
        // hand control back to Finder's drag loop at once; do the work after
        DispatchQueue.main.async { self.onActivate?(item, files) }
        return true
    }

    /// Render the menu for `files` into a PNG (on a dark backdrop, since the blur needs a live window).
    func snapshot(_ files: [URL], hover h: Int, ring: Int, to out: URL) throws {
        load(files)
        if ring < rings.count { ringIndex = ring; springs = Array(repeating: 0, count: items.count) }
        hover = h
        if h >= 0 && h < springs.count { springs[h] = 1 }
        hubSpring = h == -2 ? 1 : 0
        appear = 1
        swap = 1
        let size = NSSize(width: menuSize, height: menuSize)
        guard let rep = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else { return }
        let bg = NSImage(size: size, flipped: false) { r in
            NSGradient(colors: [NSColor(calibratedRed: 0.10, green: 0.12, blue: 0.22, alpha: 1),
                                NSColor(calibratedRed: 0.28, green: 0.18, blue: 0.36, alpha: 1)])!.draw(in: r, angle: -45)
            return true
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        bg.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        canvas.cacheDisplay(in: canvas.bounds, to: rep)
        try rep.representation(using: .png, properties: [:])?.write(to: out)
    }

    // MARK: click mode (menu bar → Open, or Finder → Open With)

    func clicked(at p: NSPoint, right: Bool) {
        guard clickMode else { return }
        if right { close(); return }
        let idx = hit(p)
        if idx == -2 {
            nextRing()
        } else if idx >= 0 && idx < items.count {
            let item = items[idx], files = paths
            close()
            DispatchQueue.main.async { self.onActivate?(item, files) }
        } else {
            close()
        }
    }
}

final class RadialCanvas: NSView {
    weak var owner: RadialMenu?
    private var tracking: NSTrackingArea?

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        owner?.draw()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        tracking = t
    }

    override func mouseMoved(with event: NSEvent) {
        guard let o = owner, o.clickMode else { return }
        o.setHover(o.hit(convert(event.locationInWindow, from: nil)))
    }

    override func mouseExited(with event: NSEvent) {
        if owner?.clickMode == true { owner?.setHover(-1) }
    }

    override func mouseDown(with event: NSEvent) {}

    override func mouseUp(with event: NSEvent) {
        owner?.clicked(at: convert(event.locationInWindow, from: nil), right: false)
    }

    override func rightMouseUp(with event: NSEvent) {
        owner?.clicked(at: convert(event.locationInWindow, from: nil), right: true)
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: owner?.close()        // Esc
        case 48: owner?.nextRing()     // Tab
        default: super.keyDown(with: event)
        }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        owner?.dragEntered(sender) ?? []
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        owner?.dragUpdated(sender) ?? []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        owner?.dragExited()
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { true }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        owner?.performDrop(sender) ?? false
    }
}
