---
title: Stock firmware & disassembly
status: confirmed
scope: The ripple firmware, the two official bins, the LCD dispatch, and the custom-fw image shear
---

# Stock firmware & disassembly

## ⚙️ The two official bins

- The "ripple" firmware of the user is YUNZII official v1.21 (USB bcdDevice **0x0121**), 66,780
  bytes. It was compared with V0119 ("10-min sleep", bcdDevice **0x0119**, 58,956 bytes).
  Ripple is the newer build. It is not a stripped build. VID **0x28E9** / PID **0x30AF**; the HID
  descriptors are identical.
- The LCD command dispatch is byte-identical in the two firmwares. Only its location is different.
  The announce-type dispatch is a `cmp` ladder for 9/10/11 (time / date / homepage) plus a TBB jump
  table for types 0..16. The jump table is at flash **0x08005f2e** in ripple and at **0x08004852**
  in V0119. Types 9–15 go to a shared handler. That handler writes the `0x55` ACK and calls a
  subroutine. Type 16 (image) has its own handler. Picture/GIF pages render through the upload-TYPE
  handlers, not through standalone view-switch commands.
- The sleep timeout is a tunable little-endian u32 value in milliseconds. In ripple, it is
  **240000 (4 min)** at flash **0x08005838**. In V0119, it is **600000 (10 min)** at **0x08004158**.

Base-address note: `RIPPLE.bin` links at flash **0x08002000**. An 8 KB stm32duino bootloader is
below it.

## 📟 The MCU does not render pixels

The stock raw-HID `0x40/0x41/0x42` handler is a dumb USART3 passthrough (`@0x08007FE8` /
`@0x08005fe0`). It forwards `&buff[7]` for `buff[3]` bytes to SD3 (USART3). It acks with
`0x55`/`0x0F` ready/busy bytes. It does not parse `A5 5A` or RGB565. The separate display module
does. This fact is the foundation of the full [PK_* commit protocol](../protocol/display-commit.md).

## ⚠️ Custom-firmware image SHEAR = UART TX jitter, not geometry (2026-07-05)

The custom vial-QMK firmware rendered sheared images (a vertical line → diagonal). The stock
firmware rendered clean images. For hours, the shear was incorrectly chased as a
width/format/pacing problem. It was none of those.

**Proof (RIPPLE.bin disasm):** the stock raw-HID handler @ `0x08005fe0` forwards `&buff[7]` for
`buff[3]` bytes. This is byte-identical to `sdWrite(&SD3,&data[7],data[3])` in the custom fw. Thus
the wire data was correct. The mode-2 96×64 main-page format was also correct all along.

**Actual cause:** the custom fw writes USART3 interrupt-driven. At the same time, it runs
`rgb_matrix` (aw20216s SPI flush = 2 transactions/refresh) + Vial. These preempt/mask the serial TX
interrupt. The result is this sequence:

1. Gaps occur in the byte stream.
2. The self-parsing module re-syncs at a gap.
3. A progressive shift occurs.
4. Patterns show a diagonal. On solids, the shift is invisible.

!!! success "Fix (confirmed on-device 2026-07-05) — two parts, both required"
    1. **Firmware (`AL80_CUSTOM_QMK_v14_rgbpause.bin`):** gate `aw20216s_flush()` on a
       `g_screen_busy` flag. The flag is set on `0x40` and cleared on `0x42`. A watchdog is in
       `matrix_scan_kb`. This fix kills the UART TX jitter.
    2. **Host (al80-studio):** send the MAIN page (a *banked* mode-2 transfer) through the
       per-bank-paced path (`sendGifWithProgress`, ~30 ms/bank). Do **not** use the blast. When
       the jitter is gone, a blast makes the banks overwrite, and the result is white. Pacing lets
       each bank commit, and the result is clean.

Result: a clean split, gradient, and text on the main page with the clock. The picture page also
works with the same jitter fix. The picture page is flat/ack-gated, so it needed no pacing change.
The byte order is **big-endian, no swap**. Baud: the stock actual baud is 460800. To hit that baud,
custom firmware needs the **921600 setting** (clock/divisor difference). This quirk is expected.

!!! quote "Lesson"
    If a feature works on stock and fails on custom, **disassemble RIPPLE.bin first**. One look at
    the byte-identical forward would have killed the entire geometry hunt.
