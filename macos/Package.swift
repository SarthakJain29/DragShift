// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "ShiftDrop",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "ShiftDrop",
            path: "Sources/ShiftDrop",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("PDFKit"),
                .linkedFramework("ServiceManagement"),
            ]
        )
    ]
)
