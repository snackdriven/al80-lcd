---
title: How-to — Render a custom 96×160 frame
status: confirmed
scope: End-to-end recipe to forge a still-image transfer for the LCD info-panel
---

# How-to: render a custom 96×160 frame

With both checksums cracked, a full still-image transfer can be forged end-to-end. Any client-side
look (brightness, grayscale, etc.) must be **baked into the pixels first** — there is no device
opcode for it (see [Still images → attributes are client-side](../protocol/still-images.md)).

## Steps

1. **Draw** your content on a **96×160** canvas. Apply brightness/grayscale/etc. here.

2. **Convert** each pixel to **RGB565 big-endian**:

        v = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3);   bytes = [v>>8, v & 0xFF]

3. **Concatenate row-major** → a **30,720-byte** buffer (548 × 56-byte blocks + 1 × 32-byte tail).

4. **Announce (0x40):**

        40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01

    type `[9]=0x10` (image); CRC `[12,13]=C5 B1` = CRC16-MODBUS over `[0x10,0x00,0x01]`.

5. **Settle ~300 ms** (the module must process the announce).

6. **Setup / commit (0x41, `PK_ADD_PIC`):**

        41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93     ; 0x7800 = 30,720 = 96×160

7. **Settle ~30 ms** (the module must arm the ADD_PIC commit).

8. **Data blocks (0x41):** 548 blocks of 56 bytes + 1 final 32-byte tail block, **ACK-gated**:
    - offset = running byte offset, little-endian in `bytes[1,2]` (0, 56, 112, … 30,688)
    - `byte[3]` = `0x38` (56) for the 548 blocks; **`0x20` (32) for the tail**
    - `byte[6]` = `0x00`, then the payload bytes
    - checksum (`bytes[4,5]`, 16-bit LE) = `(0x41 + offLo + offHi + len + Σpayload) & 0xFFFF` —
      compute **after** laying down the payload
    - wait for each block's `byte[6]=0x55` ack before sending the next; resend ≤4× if missed

9. **Finish (0x42):** `42 00 00 38 7A` (rest zero-padded).

10. **Do NOT send a trailing view switch.** `PK_ADD_PIC` already displays the committed frame and it
    stays; a trailing `0x0D` (`PK_TOGGLE_PIC`) advances past it.

!!! tip "pad()"
    OS-level HID libs prepend a `0x00` report-ID byte, then zero-fill to 64 data bytes.

## Why the settles and ack-gating matter

Skip the settles and the frame lands in scratch, acks 549/549, and **never displays** (old picture
stays). Blast the blocks with no flow control and dropped bytes flip pixel alignment → red/blue
banding. Both are covered in depth on [Display commit (PK_*)](../protocol/display-commit.md) and
[Chunking & pacing](../protocol/chunking-and-pacing.md). This exact path already renders a live
Spotify card — see [Now-playing](now-playing.md).
