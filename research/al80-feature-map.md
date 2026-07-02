---
title: YUNZII AL80 — Feature → Modification-Method Map
status: active
created: 2026-07-02
device: YUNZII AL80 (VID 0x28E9, PID 0x30AF), Ripple Lighting firmware
purpose: Cross-reference the AL80's advertised feature set against the files in this repo, and document what is modifiable and HOW for each.
sources: AL80_KNOWLEDGE_BASE.md (canonical), keymap/*.json, keymap/community/*, research/via-protocol.md, firmware/YUNZII_AL80_RIPPLE.bin, yunzii.com product/manual pages
---

# YUNZII AL80 — Feature → Modification-Method Map

Four ways to change anything on this keyboard. Every feature below maps to exactly one (or a
mix) of them:

| Method | What it drives | Tooling we have |
|--------|----------------|-----------------|
| **VIA app** (usevia.app) | keymap, layers, macros, encoder, **RGB lighting**, brightness | `keymap/*.json` (definition + keymap), open protocol in `research/via-protocol.md` |
| **Fn-layer shortcuts** (onboard) | connectivity, RGB effect/brightness, LCD view, battery check | firmware-fixed defaults; **remappable** via VIA custom keycodes |
| **Our HID tool** (0x40/0x41/0x42) | **LCD only** — clock, image, GIF, date | `tooling/al80_clock.*`, `converter/`, protocol fully decoded in KB §4–7, §14 |
| **Firmware flash** (DFU 0xB0–0xB7) | everything at once | `firmware/YUNZII_AL80_RIPPLE.bin` kept for recovery — **do NOT flash** (KB §13) |

---

## 1. File Inventory

### Firmware
| File | Role |
|------|------|
| `firmware/YUNZII_AL80_RIPPLE.bin` | The Ripple-lighting firmware (66,780 bytes, **TTComp-compressed archive**, SHA-256 `54bac6f5…`). Recovery/reference copy only. **Not human-greppable** — see note below. |

> **Firmware grep result:** the `.bin` is a compressed TTComp blob — `strings` returns **zero**
> printable runs. So the RGB effect names, `rgblight`/`rgb_matrix` symbols, and keycode strings
> are **NOT extractable from the binary**. Every effect/keycode name in this doc comes from the
> **VIA definition JSON** (`id_qmk_rgb_matrix_effect` dropdown) and the community keycode map,
> which is the authoritative source for what the flashed firmware exposes.

### Keymap / VIA JSON
| File | Role |
|------|------|
| `keymap/al80_keymap.json` | **The live keymap** — 4 layers, 1 macro, 1 encoder. Load in VIA to restore bindings. |
| `keymap/AL80_QMK__V0106_20251219.json` | Yunzii's official VIA **definition** (hardware description: 6×15 matrix, layouts, Lighting menu). Ships only `KC_USB`. |
| `keymap/AL80_QMK_V0106-with-keycodes.json` | **Best-of-both definition** — V0106 layout/menus + @nvoostrom's **25 custom keycodes** grafted on (HOM/IMG/GIF, backlight, brightness, connectivity, OS switch). Load this to bind those functions. |
| `keymap/AL80_QMK__V0106_20251219.zip` | Zip of the stock definition (provenance). |
| `keymap/community/AL80_QMK_V0104-FIX-20250424.json` | @nvoostrom's fixed V0104 definition — origin of the 25 named custom keycodes. |
| `keymap/community/al80_keyboard.layout.json` | Vanilla factory keymap (4 layers, volume encoder, no macros). |

### LCD protocol / research
| File | Role |
|------|------|
| `AL80_KNOWLEDGE_BASE.md` | **Canonical** LCD HID protocol reference (fully decoded). |
| `research/via-protocol.md` | VIA raw-HID command set + how it shares the 0xFF60 interface with the LCD. |
| `research/captures/*.json`, `research/image_capture/*`, `research/gif_capture/*` | Raw HID captures + findings that decoded the protocol. |
| `research/source-notes/*` | Superseded session notes (kept for provenance). |
| `tooling/`, `converter/`, `apps/` | Clock scripts, image→RGB565 converter, decompiled reference apps. |

---

## 2. Feature → Modification-Method Table

| Feature | Modify via | How / where | Evidence |
|---------|-----------|-------------|----------|
| **RGB effect (mode)** | VIA "Lighting" tab **or** Fn shortcut | VIA `id_qmk_rgb_matrix_effect` dropdown (20 options); or press `RGB_MOD` on the Fn layer | `keymap/*V0106*.json` menus; `al80_keymap.json` L1 has `RGB_MOD` |
| **RGB brightness** | VIA slider, Fn shortcut, or custom keycode | VIA `id_qmk_rgb_matrix_brightness` (0–255); or `RGB_VAI`/`RGB_VAD`; or `CUSTOM(17/18)` B+/B- | `al80_keymap.json` L1 binds `RGB_VAI/VAD` + `CUSTOM(17/18)` |
| **RGB color / hue** | VIA color picker or Fn | VIA `id_qmk_rgb_matrix_color`; or `RGB_HUI` | `al80_keymap.json` L1 `RGB_HUI`; menu `id_qmk_rgb_matrix_color` |
| **RGB effect speed** | VIA slider or Fn | VIA `id_qmk_rgb_matrix_effect_speed`; or `RGB_SPI`/`RGB_SPD` | `al80_keymap.json` L1 `RGB_SPI/SPD`; menu key |
| **Backlight on/off** | Fn / custom keycode | `CUSTOM(10)` BLT | `al80_keymap.json` L1 binds `CUSTOM(10)` |
| **LCD clock (time)** | **Our HID tool only** | `0x40`→`0x41 sub0x03 [HH MM SS]`→`0x42`; 12hr hack `HH=(h%12)||12` | KB §5, §6; `tooling/al80_clock.*` |
| **LCD date** | **Our HID tool only** | `0x41 sub0x04 [YY DOW MM DD]` | KB §5c |
| **LCD still image** | **Our HID tool only** | 548× `0x41` blocks of RGB565-BE pixels (112×137) | KB §7, §12; `converter/` |
| **LCD GIF** | **Our HID tool only** | banked frames + frame-count/FPS trailing bytes | KB §7 (GIF), §14c |
| **LCD view switch (clock/img/gif)** | Fn keycode **or** HID | `CUSTOM(22/23/24)` HOM/IMG/GIF; or announce type 11/13/15 | KB §7 view-switch table; `al80_keymap.json` binds all three |
| **LCD brightness / saturation / grayscale** | **Bake into pixels** (no opcode) | client-side only; transform your RGB565 buffer before sending | KB §7 "Display attributes are client-side" |
| **LCD battery / connection status page** | firmware-generated (view only) | shown by firmware on its homepage; no push opcode for it | yunzii.com feature page; KB (no status opcode on 0xFF60) |
| **Keymap / layers / macros** | VIA | `keymap/al80_keymap.json` via Save/Load | KB §9 |
| **Encoder (knob)** | VIA | `0x14/0x15` encoder set; all layers = Vol-/Vol+ | `al80_keymap.json` encoders; via-protocol.md |
| **Bluetooth 1/2/3 pairing** | Fn / custom keycode | `CUSTOM(1/2/3)` BT1-3 | community keycode map; `al80_keymap.json` binds them |
| **2.4G pairing** | Fn / custom keycode | `CUSTOM(4)` 2.4G | same |
| **USB mode** | Fn / custom keycode | `KC_USB` | stock + community definitions |
| **Battery-level check** | Fn shortcut (fixed) | `Fn + Right Ctrl` — LEDs 1–0 show % | yunzii AL80 instruction manual |
| **OS switch (Win/Mac)** | Fn / custom keycode | `CUSTOM(8)` SWW / `CUSTOM(9)` SWM | community keycode map; bound in `al80_keymap.json` |
| **Lock Windows** | custom keycode | `CUSTOM(7)` LCK | same |
| **Factory reset** | custom keycode | `CUSTOM(6)` RST | same |

---

## 3. RGB Lighting — Detail

**20 effects exposed by VIA** (`id_qmk_rgb_matrix_effect` dropdown, both the stock V0106 and the
with-keycodes definition carry the same list). Index = value VIA writes. Chinese label + English
name as shipped:

| Idx | Effect | Idx | Effect |
|----:|--------|----:|--------|
| 0 | All Off | 10 | Cycle Pinwheel |
| 1 | Solid Color | 11 | Cycle Spiral |
| 2 | Breathing | 12 | Dual Beacon |
| 3 | Band Val. | 13 | Rainbow Beacon |
| 4 | Cycle All | 14 | Typing Heatmap |
| 5 | Cycle Left/Right | 15 | Digital Rain |
| 6 | Cycle Up/Down | 16 | Solid Reactive Simple |
| 7 | Rainbow Moving Chevron | 17 | Solid Reactive Nexus |
| 8 | Cycle Out/In | 18 | Splash |
| 9 | Cycle Out/In Dual | 19 | Solid Splash |

These are stock **QMK RGB Matrix** animations — matches Yunzii's "over 20 dynamic backlight
modes" marketing. The "Ripple" effect the firmware is named for is a Yunzii addition and does
**not** appear in the VIA dropdown (it's a firmware-only effect not surfaced to VIA — see Gaps).

**Modification methods (in order of ease):**
1. **VIA Lighting tab** — pick effect, brightness (0–255), speed (0–255), color. Written over the
   VIA custom-menu protocol (`CUSTOM_MENU_SET_VALUE 0x07` on the lighting channel, saved with
   `0x09`). No recompile. (`research/via-protocol.md`, "How the AL80's lighting menus work.")
2. **Fn shortcuts** — the live keymap binds `RGB_MOD` (next effect), `RGB_HUI` (hue),
   `RGB_VAI/VAD` (brightness ±), `RGB_SPI/SPD` (speed ±) on Layer 1, plus `CUSTOM(10)` backlight
   toggle and `CUSTOM(17/18)` brightness ±.
3. **Our keymap JSON exposes lighting keycodes:** yes — see `al80_keymap.json` Layers 1 & 3
   (`RGB_MOD`, `RGB_HUI`, `RGB_VAI`, `RGB_VAD`, `RGB_SPI`, `RGB_SPD`). So lighting is remappable
   to any key.
4. **Firmware recompile** — only needed to add/replace effects (e.g. expose Ripple to VIA). We
   have the `.bin` but it's compressed and reflashing is off-limits (KB §13).

---

## 4. LCD — Detail

The LCD is driven **entirely over the HID screen protocol we decoded**, NOT via VIA. VIA has no
LCD menu. 112×137, RGB565 big-endian, 3-packet ops (`0x40` announce → `0x41` data → `0x42`
finish). Full byte-maps in KB §4–7 and §14.

| LCD function | Covered? | Method |
|--------------|:--------:|--------|
| Clock (12/24hr) | ✅ working | `tooling/al80_clock.*`; 12hr via raw-hour hack (KB §6) |
| Date | ✅ decoded | `0x41 sub0x04` (KB §5c) |
| Still image | ✅ decoded + tool | `converter/` renders 112×137 RGB565, streams 548 blocks (KB §7, §12) |
| GIF | ✅ decoded | banked frames + FPS/frame-count bytes (KB §7, §14c) — forging needs a fresh capture to reconcile the 0x02/0x03 vs 0x09/0x0A/0x07 variant (KB §14c note) |
| View switch (clock/img/gif) | ✅ | HID announce type 11/13/15, **or** the HOM/IMG/GIF keycodes |
| Brightness / saturation / grayscale / sharpen | ⚠️ client-side | no device opcode — bake the effect into the pixel buffer before sending (KB §7) |
| Background / wallpaper | ✅ (as a still image) | it's just a still-image upload |
| Battery / connection status page | ❌ read-only | firmware renders it; no opcode to push or restyle it |

---

## 5. Custom Keycode Map (25 keycodes, from `AL80_QMK_V0106-with-keycodes.json`)

| Keycode | shortName | Function | Method it triggers |
|---------|-----------|----------|--------------------|
| `KC_USB` | USB | USB mode | connectivity |
| `CUSTOM(1)` | BT1 | Bluetooth device 1 | connectivity |
| `CUSTOM(2)` | BT2 | Bluetooth device 2 | connectivity |
| `CUSTOM(3)` | BT3 | Bluetooth device 3 | connectivity |
| `CUSTOM(4)` | 2.4G | Pair 2.4G dongle | connectivity |
| `CUSTOM(5)` | C05 | *unnamed / unknown* | — |
| `CUSTOM(6)` | RST | Reset keyboard (factory) | firmware `restKeyBoard` 0x20 (KB §14a) |
| `CUSTOM(7)` | LCK | Lock Windows | OS |
| `CUSTOM(8)` | SWW | Switch to Windows | OS mode |
| `CUSTOM(9)` | SWM | Switch to Mac | OS mode |
| `CUSTOM(10)` | BLT | Backlight on/off | RGB |
| `CUSTOM(11–16)` | C11–C16 | *unnamed / unknown* | — |
| `CUSTOM(17)` | B+ | LED brightness up | RGB |
| `CUSTOM(18)` | B- | LED brightness down | RGB |
| `CUSTOM(19–21)` | C19–C21 | *unnamed / unknown* | — |
| `CUSTOM(22)` | HOM | LCD → Homepage (clock) view | LCD announce type 11 |
| `CUSTOM(23)` | IMG | LCD → Image view | LCD announce type 13 |
| `CUSTOM(24)` | GIF | LCD → GIF view | LCD announce type 15 |

The HOM/IMG/GIF keycodes internally emit the `0x40/0x41/0x42` screen commands (via-protocol.md).
So a keypress and our HID tool reach the same firmware handler.

---

## 6. Layers, Knob & Onboard Shortcuts (`al80_keymap.json`)

- **Layer 0 (base):** standard 75%. `F12 = LT(1,F12)`, `Caps = LT(2,Caps)`, `KC_MUTE` on the far
  key, arrows bottom-right.
- **Layer 1 (Fn, hold F12):** the "everything" layer — connectivity (`CUSTOM 1-4`), LCD views
  (`CUSTOM 22-24`), RGB (`RGB_MOD/HUI/VAI/VAD/SPI/SPD`, `CUSTOM 10/17/18`), media
  (prev/play/next, vol, mute), brightness (`KC_BRID/BRIU`), OS switch (`CUSTOM 9`), reset
  (`CUSTOM 6`), lock (`CUSTOM 7`), plus app-launcher combos `G(KC_3..6)`.
- **Layer 2 (hold Caps):** utility — `MACRO(0)` snip, `KC_NUM`, `LALT(F4)` close window.
- **Layer 3:** near-duplicate of Layer 1 (Fn variant; adds `CUSTOM(8)` switch-to-Windows,
  `CUSTOM(14)`, `C(KC_UP)`).
- **Macro 0:** Windows Snipping Tool — `Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI)`.
- **Encoder / knob:** one encoder, **Vol- / Vol+ on all 4 layers**. Fully remappable in VIA
  (`0x14/0x15`). The knob's press (mute) is a key in the matrix, not the encoder. Marketing lists
  the knob as "volume / lighting / mode switching," but our keymap only assigns volume — the
  other knob behaviors would need remapping.

**Are Fn shortcuts firmware-fixed or remappable?** Both. The *factory* Fn layer is firmware
default, but because this is a VIA board the entire Fn layer (Layer 1) is **fully remappable** —
our `al80_keymap.json` already customizes it. The only genuinely fixed shortcut found is
`Fn + Right Ctrl` = battery check (handled below the VIA keymap layer, per the manual).

---

## 7. Connectivity (from the manual + product page)

Tri-mode: **Bluetooth (up to 3 devices) + 2.4G dongle + USB-C**, up to 5 device links total,
Win/Mac/Android/iOS, 6000mAh battery. All switching is exposed as custom keycodes
(`KC_USB`, `CUSTOM 1-4`) so it's **remappable in VIA**. Battery-level check (`Fn + Right Ctrl`,
LEDs 1–0 show %) appears firmware-fixed. Note: for both VIA and the LCD tool the keyboard should
be **wired** (KB §1) — the 0xFF60 interface is most reliable over USB.

---

## 8. Gaps — Advertised but NOT modifiable with what we have

| Gap | Why | What it would take |
|-----|-----|--------------------|
| **"Ripple" lighting effect** | It's the firmware's signature effect but is **not** in the VIA `id_qmk_rgb_matrix_effect` dropdown, and the `.bin` is compressed so we can't read/relocate it. You can *use* Ripple on-device but can't reconfigure or extract it. | Decompile/patch firmware, or capture the exact VIA effect-index Ripple occupies (it may be a higher index the dropdown doesn't list). |
| **LCD battery / connection status page styling** | Firmware renders it; no HID opcode to push or restyle it (only clock/image/gif have opcodes). | Firmware mod — off-limits. Workaround: build your own status as a still-image (KB §11 "LIVE INFO PANEL"). |
| **LCD brightness / saturation / grayscale as live settings** | No device opcode — they're client-side only (KB §7). | None needed; bake into the RGB565 buffer before upload. |
| **GIF forging (end-to-end)** | Two protocol variants exist (repo capture uses setup subcmds 0x09/0x0A/0x07 + 1KB banks; decompiled app uses 0x02/0x03). Frame-count/FPS bytes decoded but not replayed on-device. | One fresh capture on *this* firmware to confirm which path it takes (KB §14c note). |
| **`CUSTOM(5)`, `CUSTOM(11–16)`, `CUSTOM(19–21)`** | Named "Custom Function N" in the definition — function unknown; not decoded. | Bind one and observe, or capture HID while pressing. |
| **`CUSTOM(25)`** | Bound in `al80_keymap.json` (Layers 1 & 3, on the Del/mute key) but the with-keycodes definition only defines up to `CUSTOM(24)`. Undefined keycode — likely a leftover or a media/mute function. | Reconcile the keymap against a definition that defines index 25; or rebind. |
| **Effect-list index vs firmware ID mismatch** | The definition's `showIf` hides Color for effects `24/28/29/32` — indices beyond the 0–19 dropdown, implying the underlying QMK enum uses standard (non-sequential) IDs the dropdown flattens. | Cosmetic; verify only if scripting VIA lighting writes directly. |

---

## 9. Bottom line

- **RGB:** VIA Lighting tab or Fn keys. 20 effects, all remappable. Ripple itself is a firmware
  black box.
- **LCD:** our HID tool only (`0x40/0x41/0x42`). Clock/date/image/GIF/view-switch all decoded;
  brightness etc. baked into pixels; battery/status page is read-only firmware.
- **Keymap/knob/shortcuts:** VIA. 4 layers, one volume knob, 25 custom keycodes (HOM/IMG/GIF,
  connectivity, brightness, OS switch). Fully remappable except the fixed `Fn+RCtrl` battery check.
- **Connectivity:** BT×3 / 2.4G / USB, all as remappable custom keycodes.
- **Never:** flash firmware (`0xB0–0xB7` DFU, KB §13). The Ripple `.bin` is recovery-only.
