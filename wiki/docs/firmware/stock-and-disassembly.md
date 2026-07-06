---
title: Stock firmware & disassembly
status: confirmed
scope: The ripple firmware, the two official bins, the LCD dispatch, and the custom-fw image shear
---

# Stock firmware & disassembly

## The two official bins

- The user's **"ripple" firmware = YUNZII official v1.21** (USB bcdDevice **0x0121**), **66,780
  bytes**. Compared against **V0119** ("10-min sleep", bcdDevice **0x0119**, **58,956 bytes**).
  Ripple is the **newer** build, not a stripped one. VID **0x28E9** / PID **0x30AF**; HID
  descriptors identical.
- The LCD command dispatch is **byte-identical** between the two firmwares (just relocated). The
  announce-type dispatch is a `cmp` ladder for **9/10/11** (time / date / homepage) plus a **TBB
  jump table** (ripple @ flash **0x08005f2e**, V0119 @ **0x08004852**) covering types **0..16**:
  types **9–15** route to a shared handler that writes the `0x55` ACK and calls a subroutine;
  **type 16** (image) has its own handler. Picture/GIF pages render via the upload-TYPE handlers,
  **not** via standalone view-switch commands.
- **Sleep timeout** is a tunable little-endian **u32 milliseconds**: ripple = **240000 (4 min)** at
  flash **0x08005838**; V0119 = **600000 (10 min)** at **0x08004158**.

Base-address note: `RIPPLE.bin` links at flash **0x08002000** (an 8 KB stm32duino bootloader sits
below).

## The MCU does not render pixels

The stock raw-HID `0x40/0x41/0x42` handler is a **dumb USART3 passthrough** (`@0x08007FE8` /
`@0x08005fe0`): it forwards `&buff[7]` for `buff[3]` bytes to SD3 (USART3) and acks with
`0x55`/`0x0F` ready/busy bytes. It does **not** parse `A5 5A` or RGB565 — the separate display
module does. This is the foundation of the whole [PK_* commit protocol](../protocol/display-commit.md).

## Custom-firmware image SHEAR = UART TX jitter, not geometry (2026-07-05)

Custom vial-QMK firmware rendered images **sheared** (a vertical line → diagonal) while stock
rendered clean. Chased wrongly for hours as a width/format/pacing problem — it was none of those.

**Proof (RIPPLE.bin disasm):** the stock raw-HID handler @ `0x08005fe0` forwards `&buff[7]` for
`buff[3]` bytes — **byte-identical** to the custom fw's `sdWrite(&SD3,&data[7],data[3])`. So the wire
data was correct and the mode-2 96×64 main-page format was right all along.

**Actual cause:** the custom fw writes USART3 interrupt-driven while running `rgb_matrix` (aw20216s
SPI flush = 2 transactions/refresh) + Vial. Those preempt/mask the serial TX interrupt → **gaps** in
the byte stream → the self-parsing module re-syncs at a gap → progressive shift → diagonal on
patterns, invisible on solids.

!!! success "Fix (confirmed on-device 2026-07-05) — two parts, both required"
    1. **Firmware (`AL80_CUSTOM_QMK_v14_rgbpause.bin`):** gate `aw20216s_flush()` on a
       `g_screen_busy` flag (set on `0x40`, cleared on `0x42`; watchdog in `matrix_scan_kb`).
       Kills the UART TX jitter.
    2. **Host (al80-studio):** send the MAIN page (a *banked* mode-2 transfer) through the
       per-bank-paced path (`sendGifWithProgress`, ~30 ms/bank), **not** the blast. Once jitter is
       gone, blasting makes banks overwrite → white; pacing lets each bank commit → clean.

Result: clean split + gradient + text on the main page with the clock. Picture page also works
(same jitter fix; it is flat/ack-gated so needed no pacing change). Byte order = **big-endian, no
swap**. Baud: stock actual 460800; custom needs the **921600 setting** to hit it (clock/divisor
difference) — expected quirk.

!!! quote "Lesson"
    For "works on stock, fails on custom", **disassemble RIPPLE.bin first** — the byte-identical
    forward would have killed the entire geometry hunt in one look.
