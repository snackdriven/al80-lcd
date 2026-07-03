# Picture-page banding — investigation (2026-07-02, overnight autonomous)

Solid-color images uploaded to the AL80 **picture page** (HID inner type `0x10`, flat 30720-byte
RGB565) render as **alternating red/blue horizontal bands** on the physical LCD, while the
**main page** (mode 2, banked GIF path) renders solid colors correctly. This doc records the
overnight investigation into why.

## TL;DR (confirmed)

- **Transport is perfect.** The device echoes every report back on `inputreport` (byte 6 stamped
  `0x55` as an ACK marker). A full 549-block solid-red transfer round-tripped **549/549 blocks
  byte-perfect** — 0 missing, 0 wrong, correct offsets — even blasted at a 2 ms gap. The
  framebuffer receives exactly the bytes we send.
- **Block size is 56, definitively.** Every capture (image testpattern, gif, full HID log) uses
  `0x38` = 56-byte data blocks, offsets stepping by 56, and the device echoes our 56-byte data
  back intact. (A bundle code-read suggested `reqLen-7=57`; that does not match the wire — see
  "Reconcile" below.)
- **Therefore the banding is render-side, not transport.** The only thing that turns a uniform
  `F8 00` (red) framebuffer into alternating `F8 00`/`00 F8` (red/blue) rows is the display
  reading the framebuffer at an **odd byte stride** per row. Firmware-level. This is the entire
  remaining question.

This rules out, with evidence: block size, transport corruption, dropped packets, ACK-gating,
and the capture's duplicate-send behavior — none of them cause the banding.

## Evidence

### Device ACK / echo (eyes-free transport proof)
The keyboard echoes each 64-byte report we send back to the host as an `inputreport`, mirroring
`[op, offLo, offHi, len, ...]` with byte 6 replaced by `0x55`. Example echo of our first red data
block at offset 0: `65 00 00 38 .. .. 55 F8 00 F8 00 F8 00 …` — the `F8 00` payload is exactly
what we sent. The vendor's `sendData` waits for this echo (matching `byte0/byte1`) before sending
the next report; that is its pacing mechanism (ACK-gated, not time-based).

Full-frame verification (solid red, 549 blocks, 2 ms gap):
`{blocks:549, dataEchoes:549, ok:549, missing:0, wrong:0, uniqueEchoOffs:549}`.

### Capture block-size profile (ground truth)
- `image_capture/testpattern_capture_raw.json`: data-block lens `{0x38:1096, 0x20:2}` — 56-byte
  blocks + 32-byte tail; offset steps `{56:548, 0:553}` (each block ~doubled — see Reconcile),
  max offset 30688.
- `gif_capture/testgif_capture_raw.json`: `{0x38:3024, 0x10:168}` — 56-byte blocks + 16-byte bank
  tails (banked path).
- `captures/hid_captures_raw.json`: `{0x38:10800, 0x10:600, ...}`; inner types present:
  `0x09,0x0a,0x0b,0x0d,0x0e,0x0f,0x10,0x11,0x12,0x13` (nothing undecoded in these transfers).

### The odd-stride mechanism (why solid → bands)
A solid frame is `F8 00 F8 00 …`. Reading 2 bytes/pixel: a row starting on an even byte reads
`F8 00` = red; a row starting on an odd byte reads `00 F8` ≈ blue. For rows to alternate, the
per-row start-parity must flip, i.e. the **row stride is odd**. `FF FF` (white) is invariant to
this shift, which is why the earlier solid-white test came out uniform while red banded. This
pins the defect to the firmware's picture-framebuffer→LCD read stride.

## Open question (needs firmware or the user's eyes)
What is the picture-page render row stride / display window, and does the correct upload need
per-row byte padding, a different width, or a display-config command the vendor sends that we
don't? Being decoded by firmware disassembly (ripple v1.21 + v1.19).

## Reconcile: the raw-capture "duplicates" were an artifact
The raw JSON showed each block ~doubled (offset-step-0 ×553). The **annotated/clean** capture
(`testpattern_capture_annotated.txt`) shows single 56-byte blocks stepping 0→0x38→0x70→0xA8→…
with no repeats. So the raw double-logging is a sniffer artifact; the real transfer is single
blocks. The "duplicate-send" idea is dead.

The captured source was a **135×240 test pattern resized to the 30720-byte panel** — block 0's
payload is `00×6, FF FF, F8 00…` = a few black letterbox pixels, then the white `(0,0)` marker,
then red. So the vendor's on-wire format is byte-for-byte our format (flat RGB565-BE, 56-byte
blocks, global offsets, no per-row header). Combined with the perfect echo round-trip, the
vendor's bytes and ours are identical and both store correctly — so if our solid red bands, the
vendor's would too. Leading theory: **solid/flat content bands on the picture page due to the
firmware's render stride; it is not something we're doing differently from the vendor.**
(Whether real photos also shear, or the render stride is subtly even and only sub-pixel-uniform
inputs expose it, is the open question for the firmware trace.)

## Web research (findings)

**WebHID length semantics.** `sendReport()` does NOT silently truncate — Chromium *rejects*
wrong-length reports (`Output report buffer too long`), and behavior is platform-dependent
(macOS strict, Windows lenient-pads). Report length must match the descriptor exactly. Our
64-byte reports are accepted, so the AL80 descriptor's output report is 64 — consistent with the
device echoing 64-byte reports back. (So the 63-vs-64 worry is moot for us.)

**Solid → red/blue horizontal bands = 1-byte-per-row stride/parity misalignment**, confirmed as
the classic cause. A one-byte row-stride error swaps the hi/lo bytes of a 2-byte pixel every
other row → `F8 00` red flips to `00 F8` blue, alternating. Other candidates: CASET/RASET write
window off by a byte, or COLMOD 16-bit vs 18-bit mismatch. MADCTL bit 3 (RGB/BGR) would give a
*uniform* swap, not bands — so it's alignment, not channel order.

**The AL80 is almost certainly an AttackShark-family device.** Same architecture as the
AttackShark K86 / X85 Pro (VID 0x3151): vendor HID, Report ID 0, 64-byte reports, RGB565
**big-endian**, **column-major (X-first)** pixel order, 56-byte pixel chunks, a simple additive
checksum, and — critically — an **oversized framebuffer where the visible area ≠ the stored
stride** (X85: 138×180 framebuffer, only 138×126 visible). That stride≠visible mismatch is a
prime suspect for our banding. Two repos have documented protocols and are being mapped onto the
AL80 (see task #8):
- `EricOFreitas/attackshark-x85pro-linux` — has `docs/PROTOCOL.md`, GIF upload, and a
  `tools/webhid-capture.js` sniffer (reusable for our open GIF frame-rate question).
- `Xynthera/AttackShark_K86_Spotify` — 240×135 TFT, `0xA5` init (bounding box) + `0x25` data,
  checksum `255 - (sum(bytes[0..6]) & 0xFF)`, column-major.

**Likely GIF answer (bonus):** AttackShark firmware *clears the screen to white between frames*,
and frame count lives in the init packet — this may explain AL80 GIF flicker and is worth
checking against our GIF path.

**Two working theories for the AL80 banding, to test on-device in the morning:**
1. **True panel width ≠ 96** (e.g., 120 or 128), so our 96-wide row packing drifts the stride →
   bands. Re-pack at the correct width.
2. **Column-major** panel: repack pixels X-first. (Won't fix banding of a solid color by itself,
   but fixes real-image orientation and may interact with the stride.)

## Open subagents (in flight)
- #2 reconcile transport 56-vs-57 / reqLen / ACK-gating (bundle)
- #3 firmware disasm: picture-page render stride/dimensions (the definitive answer)
- #4 command inventory: brightness / backlight / clock-bg / sleep (bundle)
- #8 AttackShark protocol → AL80 mapping (the ranked fix candidates)

## Geometry confirmed from the capture (my probe, eyes-free)
Reassembled the vendor's 135×240 test-pattern framebuffer from the raw capture and ran a
color-run analysis: ~160 runs of ~90 px in R/G/B thirds. That's the fingerprint of a **96-wide,
row-major** panel — the portrait source was contain-fit to 90×160 with 3 px black letterbox bars
(90 = 96−6), giving ~53 rows/color × 3 ≈ 160 runs. **Geometry = 96×160, row-major, RGB565-BE,
confirmed.** Rules out the column-major and wrong-width theories for the AL80.

## Firmware (ripple v1.21 + v1.19) — the LCD is a separate module
The keyboard MCU is an STM32F103 that **does not drive the panel**: no `A5 5A` parser, no
ST7789-class `0x2A/0x2B/0x2C` (CASET/RASET/RAMWR) or init sequence in either bin. The MCU
forwards our `A5 5A` stream to a **separate smart LCD module** over SPI2 (`0x40003800`) / USART3
(`0x40004800`, DMA). So the picture-page framebuffer stride, display window, and byte-order live
in the *module's* firmware — not in the files we have.

Symptom verdict (well-supported): alternating red/blue bands from a solid buffer = an **odd
bytes-per-row** in the module's picture framebuffer. A single dropped byte would give one
red→blue transition, not repeating bands — so the misalignment recurs every row, i.e. stride =
`2·96 + 1 = 193` (a per-row pad/marker byte) or a picture-page row width ≠ 96. The main page
(96×64) renders solids correctly → its stride is even; the picture path specifically introduces
the odd byte. The definitive value needs the module firmware or a logic-analyzer capture of the
MCU→module link.

## Command inventory — nothing undecoded; two threads closed
The inner `A5 5A` protocol is exactly types **0x09–0x13** (all already decoded). There is **no**
LCD brightness, contrast, rotation, screen on/off, or **clock-background-color** command — those
either don't exist or are client-side canvas filters (brightness/hue/saturation) / keyboard-power
settings on a separate opcode channel (sleep/backlight, `setDeviceMessage 0x13`, minutes×60).

**GIF frame count / rate confirmed** (was our last "open" item): frame count = last byte of the
FINAL `0x12`; frame rate = last byte of the FINAL `0x13` (UI slider 1–60, default 30). This is
exactly what `buildModeGif` already emits — **no change needed**.

## Where this leaves the banding
- It is NOT: block size (56 confirmed), transport (549/549 echo perfect), ACK-gating/drops
  (white uniform vs red banded under identical transport ⇒ data-dependent), geometry (96×160
  row-major confirmed), or a keyboard-MCU bug (MCU doesn't render).
- It IS: an **odd bytes-per-row stride in the LCD module's picture-page path** — the only thing
  that flips `F8 00`→`00 F8` every row while leaving `FF FF` uniform. Host-fixable by pre-shaping
  the pixel bytes to match the module's stride.

## Morning test candidates (need the LCD; host-side, ranked)
1. **Exact vendor replica**: 63-byte reports, per-block ACK-gating, 300 ms after announce, solid
   red. If it renders clean → our transport differed subtly. If it still bands → the vendor bands
   solids too (module quirk) and real photos are the real test.
2. **Real photo** via `imageToFrame` (96×160). If a photo is recognizable/clean, the picture page
   works for actual use and "banding" is only a solid-fill artifact.
3. **Odd-stride compensation**: insert 1 pad byte per 96-px row (193 B/row) — if bands vanish,
   the module stride is 193 (firmware digger's #1 guess).
4. **Alternate-row byte pre-swap**: byte-swap every other row; if banding cancels, it confirms
   odd-stride parity rather than a width mismatch.

## AttackShark cross-analysis — the decisive result
The AL80 shares silicon with the AttackShark K86 / X85 Pro (vendor `0x3151`; both documented on
GitHub). Reading their `PROTOCOL.md` + drivers gave the load-bearing conclusion:

**No even pixel width can band a solid color — provably.** Solid red is `F8 00 F8 00…` (period 2).
Every integer-pixel scanline stride is an *even* byte count, so every row starts on `F8` → uniform
red. Wrong width / row-vs-column-major / whole-pixel off-screen padding all cause shear or
horizontal wrap on *real images*, but leave a *solid* color uniform. Therefore our banding is a
**per-scanline 1-byte parity slip**: the module byte-swaps alternate scanlines, turning `F8 00`→
`00 F8` (blue) every other row. `FF FF` white is byte-symmetric → survives → uniform. This is an
exact fit for the observed symptom, and the main page (96×64) rendering solids correctly confirms
it's specific to the picture-page scanout, not a global endianness error (which would make solid
red render *all blue*, not banded).

**The fix to test:** pre-swap the two RGB565 bytes on alternate scanlines (even rows `F8 00`, odd
rows `00 F8`, or vice-versa). One parity should cancel the module's swap → uniform red.

Other confirmed carry-overs from the AttackShark family:
- **Column-major** pixel order (X-outer, Y-inner). *Our own capture probe shows the AL80 vendor
  data is row-major 96×160* — a discrepancy to resolve on real images (one of the two will be
  upright). Column/row-major does NOT affect solid-color banding either way.
- **Framebuffer stride can exceed the visible area** (X85: 138×180 stored, 138×126 visible). Grids
  and solids *hide* offset bugs — only an asymmetric photo reveals the true visible width.
- **GIF white-flash between frames is firmware behavior this whole panel family shares** and the
  AttackShark project hasn't fixed it either. Not our bug. Frame count = init byte, interval = a
  single ms byte (their layout) — our count/rate bytes are already correct.
- Their checksum (`255 - sum(header)`) differs from our 16-bit additive sum; not interchangeable,
  but same "trivial sum" family and also excludes the pixel payload (matches our byte-exact echo).

## Conclusion + what's ready
- **Root cause (high confidence):** the LCD module's picture-page scanout applies a per-row byte
  parity slip (alternate-scanline byte swap / odd stride). It lives in the *display module's*
  firmware, not the keyboard MCU or our transport. Everything host-side (transport, block size,
  geometry, checksums) is correct and verified.
- **The fix is host-side and cheap:** byte-swap alternate rows in the packed frame. Needs one
  on-device confirmation (which parity) — which the lab page does in ~2 minutes.
- **Deliverable:** `al80-studio/lab.html` — connect + click through candidate encodings (green
  probe → swap-odd → swap-even → vendor-exact → stride-pad → photo). The morning run tells us the
  exact fix to bake into `protocol.js`.
- **Also settled:** no clock-background / brightness command exists (not possible via HID); GIF
  frame-count/rate already correct; GIF inter-frame white-flash is a firmware trait, not our bug.

## If the swap fix does NOT work (fallback)
Per the AttackShark caveat, if pre-swapping scanlines doesn't clear the bands, the slip is not
per-row parity but a per-*block* effect tied to the 56-byte / 28-pixel chunking or the global
offset field — lower probability, investigate next. The truly definitive capture would be a logic
analyzer on the MCU→module SPI2/USART3 link during a solid upload.
