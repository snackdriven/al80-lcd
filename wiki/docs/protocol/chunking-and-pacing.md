---
title: Chunking & pacing
status: confirmed
scope: How byte arrays are split into 0x41 reports, GIF banking, ACK-gating, and measured throughput
---

# Chunking & pacing

How a logical byte array becomes `0x41` reports on the wire, and the timing rules that make uploads
actually commit.

## Chunking rule

Every logical byte array is split into **`(reportLen − 7)`-byte** payloads (56 at reportLen = 63).
Each `0x41` report carries its **absolute byte offset little-endian in `bytes[1,2]`**; the final
chunk's length byte = `len − offset + 7`.

- **Still images:** one flat offset space (0, 56, 112, …), ending with a 32-byte tail at `0x77E0`.
- **GIF frames:** additionally pre-sliced into **1024-byte logical banks** before that; `bytes[1,2]`
  is an **intra-bank** offset that resets 0 → `0x3F0` each bank (see [GIF / animation](gif-animation.md)).

Length **descriptors** (the `0x0C` / `0x11` packets) store their value **big-endian**; the per-report
**offset** is **little-endian**. `bytes[4,5]` is always the `yne` additive checksum
([Checksums & CRC](checksums.md)).

## Pacing rules by transfer type

| Transfer | Pacing |
|---|---|
| **Still image (picture page)** | Flat, no banks. Front-pace only: **~300 ms after announce**, **~30 ms after setup**, then **ACK-gate each block**. No inter-block floor delay. |
| **GIF** | **30 ms** after setup; per frame `sleep(frameIdx % 16 === 0 ? 3000 : 30)`; **30 ms after each 1024-byte bank**; 30 ms after each finish setup. |
| **Main page (mode-2, custom firmware)** | Banked transfer — route through the per-bank-paced path (~30 ms/bank), **not** the blast. Blasting makes banks overwrite → white. |

## ACK-gating (picture page reliability)

Wait for the module's ready echo (`byte[6] = 0x55`) after each 56-byte `0x41` block before sending
the next. Match the op **and the full offset (lo + hi)** in the echo; resend a block up to 4× if the
ack is missed. Each block is idempotent (carries its own destination offset), so a resend cannot
corrupt state. This fixes the red/blue banding (dropped bytes) — see
[Display commit → banding root cause](display-commit.md).

!!! danger "Do not add an inter-block floor delay"
    The ack echo *is* the pacing signal. Padding gaps between already-acked blocks desyncs the
    module and makes banding **worse** (tested).

## Measured throughput (2026-07-01)

A full 550-packet frame is **HID-write-bound, not device-bound** — and on Windows the killer is
`setTimeout` resolution, not the USB link:

| Inter-packet gap | Full frame | fps |
|---|---|---|
| 5 / 2 / 1 ms | ~8.5 s | 0.12 |
| **0 ms** | **~0.55 s** | **~1.8** |

Any nonzero sleep costs ~15.6 ms (Windows timer floor), so 550 sleeps ≈ 8.5 s. Send frames with
**no inter-packet sleep** (or `setImmediate` / a sub-ms busy-wait) for ~2 fps full frames; ~1 ms
per packet is the real throughput. A small partial region (e.g. a clock's seconds ≈ 10–40 blocks)
would be ~10–40 ms at gap 0, *if* partial updates are honored.

Note the tension: **gap-0 for main-page speed** vs **ACK-gating for picture-page reliability**.
Picture page is flat and small enough to ack-gate; the GIF/main-page banked path uses per-bank
pacing because banks must commit before the next arrives.
