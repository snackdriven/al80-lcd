---
title: Full byte-map reference
status: confirmed
scope: Source-decoded command map, still/GIF upload byte-maps, view-switch and clear commands
---

# Full byte-map reference

Cross-checked against two independent front-ends: the **web app** JS bundle
(`research/site_assets/index-8Bj3uPPc.js`) and the **desktop app** (`MK856.exe`, a Qt5 native app
whose export/RTTI symbols name every routine: `HidWriteLCDHead/Data/EndInfo` = 0x40/0x41/0x42,
`WriteDeviceLCDPicture/Gif/GifHead/GifEnd/GIFFrameRate/Time/Date`). Both are front-ends over the
identical HID protocol.

!!! tip "TL;DR"

    - Source-decoded from two front-ends (web JS bundle + `MK856.exe`); `0x40/0x41/0x42` = announce/data/finish.
    - There is **no battery %** in this protocol — `0x55` decodes only a sleep bit.
    - View-switch `PK_*` commands have real semantics (`0x0D` advances slots — don't send after an upload); the `0xB0-0xB7` DFU sequence is documented **to AVOID**.

## 📖 Command map (AL80 uses the `GamingKeyboard2` opcode profile)

    0x10 beginConnect · 0x11 endConnect · 0x12/0x13 get/setDeviceMessage · 0x14/0x15 get/setData ·
    0x16 getKeyboard · 0x17/0x18 get/setKeyMessage · 0x19/0x1A get/setLightMessage ·
    0x1B/0x1C get/setMacro · 0x1D/0x1E tbLight on/off · 0x1F getPoorNum · 0x20 restKeyBoard(factory
    reset) · 0x21 getLightRect · 0x30/0x31 get/setProfile · 0x32-0x35 Fn message ·
    0x36-0x3B magnetic-axis config · 0x40 announce · 0x41 data · 0x42 finish ·
    0x55 getDongleAndKeyboardStatus · 0xB0-0xB7 firmware/DFU (see Safety)

`getDongleAndKeyboardStatus (0x55)` decodes **only a sleep bit** (`hasSleep = !response[7]`).
Despite the name there is **no battery %** in this protocol. Per-radio backlight/sleep timers
(wired/2.4G/BT) live in the device-config blob at byte offsets 23 / 15,17 / 19,21, not as opcodes.

## 🖼️ Still-image upload (type 0x10) — full byte-map

    announce (0x40):  A5 5A 10 00 01 [crcHi crcLo] 01
    length   (0x41):  A5 5A 0C [lenHi lenLo] [crc]        ; len = width·height·2, BIG-ENDIAN
    pixels   (0x41):  RGB565 big-endian bytes, auto-chunked (see Chunking)
    finish   (0x42):  (empty)

RGB565 packed `((R>>3)<<11)|((G>>2)<<5)|(B>>3)` off a canvas resized with
`imageSmoothingEnabled=false`, split high-byte-first (`v>>8`, `v&255`).

## 🎞️ GIF upload (types 0x12/0x13) — frame-count + FPS

    start  (0x40):  A5 5A 12 00 02 [crc] [mode] 00        ; mode 0/1/2
    start  (0x41):  A5 5A 13 00 02 [crc] [mode] 00
    per frame:
      header (0x41): A5 5A 10 00 03 [crc] 02 [mode] [frameIdx]
      length (0x41): A5 5A 11 [lenHi lenLo] [crc]         ; per-frame len, BIG-ENDIAN
      pixels (0x41): RGB565 BE, 1024-byte logical chunks then physical chunking
      (every 16th frame: ~3 s pause for the device's flash write)
    FINISH (0x41):  A5 5A 12 00 02 [crc] [mode] [FRAME_COUNT]   ; count in the trailing byte
    FINISH (0x41):  A5 5A 13 00 02 [crc] [mode] [FPS]           ; FPS in the trailing byte
    finish (0x42):  (empty)

- **FRAME COUNT** = trailing byte of the type-18 finish (capped 64/160/42 by mode).
- **FPS** = trailing byte of the type-19 finish (slider **1–60**, default **30**).

## 📟 View-switch and clear commands (from source)

These `PK_*` commands have real semantics: they are not neutral page toggles. See
[Display commit (PK_*)](display-commit.md).

| Command | type `byte[9]` | subcmd `byte[11]` | Notes |
|---|---|---|---|
| Switch to homepage (clock) | `0x0B` | 0 | `PK_GO_HOME` |
| Switch to picture page | `0x0D` | 0 | `PK_TOGGLE_PIC` — **advances to next slot**, do NOT send after an upload |
| Switch to GIF page | `0x0F` | 0 | `PK_GO_GIF` |
| Update device time | `0x09` | 3 | payload `[H,M,S]` |
| Update device date | `0x0A` | 4 | payload `[YY,DOW,MM,DD]` |
| Clear picture | `0x0E` | — | sent **16×** (once per image slot) |
| Clear GIF | `0x12` sub 1 → `0x13` sub 2 | — | two announces |

The announce CRC16-MODBUS was generalized and verified on 5 distinct commands (homepage `0x0200`,
picture `0x03E0`, GIF `0xC341`, time-A `0xC3E1`, time-B `0x0150`).

!!! note "Community cross-reference"
    @nvoostrom's VIA definition (`keymap/community/AL80_QMK_V0104-FIX-20250424.json`) exposes the
    three view switches as named custom keycodes `HOM` / `IMG` / `GIF`, independently confirming
    they are first-class firmware view commands. The stock LCD view-switch keycodes are
    `CUSTOM(22)=0x7E16 HOME` (Fn+9), `CUSTOM(23)=0x7E17 PICTURE` (Fn+8), `CUSTOM(24)=0x7E18 GIF`
    (Fn+0).

## ⚠️ DFU / firmware-upgrade sequence (documented to AVOID)

See [Safety / do-not-touch](../reference/safety.md). Decoded from source:
`0xB1 toBootLoader` → poll `0xB2 getBootLoaderStatus` → `0xB3 confirmFirmwareInfo` (56-byte header,
size LE @ `[6..9]`, CRC32 LE @ `[10..13]`) → `0xB4 startUpgrade` → `0xB5 transferUpgradeData` →
`0xB6 upgradeComplete` → `0xB7 endUpgrade`. **Never send this.**
