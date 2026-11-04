import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private let toasts = ToastCenter()
    private lazy var actions = Actions(toasts: toasts)
    private let menu = RadialMenu()
    private let watcher = DragWatcher()
    private var launched = false
    private var pending: [URL] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let icon = NSImage(systemSymbolName: "circle.grid.cross", accessibilityDescription: "ShiftDrop")
        icon?.isTemplate = true
        statusItem.button?.image = icon
        let m = NSMenu()
        m.delegate = self
        statusItem.menu = m

        menu.describe = { [unowned self] in self.actions.describe($0) }
        menu.onActivate = { [unowned self] item, files in self.actions.run(item, files) }

        watcher.isMenuVisible = { [unowned self] in self.menu.isVisible && !self.menu.clickMode }
        watcher.menuHasFiles = { [unowned self] in self.menu.hasFiles }
        watcher.onShow = { [unowned self] pos, files in
            if self.menu.isVisible { self.menu.close() }
            self.menu.popup(at: pos, paths: files, click: false)
        }
        watcher.onToggle = { [unowned self] in self.menu.nextRing() }
        watcher.onHide = { [unowned self] in if !self.menu.clickMode { self.menu.close() } }
        watcher.start()

        launched = true
        if !pending.isEmpty {
            showClickMenu(pending)
            pending = []
        } else if !Settings.shared.welcomed {
            showWelcome()
        }
    }

    /// Finder → Open With → ShiftDrop (or a file dropped on the app icon).
    func application(_ application: NSApplication, open urls: [URL]) {
        if launched { showClickMenu(urls) } else { pending += urls }
    }

    private func showClickMenu(_ urls: [URL]) {
        menu.close()
        menu.popup(at: NSEvent.mouseLocation, paths: urls, click: true)
    }

    // MARK: menu bar menu

    func menuNeedsUpdate(_ m: NSMenu) {
        m.removeAllItems()
        let s = Settings.shared
        let hint = NSMenuItem(title: "Drag a file, press \(s.triggerKey.symbol), drop on a slice", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        m.addItem(hint)
        m.addItem(.separator())
        m.addItem(item("Open a File…", #selector(openFile), key: "o"))
        m.addItem(item(s.enabled ? "Pause" : "Resume", #selector(toggleEnabled)))
        m.addItem(.separator())

        m.addItem(submenu("Trigger Key", TriggerKey.allCases.map { ($0.title, $0.rawValue, $0 == s.triggerKey) },
                          #selector(setTrigger(_:))))
        m.addItem(submenu("Save Results", [("Next to the Original", OutputPlace.next.rawValue, s.output == .next),
                                           ("In a “\(Files.subfolder)” Subfolder", OutputPlace.folder.rawValue, s.output == .folder)],
                          #selector(setOutput(_:))))
        m.addItem(submenu("Image Quality", [70, 80, 90, 100].map { ("\($0)%", "\($0)", $0 == s.quality) },
                          #selector(setQuality(_:))))
        m.addItem(submenu("PDF → Image Resolution", [150, 200, 300].map { ("\($0) dpi", "\($0)", $0 == s.pdfDPI) },
                          #selector(setDPI(_:))))
        let login = item("Start at Login", #selector(toggleLogin))
        login.state = s.startAtLogin ? .on : .off
        m.addItem(login)
        m.addItem(.separator())
        m.addItem(item("How It Works…", #selector(showWelcome)))
        m.addItem(item("Quit ShiftDrop", #selector(quit), key: "q"))
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    private func submenu(_ title: String, _ choices: [(String, String, Bool)], _ action: Selector) -> NSMenuItem {
        let parent = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (label, value, on) in choices {
            let i = item(label, action)
            i.representedObject = value
            i.state = on ? .on : .off
            sub.addItem(i)
        }
        parent.submenu = sub
        return parent
    }

    @objc private func openFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Choose files to convert or edit"
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, !panel.urls.isEmpty {
            showClickMenu(panel.urls)
        }
    }

    @objc private func toggleEnabled() { Settings.shared.enabled.toggle() }

    @objc private func setTrigger(_ sender: NSMenuItem) {
        if let v = sender.representedObject as? String, let k = TriggerKey(rawValue: v) { Settings.shared.triggerKey = k }
    }

    @objc private func setOutput(_ sender: NSMenuItem) {
        if let v = sender.representedObject as? String, let o = OutputPlace(rawValue: v) { Settings.shared.output = o }
    }

    @objc private func setQuality(_ sender: NSMenuItem) {
        if let v = (sender.representedObject as? String).flatMap(Int.init) { Settings.shared.quality = v }
    }

    @objc private func setDPI(_ sender: NSMenuItem) {
        if let v = (sender.representedObject as? String).flatMap(Int.init) { Settings.shared.pdfDPI = v }
    }

    @objc private func toggleLogin() {
        do {
            try Settings.shared.setStartAtLogin(!Settings.shared.startAtLogin)
        } catch {
            toasts.error("Couldn't change Start at Login", "Run ShiftDrop from its app bundle (build it with scripts/build-app.sh). \(friendly(error))")
        }
    }

    @objc private func showWelcome() {
        Settings.shared.welcomed = true
        let alert = NSAlert()
        alert.messageText = "ShiftDrop is in your menu bar"
        alert.informativeText = """
        1. Start dragging a file in Finder or on the desktop (images, PDFs, Word or text files).
        2. Press \(Settings.shared.triggerKey.title) — a menu opens under the cursor.
        3. Drop the file on a slice. The result is saved next to the original; the original never changes.

        Tap the key again (or rest on the centre) to switch between Convert and Tools. \
        You can also use Finder's Open With → ShiftDrop, or Open a File… from the menu bar.
        """
        alert.addButton(withTitle: "Got It")
        if !Settings.shared.startAtLogin { alert.addButton(withTitle: "Got It — Start at Login") }
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn { toggleLogin() }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
