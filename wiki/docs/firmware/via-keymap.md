---
title: VIA keymap
status: confirmed
scope: Live keymap editing on stock ripple, the VIA command set, and the current layout
---

# VIA keymap

Ripple is a stock QMK VIA build, so live keymap editing works on stock firmware with the
screen intact, no flash. (Cert source `research/mk856-src/repo/yunzii/al80/`: `VIA_ENABLE`,
`ENCODER_MAP_ENABLE`, 4 layers, 6×15 matrix = 90 positions, 16 macros, 1 encoder C6/C7.)

## ⌨️ Supported VIA command set

**Solid (standard VIA):** keymap get/set `0x04/0x05`, bulk buffer `0x12/0x13`, layer count `0x11`,
encoder `0x14/0x15`, macros `0x0C–0x10`, switch-matrix key tester `0x02/0x03`, lighting `0x07–0x09`,
protocol version `0x01`.

**Out (Vial-only → need custom vial firmware):** tap dance, combos, key overrides, QMK settings,
VialRGB.

Read path must be added to `hid.js` (today lighting only writes; port the-via `keyboard-api.ts`
request/response queue). Keycodes are 16-bit big-endian; flat↔matrix `i = row*15 + col`; bulk
offset `layer*90*2 + i*2`.

## 📟 LCD view-switch custom keycodes (Fn+9/8/0)

**Now live on the custom firmware** (compiled, flash pending — `AL80_CUSTOM_QMK_v28_keycodes.bin`).
For a long time these did nothing on the custom build because it shipped no `process_record`; that's
fixed — `process_record_kb` now emits the host-free `PK_GO` view announce over USART3 on press.

    CUSTOM(22) = 0x7E16 = HOME      (Fn+9, PK_GO_HOME 0x0B)
    CUSTOM(23) = 0x7E17 = PICTURE   (Fn+8, PK_TOGGLE_PIC 0x0D — advances the picture ring)
    CUSTOM(24) = 0x7E18 = GIF       (Fn+0, PK_GO_GIF 0x0F)

## 🔊 Panel-switch custom keycodes (`research/al80-hotkey-panel-switch-SPARC.md`)

**Firmware built (compiled, flash pending).** Press fires the local view switch AND `raw_hid_send`s a
`[0x4B, id]` report the always-on host reads and routes to the panel cycler (host half = KB §9a).

    CUSTOM(25) = 0x7E19 = PANEL_NOWPLAYING   (view PICTURE + panel id 0x00)
    CUSTOM(26) = 0x7E1A = PANEL_WEATHER      (view PICTURE + panel id 0x01)
    CUSTOM(27) = 0x7E1B = PANEL_CLOCK        (view HOME    + panel id 0x02)
    CUSTOM(28) = 0x7E1C = CYCLE_TOGGLE       (panel id 0xF0, no local view)
    CUSTOM(29) = 0x7E1D = PANEL_NEXT         (panel id 0xF1, no local view)

!!! warning "Dynamic-keymap shadowing — bind via Studio, not a stock VIA JSON edit"
    These live above the stock-used custom range (stock tops out at `CUSTOM(24)` = the view-switch
    keys above). VIA's dynamic keymap (the live EEPROM binding written by `0x05`/`0x13`) always wins
    over whatever a static `keymap.json`/`keymap.c` says for a key that's been rebound — so if you've
    ever bound over one of `CUSTOM(22-29)` in usevia.app or al80-studio's Keymap tab, that live binding
    shadows the firmware default until you rebind it back or `dynamic_keymap_reset` (`0x06`). Bind these
    (and rebind them) through al80-studio's Keymap tab / usevia.app, not by hand-editing a keymap JSON
    you load once — the JSON only sets the *default*, not what's actually live on the board.

Both `CUSTOM(22-24)` and `CUSTOM(25-29)` now fire on the custom build: `process_record_kb` +
`al80_screen_view` + `al80_panel_req` are in `firmware/al80-keyboard-src/al80.c` and compile into
`AL80_CUSTOM_QMK_v28_keycodes.bin` (not yet flashed — on-device verify is the morning playbook). Studio
already writes the bindings (`buildKeymapSet` round-trips any `CUSTOM(n)`), and the **host** side that
reads the resulting `0x4B` report and routes it to the panel cycler is built and tested too — see
`AL80_KNOWLEDGE_BASE.md` §9a/§9c. Fresh-board `keymap.c` defaults put the three view keys on Fn+8/9/0
(layer 1); existing users bind via Studio because the live dynamic keymap shadows the compiled default.

!!! warning "Encoder CW/CCW direction — unconfirmed on hardware"
    VIA/QMK's encoder-map convention puts **CCW at index 0** (CW at index 1), but the al80-studio
    app currently treats **index 0 as CW**. If encoder-bound actions come out reversed, this
    off-by-one is the suspect. Resolve by binding two distinct keycodes and turning the knob.

## ⌨️ Current keymap

Live layout: `keymap/al80_keymap.json` (4 layers, macros, encoders). The
`keymap/AL80_QMK__V0106_20251219.json` alongside it is the VIA keyboard *definition*, not the
bindings. Workflow in usevia.app: Save-JSON → edit → Load-JSON (VIA's blank "Any" key assigns
`KC_NO`, not a custom keycode, so direct JSON editing was used).

- **Layer 0:** F12 = `LT(1,KC_F12)`; Caps Lock = `LT(2,KC_CAPS)`; Del restored to `KC_DEL`.
- **Layer 1** (hold F12) app launcher: S=`LGUI(3)` T=`LGUI(4)` E=`LGUI(5)` C=`LGUI(6)`, rest TRNS.
- **Layer 2** (hold Caps): S=`MACRO(0)` snipping tool, N=`KC_NUM`, Q=`LALT(F4)` close window.
- **Macro 0** (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

Export note: VIA's own Save button always works. Programmatic JS export is intermittent.
`window.__editedJSON` holds the keymap string when the site allows JS exec, so don't rely on it.
See `research/via-protocol.md` for the full VIA raw-HID protocol and coexistence notes.
