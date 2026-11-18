---
title: Chunking & pacing
status: confirmed
type: reference
scope: How byte arrays are split into 0x41 reports, GIF banking, ACK-gating, and measured throughput
---

# Chunking & pacing

Use this page to look up how a byte array is split into `0x41` reports, and the timing rules that make uploads commit.

## 📦 Chunking rule

Every logical byte array is split into **`(reportLen − 7)`-byte** payloads (56 at reportLen = 63).
Each `0x41` report carries its **absolute byte offset little-endian in `bytes[1,2]`**. The final
chunk's length byte = `len − offset + 7`.

- **Still images:** one flat offset space (0, 56, 112, …), with a 32-byte tail at `0x77E0` at the end.
- **GIF frames:** first, the frames are also sliced into **1024-byte logical banks**.
  `bytes[1,2]` is an **intra-bank** offset that resets 0 → `0x3F0` for each bank (see
  [GIF / animation](gif-animation.md)).

The length **descriptors** (the `0x0C` / `0x11` packets) store their value **big-endian**, but the
per-report **offset** is **little-endian**. `bytes[4,5]` is always the `yne` additive checksum
([Checksums & CRC](checksums.md)).

## 🕐 Pacing rules by transfer type

A settle is a fixed wait after a packet, so the module can process it. ACK-gating means waiting for
the device's echo of a block before sending the next one. The [blast](../reference/glossary.md) is
sending every packet with no gap (0 ms, see "Measured throughput" below).

| Transfer | Pacing |
|---|---|
| **Still image (picture page)** | Flat, no banks. Pace only the start: **~300 ms after announce**, **~30 ms after setup**, then **ACK-gate each block**. No inter-block floor delay. |
| **GIF** | **30 ms** after setup; per frame `sleep(frameIdx % 16 === 0 ? 3000 : 30)`; **30 ms after each 1024-byte bank**; 30 ms after each finish setup. |
| **Main page (mode-2, custom firmware)** | Banked transfer. Send it through the per-bank-paced path (~30 ms/bank), **not** the blast. The blast makes banks overwrite each other → white. |

## ✅ ACK-gating (picture page reliability)

To ACK-gate a picture upload:

1. Send one 56-byte `0x41` block.
2. Wait for the ready echo of the module (`byte[6] = 0x55`).
3. In the echo, match the op **and the full offset (lo + hi)**.
4. If the ack does not come, send the block again, up to 4×.
5. Send the next block.

Each block is idempotent: it carries its own destination offset, so sending it twice has the same
result as sending it once. Thus a resend cannot corrupt the state. This fixes the red/blue banding
(dropped bytes). See [Display commit → banding root cause](display-commit.md).

!!! danger "Do not add an inter-block floor delay"
    The ack echo *is* the pacing signal. Gaps between blocks that already have an ack desync the
    module and make banding **worse** (tested).

## 🕐 Measured throughput (2026-07-01)

A full 550-packet frame is **HID-write-bound, not device-bound**: the time goes into the host's HID
writes, not into the keyboard. On Windows, the main limit is the `setTimeout` resolution, not the
USB link:

| Inter-packet gap | Full frame | fps |
|---|---|---|
| 5 / 2 / 1 ms | ~8.5 s | 0.12 |
| **0 ms** | **~0.55 s** | **~1.8** |

Each nonzero sleep costs ~15.6 ms (the Windows timer floor), so 550 sleeps ≈ 8.5 s. For ~2 fps
full frames, send frames with **no inter-packet sleep** (or `setImmediate` / a sub-ms busy-wait).
The real throughput is ~1 ms per packet. A small partial region (for example, the seconds of a
clock ≈ 10–40 blocks) would take ~10–40 ms at gap 0, *if* the device accepts partial updates.

That's a trade-off: **gap-0 for main-page speed** against **ACK-gating for picture-page
reliability**. The picture page is flat and small enough for ACK-gating. The GIF/main-page banked
path uses per-bank pacing, because each bank must commit before the next bank arrives.
