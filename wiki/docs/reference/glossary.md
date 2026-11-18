---
title: Glossary
status: reference
scope: Terms and acronyms used across the wiki
---

# Glossary

This page gives the terms and acronyms that the wiki uses.

- **VIA**: usevia.app, the browser configurator for all keymap changes. It does not recompile the
  firmware.
- **WebHID**: the browser HID API that the yunzii-game.com LCD app uses. It removes the report-ID
  byte.
- **HID**: USB Human Interface Device. The AL80 has 4 HID interfaces (see [Hardware](../hardware/index.md)).
- **RGB565 BE**: 16-bit color with 5 bits red, 6 bits green, and 5 bits blue, stored big-endian
  (2 bytes per pixel).
- **PK_\***: the command set of the display module, sent over USART3. The wire opcode is the same
  as the PK enum ordinal (see [Display commit](../protocol/display-commit.md)).
- **PK_ADD_PIC**: opcode `0x0C`. It commits the scratch buffer and displays it. This is the command
  that shows a still image.
- **PK_TOGGLE_PIC**: opcode `0x0D`. It advances to the next stored picture slot. It does **not**
  mean "show this frame".
- **yne**: the additive checksum in `bytes[4,5]` (16-bit LE). One rule applies to every packet.
- **DFU**: Device Firmware Upgrade (bootloader) mode. Commands `0xB0–0xB7` start this mode. Do not
  use it. It can brick the keyboard.
- **NAK**: a negative acknowledgement (non-acknowledgement) response. The device returns
  `FF 00 00 …` for unsupported commands.
- **ACK**: an acknowledgement. The device echoes a packet with `byte[6] = 0x55`.
- **CKSUM**: a one-byte additive checksum in a packet. Each packet type has its own formula.
- **announce / data / finish**: the three packet roles in each screen operation: `0x40` / `0x41`
  / `0x42`.
- **aw20216s**: the SPI LED driver chip that drives the keys and the 3 side-bar LEDs (NOT
  WS2812).
- **ripple**: the YUNZII official v1.21 lighting firmware (bcdDevice `0x0121`). It is the stock
  build in use.
- **b75Pro**: a sibling YUNZII board. Its QMK source uses the same `PK_*` protocol family. This wiki
  uses it as a source reference for the AL80.
