---
title: GIF / animation
status: confirmed
scope: The banked GIF wire format, the MODE byte, per-frame headers, banking, FPS and frame count
---

# GIF / animation

The GIF upload uses one wire format. This format has:

- A **MODE byte** in each packet.
- Three modes.
- Banked 1 KB pixel windows.
- Mandatory send pacing.

The frames are sent in sequence.

!!! tip "TL;DR"

    - There are three modes (startup / GIF page / main page). The **MODE byte** in each packet selects the mode.
    - The pixel data goes in **1024-byte banks** (18×56 + 1×16 blocks). The offset **resets for each bank**, and the device advances banks implicitly.
    - **Send pacing is MANDATORY.** If you remove the pacing or the per-frame index, the GIF renders white/garbage.

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

The **frame index is the 10th payload byte** (header length byte = `0x0A` = 10). It increments
0, 1, 2, …

!!! warning "If you remove the frame index, the GIF renders WHITE"
    If you send only `[0x02, mode]`, each frame index is 0, and the frames overwrite each other.
    This was a real bug. The checksum gives byte verification: mode-2 frame 0 header
    `… 04 30 02 02 00` → cksum `0x95`; frame 1 `… 04 30 02 02 01` → cksum `0x96` (base + N).

## 📦 Banking — 1024-byte banks, offset resets per bank

The pixel data of each frame goes in **1024-byte banks**. Each bank = **18 × 56-byte blocks + 1 ×
16-byte block** (18×56 + 16 = 1024).

The packet offset (`bytes[1,2]`, little-endian) **resets for each bank**: 0, `0x38`, `0x70`, …
`0x3B8`, then the 16-byte block at **`0x3F0`**. The device advances banks implicitly. It keeps its
own destination pointer and increases it by 1024 bytes after each completed bank. There is no
per-bank address field. (Proof: consecutive banks of a solid-color frame are byte-for-byte
identical.)

- mode 2 (12,288 B) = **12 banks/frame**
- modes 0/1 (30,720 B) = **30 banks/frame**

The setup packets are at the frame boundaries. The banks between the boundaries have no setup
packets:

    per frame:  ANNOUNCE(0x12) → SETUP 0x13 → header(0x10) → length(0x11) → [bank]×N
    per bank:   19 blocks (18×56 + 1×16), offset 0x0000 … 0x03F0, then straight into next bank's 0x0000

## 🎞️ FPS and frame count

- **FPS** = the trailing byte of the type-`0x13` finish packet (UI slider **1–60**, default **30**).
- **FRAME COUNT** = the trailing byte of the type-`0x12` finish packet (capped 64/160/42 by mode).

Both values are single bytes. They are sent at the end of the transfer.

## ⚠️ Send pacing is MANDATORY (this was the killer bug)

The device needs time to commit each bank. If you send the banks back-to-back, they overwrite each
other and the GIF renders as garbage bars. The captured bytes of the vendor also fail if you send
them at full speed. The `Ur` send routine of the vendor uses this pacing:

- **30 ms** after the initial setup.
- **Per frame:** send the header, then `sleep(frameIndex % 16 === 0 ? 3000 : 30)` (a **3-second
  pause** after frame 0 and every 16th frame, else 30 ms). Then send the length. Then send the
  frame data in 1024-byte banks, with **30 ms after each bank**.
- **30 ms** after each finish setup.

Still images need no pacing (they are flat, with no banks). Confirmed on the device: with this
pacing, a 3-frame GIF animates on the main page and the clock stays intact. The **GIF inter-frame
white flash** is a firmware trait of this full panel family. It is not a bug in the upload. See
[Chunking & pacing](chunking-and-pacing.md).

!!! note "Capture vs source variant"
    The vendor web component sends GIF control subcmds `0x02/0x03`. The GIF *capture* of this repo
    showed setup subcmds `0x09/0x0A/0x07` with the banked 1 KB windows. The bundle has several
    product code paths. The captured device is ground truth for *this* keyboard. Before you forge
    GIFs, compare the two variants with a fresh capture.
