#!/usr/bin/env bash
# Re-render the PNG icons and link-preview image in public/ from scripts/brand/.
# Needs a Chromium or Chrome binary (set CHROME=/path/to/chrome to override).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}"
shot() { "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$2" --screenshot="$PWD/$3" "file://$PWD/$1" 2>/dev/null; }

shot scripts/brand/og-image.html 1200,630 public/og-image.png
for size in 180 192 512; do
  cat > scripts/brand/.icon.html <<HTML
<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}img{width:100%;height:100%;display:block}</style>
<img src="icon-square.svg">
HTML
  out=public/icon-$size.png
  [ "$size" = 180 ] && out=public/apple-touch-icon.png
  shot scripts/brand/.icon.html "$size,$size" "$out"
done
rm scripts/brand/.icon.html
ls -l public/*.png
