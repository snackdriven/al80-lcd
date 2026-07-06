---
title: Still images (picture page)
status: confirmed
scope: The 96x160 still-image upload format, pixel packing, and the 32-byte tail block
---

# Still images (picture page)

A still image is a **flat, unbanked** RGB565 upload to the picture page. To make the module
actually *display* it, the upload must be paced and committed via `PK_ADD_PIC` — see
[Display commit (PK_*)](display-commit.md). This page covers the pixel format and byte-map.

!!! tip "TL;DR"

    - The panel is **96×160 = 30,720 bytes** RGB565 big-endian, row-major (NOT 112×137).
    - Data = **548 × 56-byte blocks + 1 × 32-byte tail block** at offset `0x77E0`.
    - The setup packet `A5 5A 0C <len>` **is** `PK_ADD_PIC` (the commit), and display attributes are baked into pixels client-side — there is no brightness/saturation opcode.

## 📟 Panel geometry — 96×160

The display is **96 wide × 160 tall = 15,360 px = 30,720 bytes** RGB565 big-endian, **row-major**,
top-left origin.

!!! warning "Correction — it is NOT 112×137"
    The old "112×137 / 30,688 bytes / 548 blocks" figure was wrong. The first capture-analysis
    script filtered out a final **32-byte data block** (`byte[3]=0x20`), dropping the last 16
    pixels, so every still image built was malformed and never rendered. The firmware length field
    proves 96×160: the type-`0x0C` setup declares `0x7800 = 30,720 = 96×160`.

Correct still-image data = **548 × 56-byte blocks + 1 × 32-byte tail block**. The 548 blocks cover
offsets `0 … 30687`; the tail sits at offset **30,688 (0x77E0)**; total = **30,720 (0x7800)**.

## 📦 Upload sequence

    announce  (0x40, type 0x10):  40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01
    setup     (0x41, type 0x0C):  41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93   ; len 0x7800 = 30,720
    data      (0x41):             548 × 56-byte blocks + 1 × 32-byte tail (byte[3]=0x20 at 0x77E0)
    finish    (0x42):             42 00 00 38 7A

!!! info "The setup packet IS the commit command"
    `A5 5A 0C <len>` is **`PK_ADD_PIC` (0x0C)** = commit-the-scratch-buffer-and-display, not just a
    length declaration. For it to commit you MUST pace the front of the transfer (~300 ms after the
    announce, ~30 ms after the setup). And do **not** send a trailing `type 0x0D` — that is
    `PK_TOGGLE_PIC`, which advances *past* the frame you committed. See
    [Display commit (PK_*)](display-commit.md).

## 📦 Data block layout

    41 [off:2 LE] 38 [cksum:2 LE] 00 <56-byte payload>

| Byte(s) | Field |
|---|---|
| `[1,2]` | **little-endian destination byte-offset** into the frame buffer; steps by 56 (0, 56, 112, …) |
| `[3]` | payload length: `0x38` (56) for the 548 blocks; **`0x20` (32) for the final tail** |
| `[4,5]` | 16-bit LE additive checksum = `(0x41 + offLo + offHi + len + Σpayload) & 0xFFFF` ([details](checksums.md)) |
| `[6]` | `0x00` reserved |
| `[7..62]` | 56 bytes of **RGB565 big-endian** pixels, row-major from top-left |

`0x41` is a **generic block-write**: the LCD is effectively a dumb framebuffer you push arbitrary
pixels to. A complete frame ends with the 32-byte tail block at `0x77E0` then a `0x42` finish.

## 🖼️ Pixel format — RGB565 big-endian

    value = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3)
    emitted as [ value>>8, value & 0xFF ]     // high byte first

| Color | RGB565 | Bytes |
|---|---|---|
| Red | `0xF800` | `F8 00` |
| Green | `0x07E0` | `07 E0` |
| Blue | `0x001F` | `00 1F` |
| White | `0xFFFF` | `FF FF` |
| Black | `0x0000` | `00 00` |

The vendor app resamples any uploaded image to native **96×160** before sending (canvas resize
with `imageSmoothingEnabled=false`). For pixel-perfect graphics, render directly at 96×160.

## 🎨 Display attributes are client-side (no device opcode)

Brightness, Chroma, Saturation, Grayscale, "Fuzzy", Sharpening emit **zero HID traffic**: they
only update the app's canvas preview and are baked into the pixels on "Save to the device."
There is no "set brightness/saturation" opcode to reverse; transform your own RGB565 buffer before
sending. The one save-time exception is frame rate (GIF only). See
[Render a custom frame](../how-to/render-a-frame.md).
