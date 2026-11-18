---
title: Glossary
status: reference
type: reference
scope: Terms and acronyms used across the wiki
---

# Glossary

Use this page to look up a term or abbreviation you've met elsewhere in the wiki. Terms are in
alphabetical order.

- **ACK**: an acknowledgement. The device echoes a packet back with `byte[6] = 0x55`.
- **ACK-gate**: send one `0x41` data block, then wait for the module's ACK (`byte[6] = 0x55`)
  before you send the next block. Match the op and the full offset in the echo. If the ACK does
  not come, send the block again, up to 4 times. ACK-gating fixes the red/blue banding (see
  [Chunking & pacing](../protocol/chunking-and-pacing.md)).
- **announce / data / finish**: the three packet roles in every screen operation: `0x40` / `0x41`
  / `0x42`. The announce is the header packet, the data packets carry the payload, and the finish is
  the commit packet (see [Protocol overview](../protocol/index.md)).
- **aw20216s**: the SPI LED driver chip that drives the keys and the 3 side-bar LEDs. It's **not**
  a WS2812.
- **b75Pro**: a sibling YUNZII board. Its QMK source uses the same `PK_*` protocol family, so this
  wiki uses it as a source reference for the AL80.
- **bank**: a 1024-byte slice of a GIF frame. Inside a bank, the offset in `bytes[1,2]` runs from
  0 to `0x3F0`, then starts again for the next bank. Main-page (mode-2) transfers are banked too
  (see [Chunking & pacing](../protocol/chunking-and-pacing.md)).
- **blast**: sending data blocks as fast as possible, with no flow control. On the picture page it
  drops bytes, which causes red/blue banding. On a banked main-page transfer, the banks overwrite
  each other and the screen turns white. ACK-gating (picture page) or per-bank pacing (main page)
  fixes it.
- **CKSUM**: a one-byte additive checksum in a packet. Each packet type has its own formula.
- **DFU**: Device Firmware Upgrade (bootloader) mode. Commands `0xB0–0xB7` start this mode. Do not
  use it. It can brick the keyboard.
- **HID**: USB Human Interface Device. The AL80 has 4 HID interfaces (see [Hardware](../hardware/index.md)).
- **NAK**: a negative acknowledgement (non-acknowledgement). The device sends back `FF 00 00 …`
  for commands it doesn't support.
- **PK_\***: the display module's command set, sent over USART3. The wire opcode is the same as
  the PK enum ordinal (see [Display commit](../protocol/display-commit.md)).
- **PK_ADD_PIC**: opcode `0x0C`. It commits the scratch buffer and displays it. This is the
  command that shows a still image.
- **PK_TOGGLE_PIC**: opcode `0x0D`. It moves to the next stored picture slot. It does **not**
  mean "show this frame".
- **RGB565 BE**: 16-bit color with 5 bits red, 6 bits green, and 5 bits blue, stored big-endian
  (2 bytes per pixel).
- **ripple**: YUNZII's official v1.21 lighting firmware (bcdDevice `0x0121`). It's the stock build
  in use.
- **settle**: a mandatory wait in the picture display sequence. Wait about 300 ms after the
  announce. Wait about 30 ms after the `PK_ADD_PIC` setup. If you skip the settles, the frame is
  not displayed (see [Display commit](../protocol/display-commit.md)).
- **single-opener rule**: only one process can open the `0xFF60` HID interface at a time. VIA and
  the LCD use the same interface. Close the vendor tab and VIA before you run a host script (see
  [Safety](safety.md)).
- **VIA**: usevia.app, the browser configurator for all keymap changes. It doesn't recompile the
  firmware.
- **WebHID**: the browser HID API that the yunzii-game.com LCD app uses. It removes the report-ID
  byte.
- **yne**: the additive checksum in `bytes[4,5]` (16-bit LE). One rule applies to every packet.
