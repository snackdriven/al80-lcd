---
title: Safety / do-not-touch
status: reference
scope: Brick risks, the DFU sequence to avoid, and the single-opener rule
---

# Safety / do-not-touch

!!! danger "Never send 0xB0–0xB7"
    `0xB0–0xB7` are bootloader / firmware-upgrade (DFU) commands. Do **not** experiment with them —
    risk of bricking or wiping firmware. Stick to `0x40/0x41/0x42`.

## Rules

- **Never reflash carelessly.** The ripple lighting firmware is the whole reason for the VIA-only
  and HID-script approach. Custom-QMK bins in `firmware/` replace it — treat every flash as
  deliberate (see [Custom QMK](../firmware/custom-qmk.md)).
- **Only one opener** of the `0xFF60` interface at a time: close the browser tab (and VIA) before
  running scripts.

## The exact DFU sequence to avoid

Decoded from source — this is what a firmware update does, so never send it manually:

    0xB1 toBootLoader
      → poll 0xB2 getBootLoaderStatus   (every 200 ms, ≤20 tries)
      → 0xB3 confirmFirmwareInfo         (56-byte header: bytes[6..9]=file size LE, bytes[10..13]=CRC32 LE)
      → 0xB4 startUpgrade
      → 0xB5 transferUpgradeData         (chunked)
      → 0xB6 upgradeComplete
      → 0xB7 endUpgrade

A second, colliding `mechanicalKeyboard*` DFU set (opcodes `0x00–0x04`/`0x10`/`0x20`/`0x55`) exists
for a different device family — irrelevant to the AL80, just don't confuse the two.
