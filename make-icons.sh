#!/bin/sh
# Generates the icons in img/ from the design, a transparent 512px image.
# Needs ImageMagick. Run it after changing the design or a value below.
set -e
cd "$(dirname "$0")/img"

DESIGN=emoji_u1f469_200d_1f3eb_3d.png
BACKGROUND=white
SCALE=64% # All but the favicon: the largest size that keeps the design inside the safe area

# The design smaller, inside the safe area: a circle 80% as wide as the icon.
magick "$DESIGN" -resize "$SCALE" -background "$BACKGROUND" -gravity center -extent 512x512 \
  -alpha remove -strip -alpha off -depth 8 \
  -write pwa-icon-512x512.png -write pwa-icon-512x512-maskable.png \
  -resize 180x180 apple-touch-icon.png

# The design alone, edge to edge on a transparent background.
magick "$DESIGN" -trim +repage -resize 512x512 -background none -gravity center -extent 512x512 \
  -strip -define icon:auto-resize=48,32,16 favicon.ico
