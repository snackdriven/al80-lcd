---
title: How-to — Render a custom 96×160 frame
status: confirmed
scope: End-to-end recipe to forge a still-image transfer for the LCD info-panel
---

# How-to: render a custom 96×160 frame

Both checksums are now cracked. Thus you can forge a full still-image transfer end-to-end. You must
bake any client-side look (brightness, grayscale, etc.) into the pixels first. There is no device
opcode for it (refer to [Still images → attributes are client-side](../protocol/still-images.md)).

## 🔧 Steps

1. **Draw** your content on a **96×160** canvas. Apply brightness/grayscale/etc. at this step.

2. **Convert** each pixel to **RGB565 big-endian**:

        v = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3);   bytes = [v>>8, v & 0xFF]

3. **Concatenate** the pixels **row-major** into a **30,720-byte** buffer (548 × 56-byte blocks + 1 × 32-byte tail).

4. **Send the announce (0x40):**

        40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01

    The type is `[9]=0x10` (image). The CRC `[12,13]=C5 B1` is CRC16-MODBUS over `[0x10,0x00,0x01]`.

5. **Wait ~300 ms** (settle). The module must process the announce.

6. **Send the setup / commit (0x41, `PK_ADD_PIC`):**

        41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93     ; 0x7800 = 30,720 = 96×160

7. **Wait ~30 ms** (settle). The module must arm the ADD_PIC commit.

8. **Send the data blocks (0x41):** 548 blocks of 56 bytes + 1 final 32-byte tail block, **ACK-gated**. Obey these rules:
    - offset = running byte offset, little-endian in `bytes[1,2]` (0, 56, 112, … 30,688)
    - `byte[3]` = `0x38` (56) for the 548 blocks; **`0x20` (32) for the tail**
    - `byte[6]` = `0x00`, then the payload bytes
    - checksum (`bytes[4,5]`, 16-bit LE) = `(0x41 + offLo + offHi + len + Σpayload) & 0xFFFF`.
      Calculate the checksum **after** you put the payload into the block.
    - Wait for the `byte[6]=0x55` ack of each block before you send the next block. If an ack is missed, resend the block (≤4×).

9. **Send the finish (0x42):** `42 00 00 38 7A` (zero-pad the rest).

10. **Do NOT send a trailing view switch.** `PK_ADD_PIC` already displays the committed frame, and
    the frame stays. A trailing `0x0D` (`PK_TOGGLE_PIC`) advances past it.

!!! tip "pad()"
    OS-level HID libs prepend a `0x00` report-ID byte. Then they zero-fill to 64 data bytes.

## ⚠️ Why the settles and ack-gating matter

If you skip the settles, the frame lands in scratch and acks 549/549, but it **never displays**.
The old picture stays. If you blast the blocks with no flow control, bytes are dropped. The dropped
bytes flip the pixel alignment, and red/blue banding occurs. [Display commit (PK_*)](../protocol/display-commit.md)
and [Chunking & pacing](../protocol/chunking-and-pacing.md) cover both problems. This exact path
already renders a live Spotify card (refer to [Now-playing](now-playing.md)).
