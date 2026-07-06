---
title: Quick reference
status: confirmed
scope: All key constants in one table
---

# Quick reference

All key constants in one place. Deep detail lives in the [Protocol](../protocol/index.md) section.

| Thing | Value |
|---|---|
| Device | YUNZII AL80 mechanical keyboard with color LCD |
| Vendor ID / Product ID | `0x28E9` / `0x30AF` |
| LCD HID interface | usagePage `0xFF60`, usage `0x61` (raw / VIA) |
| Report ID / report size | 0 (unnumbered) / 64 data bytes |
| Display resolution | **96 × 160 px, portrait** (corrected from 112×137) |
| Pixel format | RGB565, **big-endian**, 2 bytes/px, **row-major**, top-left origin |
| Full frame size | **30,720 bytes** = 96×160×2 = 548 × 56-byte blocks **+ 1 × 32-byte tail** (byte[3]=0x20 at 0x77E0); total len 0x7800 |
| Screen-op sequence | `0x40` announce → `0x41` data → `0x42` finish |
| Display module protocol | **PK_* over USART3** (wire opcode = enum ordinal): 0x0B GO_HOME · **0x0C ADD_PIC (commit+display)** · 0x0D TOGGLE_PIC (advance-slot, ≠ show) · 0x0E DEL_PIC · 0x0F GO_GIF · 0x10 GUI_EVENT · 0x12 GIF_NUM · 0x13 GIF_FRAME |
| Picture DISPLAY sequence | announce(0x10) → **300 ms** → setup/**PK_ADD_PIC**(0x0C,len) → **30 ms** → 549 ACK-GATED data blocks → finish(0x42). **NO trailing view switch** |
| Reliable send | **ACK-gate each 0x41 block** (wait for byte[6]=0x55, match op+full offset, resend ≤4×). Fixes banding (dropped bytes). Do NOT add an inter-block floor delay |
| Announce type byte[9] | 0x09 = time, 0x0A = date, 0x10 = image, 0x12 = GIF |
| Announce CRC bytes[12,13] | CRC16-MODBUS of bytes[9..11], stored big-endian |
| Data-packet checksum bytes[4,5] | 16-bit LE = `(0x41+offLo+offHi+len+Σpayload) & 0xFFFF` |
| Time data checksum | `CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF` |
| 12-hour hour value | `HH = (hour24 % 12) || 12` |
| Re-sync interval | ~60 s (keyboard free-runs its own clock and drifts) |
| Custom-QMK LCD enable | **C9 driven HIGH** (`common.h:83 LCD_SWITCH C9`). **B7 = aw20216s LED-driver EN only**. Forward raw-HID → USART3 (PC10/PC11) @ **460800 8N1** (921600 = b75Pro fallback) |
| DO NOT TOUCH | commands `0xB0–0xB7` (bootloader / DFU — brick risk) |
