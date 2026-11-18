#!/bin/bash
# Builds ShiftDrop.app into build/. With --install, also copies it to ~/Applications and opens it.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=ShiftDrop
OUT="build/$APP.app"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/$APP"

if [ ! -f build/AppIcon.icns ]; then
  swift scripts/make-icon.swift build/AppIcon.iconset
  iconutil -c icns build/AppIcon.iconset -o build/AppIcon.icns
fi

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/$APP"
cp Resources/Info.plist "$OUT/Contents/Info.plist"
cp build/AppIcon.icns "$OUT/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$OUT"   # ad-hoc signature: fine for running on this Mac
echo "Built $OUT"

if [ "${1:-}" = "--install" ]; then
  pkill -x "$APP" 2>/dev/null || true
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/$APP.app"
  ditto "$OUT" "$HOME/Applications/$APP.app"
  open "$HOME/Applications/$APP.app"
  echo "Installed to ~/Applications/$APP.app (look for it in the menu bar)"
fi
