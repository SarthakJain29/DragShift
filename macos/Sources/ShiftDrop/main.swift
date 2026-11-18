import AppKit

// Headless mode for scripts and tests:
//   ShiftDrop --rings FILE...                  list what the menu would offer
//   ShiftDrop --run convert:PNG FILE...        run an action and print its summary + outputs
//   ShiftDrop --run tool:Resize --resize=percent:50 FILE...
//   ShiftDrop --snapshot OUT.png HOVER RING FILE...   render the menu to an image (HOVER: petal, -2 hub, -1 none)
let args = Array(CommandLine.arguments.dropFirst())
if args.first == "--snapshot", args.count >= 5 {
    _ = NSApplication.shared
    let menu = RadialMenu()
    menu.describe = { Actions(toasts: ToastCenter()).describe($0) }
    let files = args.dropFirst(4).map { URL(fileURLWithPath: $0).standardizedFileURL }
    try menu.snapshot(files, hover: Int(args[2]) ?? -1, ring: Int(args[3]) ?? 0, to: URL(fileURLWithPath: args[1]))
    exit(0)
}
if let flag = args.first, flag == "--run" || flag == "--rings" {
    let rest = args.dropFirst(flag == "--run" ? 2 : 1)
    let files = rest.filter { !$0.hasPrefix("--") }.map { URL(fileURLWithPath: $0).standardizedFileURL }
    if flag == "--rings" {
        for ring in Actions.buildRings(files) {
            print("\(ring.name): \(ring.items.map(\.label).joined(separator: ", "))")
        }
        exit(0)
    }
    let key = args.count > 1 ? args[1] : ""
    let resize = rest.first { $0.hasPrefix("--resize=") }.flatMap { ResizeSpec(parse: String($0.dropFirst(9))) }
    do {
        let (_, srcs, work) = try Actions.job(key, files, resize: resize)
        let outs = try work()
        let s = Report.summarize(key, srcs, outs)
        print([s.title, s.detail, s.good].filter { !$0.isEmpty }.joined(separator: " | "))
        outs.forEach { print($0.path) }
        exit(0)
    } catch {
        FileHandle.standardError.write("ERROR: \(friendly(error))\n".data(using: .utf8)!)
        exit(1)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
