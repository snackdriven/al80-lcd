# VIA raw-HID protocol (and how it shares the AL80's 0xFF60 interface)

Reverse-engineering notes for **usevia.app** (VIA), the keyboard configurator. Unlike YUNZII's
app, VIA is **open source** (`github.com/the-via/app`), so this is taken from the authoritative
source (`src/utils/keyboard-api.ts`) and confirmed against the live bundle. It matters here
because VIA drives the keyboard over the **exact same HID interface as the AL80 LCD** —
`usagePage 0xFF60 / usage 0x61` (confirmed in the live bundle: `usagePage 65376`, `usage 97`).
That shared interface is why "only one opener at a time," and why the AL80 can be VIA-configurable
*and* drive its screen without a reflash.

## Wire format

    write:  [ 0x00, command, ...args ]   padded to 33 bytes (report-id 0 + 32 data)
    read:   the firmware ECHOES the command bytes back (VIA verifies resp == command+args)

VIA uses 32-byte reports; the AL80's 0xFF60 collection is 64 bytes, so the 32 meaningful bytes
just sit in the low half of the AL80's 64-byte report (rest ignored). The command-echo ACK is
the same idea as the screen protocol's echo (byte[6]=0x55, see `AL80_KNOWLEDGE_BASE.md` §4).

## Command set (`APICommand`, byte[1] after the report id)

| Cmd | Name | Purpose |
|-----|------|---------|
| 0x01 | GET_PROTOCOL_VERSION | VIA protocol version handshake |
| 0x02 | GET_KEYBOARD_VALUE | read a keyboard value (sub-id below) |
| 0x03 | SET_KEYBOARD_VALUE | write a keyboard value |
| 0x04 / 0x05 | DYNAMIC_KEYMAP_GET/SET_KEYCODE | one key's keycode (layer,row,col) |
| 0x07 / 0x08 / 0x09 | CUSTOM_MENU_SET/GET/SAVE_VALUE | **custom menus** (lighting/RGB/etc.) |
| 0x0A | EEPROM_RESET | wipe VIA EEPROM |
| 0x0B | BOOTLOADER_JUMP | jump to bootloader (**DFU — avoid**, like the AL80's 0xB1) |
| 0x0C–0x10 | DYNAMIC_KEYMAP_MACRO_* | macro count / buffer size / get / set / reset |
| 0x11 | DYNAMIC_KEYMAP_GET_LAYER_COUNT | number of layers |
| 0x12 / 0x13 | DYNAMIC_KEYMAP_GET/SET_BUFFER | bulk keymap read/write |
| 0x14 / 0x15 | DYNAMIC_KEYMAP_GET/SET_ENCODER | encoder (knob) mappings |

`GET/SET_KEYBOARD_VALUE` sub-ids (`KeyboardValue`): 0x01 UPTIME, 0x02 LAYOUT_OPTIONS,
0x03 SWITCH_MATRIX_STATE, 0x04 FIRMWARE_VERSION, 0x05 DEVICE_INDICATION.

## How the AL80's lighting menus work

The AL80 VIA definition's menus (Lighting / Backlight / Brightness / Effect / Effect Speed /
Color) are **VIA custom menus**, driven by `CUSTOM_MENU_GET_VALUE (0x08)` / `SET_VALUE (0x07)` /
`SAVE (0x09)`. Each read/write carries a `[channel, valueId, …]` selector. So changing the
ripple-lighting effect in VIA is a `0x07` write on the lighting channel — plain VIA protocol, no
vendor magic. (nvoostrom's `B+`/`B-`/`BLT` custom *keycodes* are different: they're firmware
keycodes that, when pressed, make the firmware run its own lighting/screen handler.)

## The shared interface — how VIA and the LCD coexist

Everything on `0xFF60` is "raw HID," routed by the first command byte:

- **VIA range:** `0x01–0x15` (keymap/macro/layer/encoder/custom-menu config).
- **YUNZII screen range:** `0x40 announce / 0x41 data / 0x42 finish` (LCD), `0x55` status,
  `0xB0–0xB7` DFU. These sit **above** VIA's range, so they don't collide with normal VIA use.
- The AL80's LCD custom keycodes (`HOM`/`IMG`/`GIF`, see `keymap/community/`) are firmware
  keycodes that internally emit the `0x40/0x41/0x42` screen commands.

**Caveat worth a capture:** YUNZII's own app models the AL80 as a `GamingKeyboard2` profile with
vendor opcodes `0x10–0x3B` (begin/endConnect, get/setData, magnetic-axis, etc. — see
`AL80_KNOWLEDGE_BASE.md` §14a). Those **numerically overlap VIA's `0x10–0x15`**. Both can't be
honored on the same byte at once, so the AL80's shipped (VIA-compatible ripple) firmware almost
certainly implements the **VIA** set on `0xFF60`, and the `GamingKeyboard2` opcodes are the
yunzii-game.com app's model for other YUNZII boards / a different mode. Confirm with a capture
before assuming the vendor 0x10–0x3B commands work on this board.

## Bottom line

VIA is open, stable, and well-understood; the only project-relevant reverse-engineering was
confirming it uses the same `0xFF60` interface and mapping how its command range coexists with
the LCD's `0x40+` screen commands. The screen protocol was designed to live *above* VIA's
command space — which is exactly why you get a VIA-configurable keyboard with a scriptable LCD
and never have to reflash.
