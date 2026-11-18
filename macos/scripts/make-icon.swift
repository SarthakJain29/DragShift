// Draws the app icon (a radial menu on a gradient tile) into an .iconset folder.
// Usage: swift scripts/make-icon.swift build/AppIcon.iconset
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    let tile = NSRect(x: s * 0.1, y: s * 0.1, width: s * 0.8, height: s * 0.8)
    let shape = NSBezierPath(roundedRect: tile, xRadius: s * 0.18, yRadius: s * 0.18)
    NSGradient(colors: [NSColor(calibratedRed: 0.36, green: 0.30, blue: 0.95, alpha: 1),
                        NSColor(calibratedRed: 0.10, green: 0.70, blue: 0.95, alpha: 1)])!.draw(in: shape, angle: -60)
    let c = NSPoint(x: s / 2, y: s / 2)
    let n = 6
    for i in 0..<n {
        let span = 360 / CGFloat(n)
        let a0 = 90 + span / 2 - CGFloat(i + 1) * span + 4, a1 = a0 + span - 8
        let p = NSBezierPath()
        p.appendArc(withCenter: c, radius: s * 0.3, startAngle: a0, endAngle: a1, clockwise: false)
        p.appendArc(withCenter: c, radius: s * 0.15, startAngle: a1, endAngle: a0, clockwise: true)
        p.close()
        NSColor.white.withAlphaComponent(i == 0 ? 0.95 : 0.45).setFill()
        p.fill()
    }
    NSColor.white.withAlphaComponent(0.9).setFill()
    NSBezierPath(ovalIn: NSRect(x: c.x - s * 0.1, y: c.y - s * 0.1, width: s * 0.2, height: s * 0.2)).fill()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
    try! draw(base).write(to: out.appendingPathComponent("icon_\(base)x\(base).png"))
    try! draw(base * 2).write(to: out.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
print("wrote \(out.path)")
