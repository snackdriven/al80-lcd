---
title: VIA keymap
status: confirmed
scope: Live keymap editing on stock ripple, the VIA command set, and the current layout
---

# VIA keymap

Ripple is a stock QMK **VIA** build, so live keymap editing works on stock firmware **with the
screen intact** — no flash. (Cert source `research/mk856-src/repo/yunzii/al80/`: `VIA_ENABLE`,
`ENCODER_MAP_ENABLE`, 4 layers, 6×15 matrix = 90 positions, 16 macros, 1 encoder C6/C7.)

## Supported VIA command set

**Solid (standard VIA):** keymap get/set `0x04/0x05`, bulk buffer `0x12/0x13`, layer count `0x11`,
encoder `0x14/0x15`, macros `0x0C–0x10`, switch-matrix key tester `0x02/0x03`, lighting `0x07–0x09`,
protocol version `0x01`.

**Out (Vial-only → need custom vial firmware):** tap dance, combos, key overrides, QMK settings,
VialRGB.

Read path must be added to `hid.js` (today lighting only writes; port the-via `keyboard-api.ts`
request/response queue). Keycodes are **16-bit big-endian**; flat↔matrix `i = row*15 + col`; bulk
offset `layer*90*2 + i*2`.

## LCD view-switch custom keycodes (stock Fn bindings)

    CUSTOM(22) = 0x7E16 = HOME      (Fn+9, PK_GO_HOME)
    CUSTOM(23) = 0x7E17 = PICTURE   (Fn+8, picture view)
    CUSTOM(24) = 0x7E18 = GIF       (Fn+0, PK_GO_GIF)

!!! warning "Encoder CW/CCW direction — unconfirmed on hardware"
    VIA/QMK's encoder-map convention puts **CCW at index 0** (CW at index 1), but the al80-studio
    app currently treats **index 0 as CW**. If encoder-bound actions come out reversed, this
    off-by-one is the suspect. Resolve by binding two distinct keycodes and turning the knob.

## Current keymap

Live layout: `keymap/al80_keymap.json` (4 layers, macros, encoders). The
`keymap/AL80_QMK__V0106_20251219.json` alongside it is the VIA keyboard *definition*, not the
bindings. Workflow in usevia.app: Save-JSON → edit → Load-JSON (VIA's blank "Any" key assigns
`KC_NO`, not a custom keycode, so direct JSON editing was used).

- **Layer 0:** F12 = `LT(1,KC_F12)`; Caps Lock = `LT(2,KC_CAPS)`; Del restored to `KC_DEL`.
- **Layer 1** (hold F12) app launcher: S=`LGUI(3)` T=`LGUI(4)` E=`LGUI(5)` C=`LGUI(6)`, rest TRNS.
- **Layer 2** (hold Caps): S=`MACRO(0)` snipping tool, N=`KC_NUM`, Q=`LALT(F4)` close window.
- **Macro 0** (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

Export note: VIA's own **Save** button always works. Programmatic JS export is intermittent —
`window.__editedJSON` holds the keymap string when the site allows JS exec, so don't rely on it.
See `research/via-protocol.md` for the full VIA raw-HID protocol and coexistence notes.
