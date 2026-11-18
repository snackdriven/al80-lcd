---
title: Stock firmware & disassembly
status: confirmed
type: explanation
scope: The ripple firmware, the two official bins, the LCD dispatch, and the custom-fw image shear
---

# Stock firmware & disassembly

This page explains what the stock firmware does, what disassembling it showed, and why custom
firmware sheared images.

## ⚙️ The two official bins

- The installed [ripple](../reference/glossary.md) firmware is YUNZII official v1.21 (USB
  bcdDevice **0x0121**), 66,780 bytes. It was compared with V0119 ("10-min sleep", bcdDevice
  **0x0119**, 58,956 bytes). Ripple is the newer build, not a stripped one. VID **0x28E9** / PID
  **0x30AF**; the HID descriptors are identical.
- The LCD command dispatch is byte-identical in the two firmwares. Only its location is different.
  The announce-type dispatch is a `cmp` ladder for 9/10/11 (time / date / homepage) plus a TBB jump
  table for types 0..16. The jump table is at flash **0x08005f2e** in ripple and at **0x08004852**
  in V0119. Types 9–15 go to a shared handler. That handler writes the `0x55` ACK and calls a
  subroutine. Type 16 (image) has its own handler. Picture/GIF pages render through the upload-type
  handlers, not through standalone view-switch commands.
- The sleep timeout is a tunable little-endian u32 value in milliseconds. In ripple, it's
  **240000 (4 min)** at flash **0x08005838**. In V0119, it's **600000 (10 min)** at **0x08004158**.

Base-address note: `RIPPLE.bin` links at flash **0x08002000**, with an 8 KB stm32duino bootloader
below it.

## 📟 The MCU doesn't render pixels

The stock raw-HID `0x40/0x41/0x42` handler is a simple USART3 passthrough (`@0x08007FE8` /
`@0x08005fe0`). It forwards `&buff[7]` for `buff[3]` bytes to SD3 (USART3). It acks with
`0x55`/`0x0F` ready/busy bytes. It doesn't parse `A5 5A` or [RGB565](../reference/glossary.md).
The separate display module does. The whole [PK_* commit protocol](../protocol/display-commit.md)
is built on this fact.

## ⚠️ Custom-firmware image shear = UART TX jitter, not geometry (2026-07-05)

The custom vial-QMK firmware rendered sheared images (a vertical line came out diagonal). The stock
firmware rendered clean images. For hours, the shear was wrongly treated as a width, format or
pacing problem. It was none of those.

**Proof (RIPPLE.bin disassembly):** the stock raw-HID handler @ `0x08005fe0` forwards `&buff[7]`
for `buff[3]` bytes. That's byte-identical to `sdWrite(&SD3,&data[7],data[3])` in the custom
firmware. So the wire data was correct. The mode-2 96×64 main-page format was also correct all
along.

**Actual cause:** the custom firmware writes USART3 interrupt-driven. At the same time, it runs
`rgb_matrix` (aw20216s SPI flush = 2 transactions/refresh) + Vial. These preempt/mask the serial TX
interrupt. Here's what happens:

1. Gaps occur in the byte stream.
2. The self-parsing module re-syncs at a gap.
3. A progressive shift occurs.
4. Patterns show a diagonal. On solids, the shift is invisible.

!!! success "Fix (confirmed on-device 2026-07-05) — two parts, both required"
    1. **Firmware (`AL80_CUSTOM_QMK_v14_rgbpause.bin`):** gate `aw20216s_flush()` on a
       `g_screen_busy` flag. The flag is set on `0x40` and cleared on `0x42`. A watchdog is in
       `matrix_scan_kb`. This fix removes the UART TX jitter.
    2. **Host (al80-studio):** send the main page (a *banked* mode-2 transfer) through the
       per-bank-paced path (`sendGifWithProgress`, ~30 ms/bank). Do **not** use the blast (all
       banks back to back, with no pacing). When the jitter is gone, a blast makes the banks
       overwrite each other, and the result is white. Pacing lets each bank commit, and the result
       is clean.

Result: a clean split, gradient, and text on the main page with the clock. The picture page also
works with the same jitter fix. The picture page is flat and ACK-gated (each block waits for the
previous block's ACK), so it needed no pacing change. The byte order is **big-endian, no swap**.
Baud: the stock firmware's actual baud is 460800. To hit that baud, custom firmware needs the
**921600 setting** (clock/divisor difference). This quirk is expected.

!!! quote "Lesson"
    If a feature works on stock and fails on custom, **disassemble RIPPLE.bin first**. One look at
    the byte-identical forward would have ended the whole search for a geometry bug.
