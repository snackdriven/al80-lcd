#!/usr/bin/env bash
# AL80 firmware build -> verify -> release. The default way to ship firmware.
#
# Usage:  ./release.sh <version> "<title>" "<notes>"
#   e.g.  ./release.sh v1.3.0 "per-layer encoder" "Each layer's knob does its own thing."
#
# Builds the vial-qmk firmware in WSL, checks it fits the 56 KB flash cap (reads
# __flash0_size__ from the ELF, no guessing), stages + commits the bin, and cuts a GitHub
# release with it attached. Aborts before releasing if the build overflows flash.
set -euo pipefail

VER="${1:?usage: ./release.sh <version> \"<title>\" \"<notes>\"  (version like v1.3.0)}"
TITLE="${2:-$VER}"
NOTES="${3:-AL80 custom firmware $VER.}"
LCD="$(cd "$(dirname "$0")/.." && pwd)"          # repo root
REPO="snackdriven/al80-lcd"
QMK='export PATH="$HOME/opt/arm/bin:$HOME/.local/bin:$PATH"; cd ~/qmkwork/vial-qmk'

echo "== build (WSL qmk) =="
# dfu-suffix isn't installed here, so qmk returns non-zero on its final (cosmetic) step even
# though the .bin built fine. Tolerate that, then confirm the .bin genuinely exists below.
wsl.exe -e bash -lc "$QMK; qmk compile -kb yunzii/al80 -km vial" 2>&1 | tail -2 || true
if ! wsl.exe -e bash -lc "$QMK; test -f .build/yunzii_al80_vial.bin"; then
  echo "build failed -- no .bin produced. Aborting."; exit 1
fi

echo "== verify it fits the flash cap =="
read -r USED CAP < <(wsl.exe -e bash -lc "$QMK
cap=\$(arm-none-eabi-nm .build/yunzii_al80_vial.elf | awk '/__flash0_size__/{print \$1}')
printf '%d %d' \$(stat -c%s .build/yunzii_al80_vial.bin) \$((16#\$cap))" | tr -d '\r')
FREE=$((CAP - USED))
echo "used=$USED  cap=$CAP  free=$FREE"
if [ "$FREE" -lt 0 ]; then
  echo "OVERFLOW by $((-FREE)) bytes — aborting. Nothing committed or released."
  exit 1
fi

echo "== stage bin + source backup =="
BIN="AL80_firmware_${VER}.bin"
wsl.exe -e bash -lc "$QMK
cp .build/yunzii_al80_vial.bin /mnt/c/Users/bette/al80-lcd/firmware/$BIN
cp .build/yunzii_al80_vial.bin /mnt/c/Users/bette/Downloads/$BIN
cp keyboards/yunzii/al80/{al80.c,config.h,rules.mk} /mnt/c/Users/bette/al80-lcd/firmware/al80-keyboard-src/ 2>/dev/null || true
cp keyboards/yunzii/al80/keymaps/vial/{keymap.c,rules.mk} /mnt/c/Users/bette/al80-lcd/firmware/al80-keyboard-src/ 2>/dev/null || true"

echo "== commit =="
cd "$LCD"
git add "firmware/$BIN" firmware/al80-keyboard-src/
git -c user.name=snackdriven -c commit.gpgsign=false commit -q -m "firmware $VER: $TITLE ($FREE bytes flash free)" || echo "(nothing new to commit)"
git push -q origin main || true

echo "== release $VER =="
gh release create "$VER" --repo "$REPO" "firmware/$BIN" --latest \
  --title "$TITLE — $VER" \
  --notes "$NOTES

Fits with $FREE bytes of the 56 KB flash to spare. Newer than v1.0.0, which stays the known-good fallback."
echo "released $VER"
