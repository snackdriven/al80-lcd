# al80-image

Convert a still image into a forged HID transfer for the YUNZII AL80 LCD panel
(112×137, RGB565 **big-endian**). The whole still path is verified against real captures:
the announce is a known-good captured constant, the data-block checksum is cracked
(548/548 blocks match), the offset space is one flat run, and the finish is constant.

**v1 is still-images only. GIF is not supported yet** (the bank-base encoding in the GIF
setup packets isn't decoded, so a new GIF can't be forged — only the one captured test GIF
could be replayed). The frame encoder is structured so GIF can reuse it later.

## Install

```
cd converter
npm install        # sharp (image decode/resize) + node-hid (device send)
```

Node 18+. The pure encode/checksum/pack logic needs neither dependency — only image
decoding (`sharp`) and `--send` (`node-hid`) do. Python 3 is used by the verifier and is
optional (the tool degrades gracefully if it's missing).

## Usage

```
al80-image <input> [options]
```

Default mode is **dry-run** — it never touches hardware unless you pass `--send`.

```
Mode (default: --dry-run):
  --send                 Write the stream to the device over HID (0xFF60)
  --dry-run [<file>]     Emit packet stream to a file + validate; no hardware
                         (default file: <input>.al80.json / .al80.bin)

Fitting:
  --fit <mode>           cover | contain | stretch | pad   (default cover)
  --pad-color <hex>      #RRGGBB  (default #000000)

Look bake-in (client-side only — the panel has no image-adjust opcode):
  --brightness <f>       1.0 = unchanged
  --contrast <f>         1.0 = unchanged
  --saturation <f>       0 = grayscale
  --grayscale            = --saturation 0
  --dither               Floyd–Steinberg before RGB565 quant (reduces gradient banding)

Output / verify:
  --emit-format <fmt>    json | bin   (json matches the capture schema; default json)
  --verify               Run al80_verify.py on the emitted JSON (default on for dry-run)
  --preview <png>        Write a 112×137 PNG of the post-565 result (what the panel shows)
  -v, --verbose
  -h, --help
```

### Fit modes

| Mode | Behavior | Use for |
|------|----------|---------|
| `cover` (default) | scale to fill, center-crop overflow | photos, most content |
| `contain` | scale to fit, pad remainder with `--pad-color` | logos, full-frame diagrams |
| `stretch` | scale both axes to exact 112×137 | test patterns |
| `pad` | contain with an explicit `--pad-color` | letterbox in a chosen color |

`cover` is the default because the panel is tiny and letterbox bars waste it. Transparency
is flattened onto `--pad-color` before quantizing (RGB565 has no alpha).

## Offline dry-run workflow (the trustworthy part — no hardware)

```
al80-image photo.jpg --dry-run out.json --fit cover -v
```

Three layers of offline verification, all before anything is sent:

1. **Tool self-check (always on).** Recomputes every one of the 548 block checksums, asserts
   548 blocks, offsets `0…30632` step 56, total 30,688 bytes, announce/finish == the known
   constants. Runs on `--send` too, before the first write.
2. **Python cross-check (`--verify`, default on for dry-run).** `al80_verify.py` re-derives the
   announce CRC16-MODBUS and the data-packet checksum with the same logic the archived captures
   were verified with. Tool and verifier disagreeing means a tool bug, caught pre-send.
3. **Round-trip vs the real capture (repo test).** The offline test drives the pipeline and
   diffs emitted block offsets/lengths/checksums against `testpattern_capture_raw.json`.
   Pixels won't byte-match (the web app resamples differently) but the block *structure* must.

Run the Python verifier by hand on any emitted JSON:

```
python al80_verify.py out.json      # exit 0 = PASS, 1 = FAIL
```

Run the offline test (no hardware, no sharp/node-hid needed for the pure-logic checks):

```
npm test        # or: node test/frame_encoder.test.js
```

The test builds a synthetic solid-red frame by hand and asserts red → `F8 00` big-endian
repeating, 548 blocks, all checksums pass, and `al80_verify.py` PASSes on the emitted JSON.

## Sending to the device

```
al80-image photo.jpg --send -v
```

**Close the yunzii-game.com browser tab first.** The AL80's `0xFF60` interface is a
**single-opener** — if the web app holds it, `dev.write` returns ≤ 0 and `--send` fails with a
"close the tab, retry" message. It does **not** loop-retry. Close the tab and run it again.

The self-check runs before the first packet is written, so a malformed stream never reaches
the device. Only `0x40` / `0x41` / `0x42` opcodes are ever emitted (never near `0xB0–0xB7`,
the DFU/brick range).

## Output formats

- **json** (default) — capture schema: `[{"i": n, "hex": "40 00 00 08 cf ..."}, ...]`, one
  record per 64-byte HID payload (report-id byte excluded). This is what `al80_verify.py` and
  `research/analyze_captures.py` read.
- **bin** — raw concatenation of the 550 padded 64-byte payloads (announce + 548 blocks +
  finish = 35,200 bytes). `--verify` runs on JSON only.

## Notes / limits

- The announce constant (`40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01`) is valid **only** for
  112×137 (the size field isn't decoded). Treat it as tied to the fixed panel size.
- RGB565 is **big-endian**: red is `F8 00`. Little-endian would give a plausible-but-wrong
  palette — the test guards this.
- Every still block is 56 bytes; there is **no** short tail block (548 × 56 = 30,688 exactly).
  The 16-byte block only exists in GIF bank tails.
- Gradients band in RGB565; `--dither` mitigates.
- GIF: blocked on decoding the bank-base in the `0x0A`/`0x07` setup packets. See the design
  brief (`docs/converter-design.md`, §7) for the unblock plan.
```
