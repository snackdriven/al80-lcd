# Firmware

## ⭐ Custom-QMK versions — KNOWN-GOOD: `AL80_CUSTOM_QMK_v19_rgbfx2.bin`

**v19 is the most-working build so far (marked 2026-07-06).** Flash it if a newer one misbehaves — keys + Vial + clean LCD images + battery + 18 RGB effects, all confirmed. Also copied as `AL80_KNOWN-GOOD_v19.bin` for a quick grab.

| Version | What it is | Status |
|---|---|---|
| v13 | colors correct; keys + RGB + Vial (LCD image still sheared) | ok |
| v14 | RGB-pause → clean LCD images (+ host per-bank pacing) | ok |
| v15–v17 | battery telemetry attempts (v17 = fixed charging+full) | ok |
| v18 | 14 RGB matrix effects enabled | ok |
| **v19** | **+ Digital Rain + Pixel Rain (18 effects) + battery + everything** | **⭐ KNOWN-GOOD** |
| v20 | reactive/splash effects (drops tap-dance/combos/key-overrides — unused) | staged, untested |
| v21 | separate LED-bar colour control | building |

Flash via QMK Toolbox: hold **ESC + plug in USB** → stm32duino DFU → flash the `.bin`. Chip is **STM32F103x8** (56 KB app flash — v19/v20 near ~99%; 20 KB RAM). Source backups in `al80-keyboard-src/`.

## `YUNZII_AL80_RIPPLE.bin`

The YUNZII AL80 **ripple-lighting firmware** — the exact build this whole project is built around. Everything in the repo assumes this firmware stays flashed; the HID-script approach exists precisely so the LCD can be driven **without** reflashing to stock QMK and losing the ripple effect.

| | |
|--|--|
| File | `YUNZII_AL80_RIPPLE.bin` |
| Size | 66,780 bytes |
| Format | TTComp archive (compressed firmware blob) |
| SHA-256 | `54bac6f5813f8fbc10e96625ce1f5f9c49d9483274ed73c47d92bb389f3d2d5d` |
| Source | yunzii.com/pages/software |

Kept here as a recovery/reference copy. It's YUNZII's binary, not my work — original copyright applies.

**Do not flash casually.** Reflashing is exactly what this project avoids. If you ever need to restore, the safe path is YUNZII's official updater with this exact build; the raw `0xB0–0xB7` DFU HID commands documented in the knowledge base are the dangerous, brick-prone route and should be left alone.
