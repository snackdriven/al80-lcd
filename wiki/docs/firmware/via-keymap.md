---
title: VIA keymap
status: confirmed
type: how-to
scope: Live keymap editing on stock ripple, the VIA command set, and the current layout
---

# VIA keymap

Use this page to edit the AL80 keymap live and to bind the custom LCD and panel keycodes.

[Ripple](../reference/glossary.md) is a stock QMK [VIA](../reference/glossary.md) build, so you can
edit the keymap live on the stock firmware. The screen stays intact, and you don't need to flash.
(Cert source `research/mk856-src/repo/yunzii/al80/`: `VIA_ENABLE`, `ENCODER_MAP_ENABLE`, 4 layers,
6×15 matrix = 90 positions, 16 macros, 1 encoder C6/C7.)

## 📟 LCD view-switch custom keycodes (Fn+9/8/0)

**Now live on the custom firmware** (compiled, flash pending — `AL80_CUSTOM_QMK_v28_keycodes.bin`).
For a long time, these keycodes did nothing on the custom build, because the build shipped no
`process_record`. That's fixed. When you press one of these keys, `process_record_kb` now sends the
host-free `PK_GO` view announce over USART3.

    CUSTOM(22) = 0x7E16 = HOME      (Fn+9, PK_GO_HOME 0x0B)
    CUSTOM(23) = 0x7E17 = PICTURE   (Fn+8, PK_TOGGLE_PIC 0x0D — advances the picture ring)
    CUSTOM(24) = 0x7E18 = GIF       (Fn+0, PK_GO_GIF 0x0F)

## 🔊 Panel-switch custom keycodes (`research/al80-hotkey-panel-switch-SPARC.md`)

**Firmware built (compiled, flash pending).** A key press fires the local view switch **and** sends
a `[0x4B, id]` report with `raw_hid_send`. The always-on host reads this report and routes it to the
panel cycler (host half = KB §9a).

    CUSTOM(25) = 0x7E19 = PANEL_NOWPLAYING   (view PICTURE + panel id 0x00)
    CUSTOM(26) = 0x7E1A = PANEL_WEATHER      (view PICTURE + panel id 0x01)
    CUSTOM(27) = 0x7E1B = PANEL_CLOCK        (view HOME    + panel id 0x02)
    CUSTOM(28) = 0x7E1C = CYCLE_TOGGLE       (panel id 0xF0, no local view)
    CUSTOM(29) = 0x7E1D = PANEL_NEXT         (panel id 0xF1, no local view)

## 🔧 Bind the custom keycodes

!!! warning "Dynamic-keymap shadowing — bind via Studio, not a stock VIA JSON edit"
    These keycodes are above the custom range that stock uses. (The highest stock keycode is
    `CUSTOM(24)`, the view-switch keys above.) The VIA dynamic keymap is the live EEPROM binding
    that `0x05`/`0x13` write. For a key that has a new binding, the dynamic keymap always wins over
    a static `keymap.json`/`keymap.c`.

    If you ever bound a different key over one of `CUSTOM(22-29)` in usevia.app or the al80-studio
    Keymap tab, that live binding shadows the firmware default. The shadow stays until you bind the
    key back or send `dynamic_keymap_reset` (`0x06`). Bind (and rebind) these keycodes through the
    al80-studio Keymap tab / usevia.app. Do not hand-edit a keymap JSON that you load one time. The
    JSON sets only the *default*, not the binding that is actually live on the board.

On a fresh board, the `keymap.c` defaults put the three view keys on Fn+8/9/0 (layer 1). If you
already use the board, bind the keys through Studio, because the live dynamic keymap shadows the
compiled default.

To bind a custom keycode:

1. Open the al80-studio **Keymap** tab, or open usevia.app.
2. Bind the key to its `CUSTOM(n)` keycode from the lists above.

Studio already writes the bindings (`buildKeymapSet` round-trips any `CUSTOM(n)`).

Both `CUSTOM(22-24)` and `CUSTOM(25-29)` now fire on the custom build. `process_record_kb`,
`al80_screen_view`, and `al80_panel_req` are in `firmware/al80-keyboard-src/al80.c`. They compile
into `AL80_CUSTOM_QMK_v28_keycodes.bin`. This bin isn't flashed yet. The on-device verification is
the morning playbook.

The **host** side is also built and tested. It reads the resulting `0x4B` report and routes it to
the panel cycler. See `AL80_KNOWLEDGE_BASE.md` §9a/§9c.

## 🛠️ Troubleshooting

!!! warning "Encoder CW/CCW direction — unconfirmed on hardware"
    The VIA/QMK encoder-map convention puts **CCW at index 0** (CW at index 1). But the al80-studio
    app currently treats **index 0 as CW**. If the encoder-bound actions occur in the reverse
    direction, suspect this off-by-one. To resolve it, bind two different keycodes and turn the
    knob.

## ⌨️ Background: current keymap

The live layout is in `keymap/al80_keymap.json` (4 layers, macros, encoders). The file
`keymap/AL80_QMK__V0106_20251219.json` is next to it. That file is the VIA keyboard *definition*,
not the bindings. VIA's blank "Any" key assigns `KC_NO`, not a custom keycode, so the JSON was
edited directly.

To edit the keymap JSON in usevia.app:

1. Save the keymap as JSON.
2. Edit the JSON file.
3. Load the edited JSON.

- **Layer 0:** F12 = `LT(1,KC_F12)`; Caps Lock = `LT(2,KC_CAPS)`; Del restored to `KC_DEL`.
- **Layer 1** (hold F12) app launcher: S=`LGUI(3)` T=`LGUI(4)` E=`LGUI(5)` C=`LGUI(6)`, rest TRNS.
- **Layer 2** (hold Caps): S=`MACRO(0)` snipping tool, N=`KC_NUM`, Q=`LALT(F4)` close window.
- **Macro 0** (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

Export note: VIA's **Save** button always works. Programmatic JS export is intermittent.
`window.__editedJSON` holds the keymap string when the site allows JS exec, so don't rely on it.
For the full VIA raw-HID protocol and the coexistence notes, see `research/via-protocol.md`.

## ⌨️ Background: supported VIA command set

**Solid (standard VIA):** keymap get/set `0x04/0x05`, bulk buffer `0x12/0x13`, layer count `0x11`,
encoder `0x14/0x15`, macros `0x0C–0x10`, switch-matrix key tester `0x02/0x03`, lighting `0x07–0x09`,
protocol version `0x01`.

**Out (Vial-only → need custom vial firmware):** tap dance, combos, key overrides, QMK settings,
VialRGB.

`hid.js` still needs a read path. Today, lighting only writes. To add one, port the
request/response queue from the-via `keyboard-api.ts`. Keycodes are 16-bit big-endian. The
flat↔matrix index is `i = row*15 + col`. The bulk offset is `layer*90*2 + i*2`.
