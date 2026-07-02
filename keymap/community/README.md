# Community VIA files (not mine)

Third-party AL80 VIA files from the community, kept here for reference and credit. Source:
[github.com/ArgentStonecutter/keyboards](https://github.com/ArgentStonecutter/keyboards) under
`yunzii/al80/`, layout work by **@nvoostrom**.

| File | What it is |
|------|-----------|
| `AL80_QMK_V0104-FIX-20250424.json` | VIA **definition** — @nvoostrom's cleanup of Yunzii's dodgy V0104. Adds the missing 80th key and, more importantly, **25 named custom keycodes** the stock definition never exposed. |
| `al80_keyboard.layout.json` | VIA **keymap** — the vanilla factory layout (4 layers, volume encoders, no macros). |

## Why the FIX definition is worth having

Yunzii's own definitions — both the original V0104 and the newer V0106 in this repo's `keymap/`
— ship exactly **one** custom keycode (`KC_USB`). @nvoostrom reverse-engineered and named the
rest. The screen-control ones line up exactly with the view-switch HID commands decoded in
`../../AL80_KNOWLEDGE_BASE.md` §7:

| Keycode | shortName | Function |
|---------|-----------|----------|
| CUSTOM(22) | HOM | Go to Homepage (clock view) |
| CUSTOM(23) | IMG | Change to Image view |
| CUSTOM(24) | GIF | Change to GIF view |
| CUSTOM(10) | BLT | Backlight on/off |
| CUSTOM(17) / (18) | B+ / B- | LED brightness up / down |
| KC_USB, CUSTOM(1–4) | USB / BT1–3 / 2.4G | Connectivity |
| CUSTOM(6/7/8/9) | RST / LCK / SWW / SWM | Reset / lock Windows / switch Windows / switch Mac |

So if you want to bind "switch the LCD to the GIF view" (or homepage/image) to a key in VIA,
load this definition instead of the stock one — the keycodes are already there.

## Compared to this repo's own files

- `../AL80_QMK__V0106_20251219.json` — Yunzii's newer official definition (80 keys, but still
  only `KC_USB`; different menus/positions than the FIX).
- `../al80_keymap.json` — my customized keymap (layer-taps on F12/Caps, the snip macro). The
  `al80_keyboard.layout.json` here is the plain factory keymap by contrast.

## Related community work
- [Paz77/AL80-LCD-Screen-Customizer](https://github.com/Paz77/AL80-LCD-Screen-Customizer) — a
  macOS LCD customizer, but very early: it enumerates HID interfaces and writes blind test
  patterns to find the LCD interface. No protocol decoded yet (no packet structure, no RGB565).
  This repo's knowledge base is well ahead of it.
