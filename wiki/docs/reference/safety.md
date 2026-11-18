---
title: Safety / do-not-touch
status: reference
type: reference
scope: Brick risks, the DFU sequence to avoid, and the single-opener rule
---

# Safety / do-not-touch

Read this page before you send commands to the keyboard or flash firmware. It gives the brick
risks, the DFU sequence to avoid, and the single-opener rule.

!!! danger "Never send 0xB0–0xB7"
    Do **not** send commands `0xB0–0xB7`. Do **not** experiment with these commands. They can
    brick the keyboard or erase the firmware. These are bootloader / firmware-upgrade (DFU)
    commands. Send only `0x40/0x41/0x42`.

## ⚠️ Rules

- **Do not reflash carelessly.** Custom-QMK bins in `firmware/` replace the ripple lighting
  firmware. The ripple firmware is the full reason for the VIA-only and HID-script approach. Flash
  only on purpose and with care (see [Custom QMK](../firmware/custom-qmk.md)).
- **Use only one opener.** Only one process can open the `0xFF60` interface at a time. Close the
  browser tab and VIA before you run scripts.

## ❌ The exact DFU sequence to avoid

We decoded this sequence from source. A firmware update sends this sequence. Do **not** send it
manually:

    0xB1 toBootLoader
      → poll 0xB2 getBootLoaderStatus   (every 200 ms, ≤20 tries)
      → 0xB3 confirmFirmwareInfo         (56-byte header: bytes[6..9]=file size LE, bytes[10..13]=CRC32 LE)
      → 0xB4 startUpgrade
      → 0xB5 transferUpgradeData         (chunked)
      → 0xB6 upgradeComplete
      → 0xB7 endUpgrade

A second, colliding `mechanicalKeyboard*` DFU set (opcodes `0x00–0x04`/`0x10`/`0x20`/`0x55`)
also exists. It is for a different device family and does not apply to the AL80. Do not confuse
the two sets.
