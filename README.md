# AL80 LCD

I reverse-engineered the YUNZII AL80's LCD over raw HID, the whole protocol, then kept going well past where I meant to stop. It started as "get a 12-hour clock on the screen without reflashing." It's now the full display protocol, a browser app that drives it, a custom vial-qmk firmware, and a wiki.

The screen turned out to be a separate smart module the keyboard just forwards pixels to over serial. That one fact is the whole story: it's why the LCD keeps working even after you flash custom firmware.

**Start here:** the **[wiki](https://snackdriven.github.io/al80-studio/wiki/)** (protocol reference, firmware guide, hardware notes, how-tos). Firmware **[releases](../../releases/latest)**. The browser control panel lives in the sibling [al80-studio](https://github.com/snackdriven/al80-studio) repo.

## What's here

| Path | What it is |
|------|-----------|
| [`AL80_KNOWLEDGE_BASE.md`](AL80_KNOWLEDGE_BASE.md) | The full write-up in one file: device, HID protocol, the display commit, image/GIF formats, custom firmware, hardware. The wiki is this, split up and searchable. |
| [`wiki/`](wiki/) | MkDocs source behind the hosted wiki. |
| [`firmware/`](firmware/) | Custom firmware builds (v1.0.0 = known-good) + the stock RIPPLE recovery bin + source backups. |
| [`tooling/`](tooling/) | The original no-reflash clock scripts (Node + Python). |
| [`converter/`](converter/) | `al80-image` — turns any image into a still-image transfer. |
| [`research/`](research/) | The raw material: HID captures, descriptors, the b75Pro sibling QMK source, test patterns. |
| [`keymap/`](keymap/) | VIA/QMK keymap export. |

## The gist

Four HID interfaces; only `0xFF60 / 0x61` (the VIA/raw one) drives the LCD. A screen op is three 64-byte reports, announce then data then finish, with a 16-bit additive checksum on every packet and a CRC16-MODBUS on the announce.

The clock hack, whole:
```
h  = (hour24 % 12) || 12
40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1     announce
41 00 00 03 <cksum> 00 00 <h> <min> <sec>     time
42 00 00 38 7A                                 finish
```
The panel draws whatever hour you hand it, so send 1–12 instead of 0–23 and you get a 12-hour clock. No AM/PM. The keyboard free-runs its clock from the last value, so re-sync every ~60s or it drifts.

Panel: **96×160, RGB565 big-endian, row-major**, 30,720 bytes a frame. (The old "112×137" was a misread; a live capture settled it.) VID `0x28E9` / PID `0x30AF`, wired only. One app holds `0xFF60` at a time, so close the yunzii-game.com tab first.

## Where it went

The clock was just the start. Since then: still images and GIFs on the screen, and a custom **vial-qmk firmware** that keeps the LCD and adds Vial, per-key RGB (VialRGB), reactive effects, an independently-colored side LED bar, and a battery gauge. Spotify now-playing runs live on the panel. The flashing walkthrough and the full protocol are in the wiki.

## Safety

`0xB0–0xB7` are the bootloader/DFU commands. Don't send them by hand, that's how you brick it. Everything on the LCD side stays on `0x40/0x41/0x42`.

## Not mine

`research/site_assets/` and `firmware/YUNZII_AL80_RIPPLE.bin` are YUNZII's, kept only as reference. Their copyright.
