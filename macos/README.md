# ShiftDrop

A native macOS rewrite of [DragShift](https://github.com/llamaboi55/DragShift) (MIT): start dragging a
file in Finder, press **Control**, and drop it on a slice of the radial menu that opens under the
cursor. The result is saved next to the original; the original is never changed.

Swift + AppKit only — no Python, Qt or extra libraries. Menu-bar app, no Dock icon.

## Build and install

Needs the Xcode Command Line Tools (Swift 5.10+), macOS 13+.

```bash
./scripts/build-app.sh            # builds build/ShiftDrop.app
./scripts/build-app.sh --install  # also copies it to ~/Applications and opens it
```

## Use

1. Start dragging a file (image, PDF, Word or text) in Finder or on the desktop.
2. Press the trigger key (**Control** by default; change it in the menu bar → Trigger Key).
3. Drop on a slice. A notification shows what changed, with **Open**, **Show in Finder** and **Undo**
   (Undo moves the new file to the Trash).

Tap the trigger key again — or rest on the centre after visiting a slice — to switch between
**Convert** and **Tools**. Finder → right-click → **Open With → ShiftDrop** and menu bar →
**Open a File…** open the same menu in click mode.

| File | Convert to | Tools |
|---|---|---|
| Images (JPG, PNG, HEIC, WEBP, TIFF, AVIF, BMP, GIF, ICO) | Any format this Mac can write, or PDF. Several images → one combined PDF | Compress · Resize |
| PDF | JPG or PNG (one per page), TXT | Split · Rotate · Merge (drop several) |
| Word (.docx) | PDF, TXT | — |
| Text (.txt, .md, .csv, .json…) | PDF, DOCX | — |

Menu bar settings: trigger key, where results go (next to the original or a `ShiftDrop` subfolder),
image quality, PDF → image resolution, pause, start at login.

## How it works (from reading DragShift's source)

- **Trigger** (`DragWatcher.swift`): every 15 ms it polls `NSEvent.pressedMouseButtons` and
  `NSEvent.modifierFlags`, which give the global mouse/modifier state without Accessibility or Input
  Monitoring permission. Button held + moved 10 px + trigger key → open the menu. Unlike the
  original, it also checks that the system drag pasteboard changed since the mouse went down and
  holds file URLs, so dragging a window or text with the key held doesn't pop the menu.
- **Menu** (`RadialMenu.swift`): a borderless non-activating panel at pop-up-menu level, registered as a
  drag destination. It reads the dragged files from the drag pasteboard so the slices appear at once,
  and always answers `.copy` so a drop can never move the original. The glass is an
  `NSVisualEffectView` masked to the petal shapes (DragShift instead captures the screen and refracts
  it with numpy, which needs Screen Recording permission).
- **Actions** (`Converters.swift`): ImageIO for images (EXIF rotation applied), PDFKit for PDFs,
  `NSAttributedString` + Core Text for Word/text. Output is written to a hidden temp file and renamed.

## Headless commands (for scripts and testing)

```bash
B=build/ShiftDrop.app/Contents/MacOS/ShiftDrop
$B --rings photo.jpg                                  # what the menu offers
$B --run convert:PNG photo.jpg                        # convert
$B --run tool:Resize --resize=longest:1200 photo.jpg  # percent:50, width:800, height:600
$B --snapshot menu.png 0 0 photo.jpg                  # render the menu (hover petal 0, ring 0)
```

## Not yet ported

Crop, Edit, Annotate, Redact, Add BG, Metadata, PDF compress/protect/extract images, PDF → DOCX, and
compress-to-target-size. WEBP output depends on the macOS version (hidden when ImageIO can't write it).
