import AppKit

/// Watches for "left button held + mouse moved + trigger key pressed" anywhere on screen,
/// which is what a Shift+drag of a file looks like. Polls the global input state every 15 ms:
/// NSEvent.pressedMouseButtons / modifierFlags need no Accessibility or Input Monitoring permission.
///
/// Unlike the original, it also checks the system drag pasteboard: a file drag rewrites it as
/// soon as it starts, so a Shift+drag of a window or a text selection doesn't open the menu.
final class DragWatcher {
    var isMenuVisible: () -> Bool = { false }
    var menuHasFiles: () -> Bool = { false }
    var onShow: (NSPoint, [URL]?) -> Void = { _, _ in }
    var onToggle: () -> Void = {}
    var onHide: () -> Void = {}

    static let dragThreshold: CGFloat = 10   // px the mouse must travel with the button held
    static let noDragTimeout = 50            // ticks (≈ 0.75 s) without a file arriving before hiding
    static let fallbackTicks = 25            // show anyway if the pasteboard stays silent this long

    private var timer: Timer?
    private let dragPasteboard = NSPasteboard(name: .drag)
    private var downAt: NSPoint?
    private var changeCountAtDown = 0
    private var fired = false
    private var keyWas = false
    private var heldTicks = 0
    private var idleTicks = 0
    private var shownAt = NSPoint.zero
    private var hidePending = false

    func start() {
        let t = Timer(timeInterval: 0.015, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        let lbtn = NSEvent.pressedMouseButtons & 1 != 0
        let key = NSEvent.modifierFlags.contains(Settings.shared.triggerKey.flag)
        let esc = CGEventSource.keyState(.combinedSessionState, key: 53)
        let pos = NSEvent.mouseLocation

        if isMenuVisible() {
            if !lbtn || esc {
                // the drop happened (or was cancelled): give the drop a moment to land
                if !hidePending {
                    hidePending = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                        self.hidePending = false
                        self.onHide()
                    }
                }
            } else if key && !keyWas && menuHasFiles() {
                onToggle()   // tap the key again to flip Convert ⇄ Tools
            } else if !menuHasFiles() && manhattan(pos, shownAt) > 6 {
                idleTicks += 1
                if idleTicks > Self.noDragTimeout { onHide() }
            }
        } else if lbtn {
            if downAt == nil {
                downAt = pos
                fired = false
                heldTicks = 0
                changeCountAtDown = dragPasteboard.changeCount
            }
            let moved = manhattan(pos, downAt!) >= Self.dragThreshold
            if Settings.shared.enabled && moved && key && !fired {
                heldTicks += 1
                if dragPasteboard.changeCount != changeCountAtDown {
                    let files = Files.fileURLs(dragPasteboard)
                    fired = true   // a fresh drag: files open the menu, anything else (text, a window) never does
                    if !files.isEmpty { show(pos, files) }
                } else if heldTicks > Self.fallbackTicks {
                    fired = true
                    show(pos, nil)
                }
            }
        } else {
            downAt = nil
            fired = false
        }
        keyWas = key
    }

    private func show(_ pos: NSPoint, _ files: [URL]?) {
        idleTicks = 0
        shownAt = pos
        onShow(pos, files)
    }

    private func manhattan(_ a: NSPoint, _ b: NSPoint) -> CGFloat {
        abs(a.x - b.x) + abs(a.y - b.y)
    }
}
