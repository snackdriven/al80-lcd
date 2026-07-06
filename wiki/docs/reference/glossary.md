---
title: Glossary
status: reference
scope: Terms and acronyms used across the wiki
---

# Glossary

Terms and acronyms used across the wiki.

- **VIA**: usevia.app, the browser configurator used for all keymap changes (no firmware
  recompile).
- **WebHID**: the browser HID API the yunzii-game.com LCD app uses; it strips the report-ID byte.
- **HID**: USB Human Interface Device; the AL80 exposes 4 HID interfaces (see [Hardware](../hardware/index.md)).
- **RGB565 BE**: 16-bit color, 5 bits red / 6 green / 5 blue, stored big-endian (2 bytes per pixel).
- **PK_\***: the display module's command set, spoken over USART3; the wire opcode equals the PK
  enum ordinal (see [Display commit](../protocol/display-commit.md)).
- **PK_ADD_PIC**: opcode `0x0C`, commit-the-scratch-buffer-and-display. The command that actually
  shows a still image.
- **PK_TOGGLE_PIC**: opcode `0x0D`, advance to the next stored picture slot (**not** "show this
  frame").
- **yne**: the additive checksum carried in `bytes[4,5]` (16-bit LE); one rule for every packet.
- **DFU**: Device Firmware Upgrade (bootloader) mode; entered by commands `0xB0–0xB7`. Avoid, brick
  risk.
- **NAK**: a negative/non-acknowledgement response (device returns `FF 00 00 …` for unsupported
  commands).
- **ACK**: acknowledgement; the device echoes a packet with `byte[6] = 0x55`.
- **CKSUM**: a one-byte additive checksum carried in a packet (formulas given per packet type).
- **announce / data / finish**: the three packet roles in every screen operation: `0x40` / `0x41`
  / `0x42`.
- **aw20216s**: the SPI LED driver chip that drives both the keys and the 3 side-bar LEDs (NOT
  WS2812).
- **ripple**: the YUNZII official v1.21 lighting firmware (bcdDevice `0x0121`), the stock build in
  use.
- **b75Pro**: a sibling YUNZII board whose QMK source shares the `PK_*` protocol family; used as a
  source reference for the AL80.
