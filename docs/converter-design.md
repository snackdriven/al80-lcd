---
title: AL80 LCD Image Converter — Design Brief
status: design (not yet implemented)
updated: 2026-07-01
scope: CLI tool to convert arbitrary images into a forged still-image HID transfer for the AL80 LCD
---

# AL80 LCD Image Converter — Design Brief

Design for a CLI that converts arbitrary images into a forged still-image HID transfer for the
YUNZII AL80 LCD (112×137, RGB565 big-endian). Grounded in `AL80_KNOWLEDGE_BASE.md`, the send
pattern in `tooling/al80_clock.js`, and the offline validator `research/analyze_captures.py`.
This is a design, not an implementation.

## 1. Scope: still-images-only for v1

**Ship still-images-only. Defer GIF.** The still path is fully forgeable and every field is
verified:
- Announce is a known-good captured constant reused verbatim (`40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01`).
- Data-block checksum is cracked and verified 4288/4288 blocks.
- Offset space is one flat run `0x0000 → 0x77A8`, 548 blocks, all 56 bytes.
- Finish is constant.

Nothing in the still path is guessed. GIF is different: the bank-base encoding in the
`0x0A`/`0x07` setup packets isn't decoded (KB §10). Forging a new GIF means synthesizing
setup packets whose bank-base we can't compute; replaying captured setups only reproduces the
one captured test GIF. Build a clean `FrameEncoder` seam so GIF can reuse it later (§7).

## 2. Image fitting: default `cover`, `--fit` flag

Target is 112×137 (aspect ~0.817).

| Mode | Behavior | When |
|------|----------|------|
| `cover` (default) | Scale to fill, center-crop overflow | Photos, most content |
| `contain` | Scale to fit, pad remainder | Logos, full-frame diagrams |
| `stretch` | Scale both axes to exact 112×137 | Test patterns |
| `pad` | contain with explicit `--pad-color` | Letterbox with chosen color |

`cover` default: the panel is tiny, letterbox bars waste it. Pair with `--pad-color <hex>`
(default black). Lanczos resample for downscale.

## 3. Language/library: Node, matching existing tooling

**Node + `node-hid` + `sharp`.** The `tooling/` dir is already Node; `al80_clock.js` uses
`node-hid` with proven `findPath()`/`pad()`/write-loop helpers. `sharp` (libvips) does decode
+ resize + fit modes + raw RGB in one pipeline; do the RGB565 BE pack by hand (trivial).

**Python alternative (noted):** `hidapi` + `Pillow` (`ImageOps.fit`, `img.convert("RGB").tobytes()`).
Equally capable, and there's an `al80_clock.py` sibling. Pick Node for consistency with the
send code, not any capability gap. The validator stays Python either way (§6).

## 4. Frame-build pipeline (pseudocode)

```
CONST WIDTH=112, HEIGHT=137, FRAME_BYTES=30688   // 112*137*2 == 548*56 exactly
CONST BLOCK=56
CONST ANNOUNCE = [0x40,0,0,0x08,0xCF,0x02,0,0xA5,0x5A,0x10,0,0x01,0xC5,0xB1,0x01]
CONST FINISH   = [0x42,0,0,0x38,0x7A]

function buildFrameBytes(inputPath, opts):
    rgb = sharp(inputPath)
            .resize(WIDTH, HEIGHT, { fit: opts.fit, position:'centre', background: opts.padColor })
            .modulate({ brightness: opts.brightness, saturation: opts.saturation })  // bake look
            .removeAlpha({ background: opts.padColor })   // flatten transparency
            .raw().toBuffer()                              // WIDTH*HEIGHT*3, row-major
    assert rgb.length == WIDTH*HEIGHT*3

    frame = Buffer(FRAME_BYTES)                            // RGB888 -> RGB565 big-endian
    for i in 0..WIDTH*HEIGHT-1:
        R=rgb[3i]; G=rgb[3i+1]; B=rgb[3i+2]
        v = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3)
        frame[2i]   = (v>>8) & 0xFF     // BIG-ENDIAN: high byte first
        frame[2i+1] =  v     & 0xFF
    return frame

function buildDataBlocks(frame):                           // 548 blocks, all 56 bytes
    for k in 0..547:
        off = k*BLOCK; len = BLOCK
        pay = frame[off : off+len]
        offLo = off & 0xFF; offHi = (off>>8) & 0xFF
        cksum = (0x41 + offLo + offHi + len + sum(pay)) & 0xFFFF     // §5e
        emit [0x41, offLo, offHi, len, cksum&0xFF, (cksum>>8)&0xFF, 0x00] + pay

function buildPacketStream(frame): return [ANNOUNCE] + buildDataBlocks(frame) + [FINISH]
// send(): pad() each packet (prepend 0x00 report id, zero-fill to 65), dev.write, ~2-5ms gap
```

Note: for 112×137, `548 × 56 = 30,688` exactly — **no partial tail block**; every still block
is 56 bytes. (The 16-byte block only exists in GIF bank tails.)

## 5. CLI surface

Command: **`al80-image`**. Default to dry-run if neither mode given — never push to hardware
by accident.

```
al80-image <input> [options]

Mode (default --dry-run):
  --send                 Write the stream to the device over HID (0xFF60)
  --dry-run [<file>]     Emit packet stream to a file + validate; no hardware

Fitting:
  --fit <mode>           cover | contain | stretch | pad   (default cover)
  --pad-color <hex>      default #000000

Look bake-in (client-side only — no device opcode):
  --brightness <f>       1.0 = unchanged
  --contrast <f>         1.0 = unchanged
  --saturation <f>       0 = grayscale
  --grayscale            = --saturation 0
  --dither               Floyd–Steinberg before RGB565 quant (reduces banding)

Output/verify:
  --emit-format <fmt>    json | bin  (json matches capture schema)
  --verify               Run the Python round-trip validator (default on for dry-run)
  --preview <png>        Write a 112×137 PNG of the post-565 result
  -v, --verbose
```

## 6. Offline verification (no hardware) — the part that makes it trustworthy

`--dry-run` writes a JSON array matching the capture schema `analyze_captures.py` reads
(`[{"hex": "40 00 00 08 CF ..."}, ...]`, one record per 64-byte payload). Three layers, all offline:

1. **Self-check in the tool** (always on): recompute every block checksum (§5e) and assert;
   assert 548 blocks, offsets `0…30632`, total 30,688 bytes, announce/finish == constants.
2. **Cross-check against the Python validator** (`--verify`): extract `verify_announce_crc` /
   `verify_checksum` / `transactions` into `research/al80_verify.py` and call the same code the
   captures were verified with. Tool and validator disagreeing = a tool bug, caught pre-send.
3. **Round-trip vs the real capture** (CI-grade): run `al80_testpattern_135x240.png` through the
   pipeline (`--fit stretch`) and diff the emitted block *offsets/lengths/checksums* against
   `testpattern_capture_raw.json`. Pixels won't byte-match (the web app resamples differently),
   but the block *structure* must. Make it a repo test.

`--send` runs layer 1 before writing.

## 7. GIF: what's blocked, how to unblock

**Blocked:** forging a new GIF. Frames are full 112×137 RGB565 (~30,688 bytes) streamed in
banked ~1 KB windows; inside each bank the block form is identical to stills. The unknown is
the **bank-base encoding** in the `0x0A`/`0x07` setup packets (KB §10). Also unpinned:
frame-count and frame-rate bytes.

**Unblock (in order):**
1. **Decode the bank-base offline from the existing capture** — no hardware. `testgif_capture_raw.json`
   has 86 runs across 3 known solid-color frames; correlate each setup packet's variable bytes
   against the known bank base of the run that follows. Same move that cracked the still offsets.
2. Capture GIFs with different frame counts (2/4/5) to pin the count field.
3. Capture at different FPS (10/30/60) to pin the rate byte.

Until step 1 lands, GIF stays out. Structure so the still `FrameEncoder` is the reusable core;
GIF becomes a bank loop around it.

## 8. Risks and edge cases

- **30,688-byte exactness** — assert width/height after resize and buffer length before chunking;
  a wrong resize shifts every row.
- **No 16-byte still tail** — don't hardcode a short final block; `len` is 56 for all 548 blocks.
  Sending 30,648 bytes would corrupt the bottom of the image. Verified against the capture.
- **Big-endian** — RGB565 is high-byte-first (`F8 00` = red). Emitting little-endian gives a
  plausible-but-wrong palette. Test: a solid red frame must be `F8 00` repeating.
- **Transparency** — RGB565 has no alpha; flatten onto `--pad-color` before quantizing. Document it.
- **Odd aspect ratios** — warn when input aspect deviates from 0.817 by >2× (heavy crop/pad).
- **Single-opener (0xFF60)** — if the yunzii-game.com tab is open, `--send` fails. Detect
  `dev.write <= 0` and print "close the tab, retry." Don't loop-retry.
- **RGB565 banding** — gradients band; `--dither` mitigates.
- **Announce reuse** — valid only for 112×137 (size field byte[3,4,5] undecoded). Treat the
  announce as a constant tied to the fixed panel size.
- **DFU safety** — only ever emit `0x40/0x41/0x42`; never near `0xB0–0xB7` (brick risk).

## Recommended build order

1. `FrameEncoder`: decode → fit → bake → RGB565 BE → 548 blocks → self-check.
2. `--dry-run` JSON emit + `research/al80_verify.py` + the three-layer offline verification (make layer 3 a test).
3. CLI (§5) + `--send` reusing `al80_clock.js`'s device handling, guarded by the single-opener check.
4. Later, once §7 step 1 decodes the bank-base: GIF as a bank loop around the same `FrameEncoder`.

Ship 1–3 as v1: fully forgeable, fully testable offline, consistent with the existing Node tooling.
