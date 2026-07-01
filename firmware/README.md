# Firmware

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
