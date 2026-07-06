---
title: GIF / animation
status: confirmed
scope: The banked GIF wire format, the MODE byte, per-frame headers, banking, FPS and frame count
---

# GIF / animation

One wire format with a **MODE byte** threaded through every packet, three modes, banked 1 KB pixel
windows, and mandatory send pacing. Frames are sent sequentially.

!!! tip "TL;DR"

    - Three modes (startup / GIF page / main page) selected by the **MODE byte** threaded through every packet.
    - Pixel data streams in **1024-byte banks** (18×56 + 1×16 blocks); the offset **resets per bank** and the device advances banks implicitly.
    - **Send pacing is MANDATORY** — drop the pacing or the per-frame index and the GIF renders white/garbage.

## 🎞️ Modes

| Mode | Target | Size | Frame cap |
|---|---|---|---|
| 0 | startup animation | 96×160 (30,720 B) | 64 frames |
| 1 | GIF page | 96×160 (30,720 B) | 160 frames |
| 2 | main page | 96×64 (12,288 B) | 42 frames (AL80-specific, PID-gated in the app) |

## 📦 Structure

    announce  (0x40, type 0x12, extra [mode, 0])
    setup     (0x41, type 0x13, extra [mode, 0])
    per frame:
      header  (0x41, type 0x10, subcmd 3, extra [0x02, mode, FRAME_INDEX])
      length  (0x41, type 0x11, [lenHi, lenLo]   ; BIG-ENDIAN frame length)
      data    (banked — see below)
    finish    (0x41, type 0x12, extra [mode, FRAME_COUNT])
    finish    (0x41, type 0x13, extra [mode, FPS])
    finish    (0x42)

## 📦 Per-frame header = `[0x02, mode, FRAME_INDEX]`

The **frame index is the 10th payload byte** (header length byte = `0x0A` = 10) and increments
0, 1, 2, …

!!! warning "Drop the frame index and the GIF renders WHITE"
    Sending only `[0x02, mode]` makes every frame index 0, so frames overwrite each other. This was
    a real bug. Byte-verified via the checksum: mode-2 frame 0 header `… 04 30 02 02 00` → cksum
    `0x95`; frame 1 `… 04 30 02 02 01` → cksum `0x96` (base + N).

## 📦 Banking — 1024-byte banks, offset resets per bank

Each frame's pixel data streams in **1024-byte banks**. Each bank = **18 × 56-byte blocks + 1 ×
16-byte block** (18×56 + 16 = 1024).

The packet offset (`bytes[1,2]`, little-endian) **resets per bank**: 0, `0x38`, `0x70`, … `0x3B8`,
then the 16-byte block at **`0x3F0`**. The device advances banks implicitly: it keeps its own
destination pointer and bumps it 1024 bytes each completed bank. There is no per-bank address
field (proven: consecutive banks of a solid-color frame are byte-for-byte identical).

- mode 2 (12,288 B) = **12 banks/frame**
- modes 0/1 (30,720 B) = **30 banks/frame**

Frame boundaries carry the setup packets; banks between them do not:

    per frame:  ANNOUNCE(0x12) → SETUP 0x13 → header(0x10) → length(0x11) → [bank]×N
    per bank:   19 blocks (18×56 + 1×16), offset 0x0000 … 0x03F0, then straight into next bank's 0x0000

## 🎞️ FPS and frame count

- **FPS** = the trailing byte of the type-`0x13` finish packet (UI slider **1–60**, default **30**).
- **FRAME COUNT** = the trailing byte of the type-`0x12` finish packet (capped 64/160/42 by mode).

Both are single bytes sent at the end of the transfer.

## ⚠️ Send pacing is MANDATORY (this was the killer bug)

The device needs time to commit each bank. Sent back-to-back, banks overwrite each other and the
GIF renders as garbage bars. Even the vendor's own captured bytes fail if blasted at full
speed. The vendor's `Ur` send routine paces like this:

- **30 ms** after the initial setup.
- **Per frame:** send the header, then `sleep(frameIndex % 16 === 0 ? 3000 : 30)` (a **3-second
  pause** after frame 0 and every 16th frame, else 30 ms); then the length; then the frame data in
  1024-byte banks with **30 ms after each bank**.
- **30 ms** after each finish setup.

Still images need no pacing (they are flat, no banks). Confirmed on-device: with this pacing a
3-frame GIF animates on the main page with the clock intact. **GIF inter-frame white flash** is a
firmware trait of this whole panel family — not a bug in the upload. See
[Chunking & pacing](chunking-and-pacing.md).

!!! note "Capture vs source variant"
    The vendor web component emits GIF control subcmds `0x02/0x03`; this repo's own GIF *capture*
    showed setup subcmds `0x09/0x0A/0x07` with the banked 1 KB windows. The bundle has several
    product code paths; the captured device is ground truth for *this* keyboard. Reconcile with a
    fresh capture before forging GIFs.
