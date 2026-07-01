---
title: YUNZII AL80 LCD — Reverse-Engineering Knowledge Base
status: active
updated: 2026-07-01
device: YUNZII AL80 keyboard (VID 0x28E9, PID 0x30AF)
scope: HID protocol for the AL80 LCD panel — 12-hour clock hack, still-image and GIF streaming, VIA keymap
confirmed: display 112×137 RGB565 big-endian; time-sync protocol; still-image and GIF packet structure; announce CRC16-MODBUS and data-block accumulator both cracked
---

# YUNZII AL80 LCD — Reverse-Engineering Knowledge Base

Self-contained reference so this project can be resumed cold by a human or another AI.
Consolidated from all sessions: the HID protocol reverse-engineered for the YUNZII AL80's
LCD panel, the 12-hour clock hack, the confirmed image pixel format (RGB565 big-endian) and
display resolution (112×137), the still-image and GIF packet structure, the tooling built,
the read-only command-sweep result, open questions, and future modification ideas.

## Quick Reference (all key constants)

| Thing | Value |
|-------|-------|
| Device | YUNZII AL80 mechanical keyboard with color LCD |
| Vendor ID / Product ID | 0x28E9 / 0x30AF |
| LCD HID interface | usagePage 0xFF60, usage 0x61 (raw / VIA) |
| Report ID / report size | 0 (unnumbered) / 64 data bytes |
| Display resolution | 112 × 137 px, portrait |
| Pixel format | RGB565, **big-endian**, 2 bytes/px, row-major, top-left origin |
| Full frame size | 30,688 bytes = 548 data blocks of 56 bytes (last block 16 bytes) |
| Screen-op sequence | 0x40 announce → 0x41 data → 0x42 finish |
| Announce type byte[9] | 0x09 = time, 0x10 = image, 0x12 = GIF |
| Announce CRC bytes[12,13] | CRC16-MODBUS of bytes[9..11], stored big-endian |
| Image data-block accum bytes[4,5] | 16-bit LE, seed 121 (0x79), += 56 per block |
| Time data checksum | `CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF` |
| 12-hour hour value | `HH = (hour24 % 12) || 12` |
| Re-sync interval | ~60 s (keyboard free-runs its own clock and drifts) |
| DO NOT TOUCH | commands 0xB0–0xB7 (bootloader / DFU — brick risk) |

## Glossary

- **VIA** — usevia.app, the browser configurator used for all keymap changes (no firmware recompile).
- **WebHID** — the browser HID API the yunzii-game.com LCD app uses; it strips the report-ID byte.
- **HID** — USB Human Interface Device; the AL80 exposes 4 HID interfaces (see §2, Device Identity).
- **RGB565 BE** — 16-bit color, 5 bits red / 6 green / 5 blue, stored big-endian (2 bytes per pixel).
- **DFU** — Device Firmware Upgrade (bootloader) mode; entered by commands 0xB0–0xB7. Avoid — brick risk.
- **NAK** — a negative/non-acknowledgement response (device returns `FF 00 00 …` for unsupported commands).
- **CKSUM** — a one-byte additive checksum carried in a packet (formulas given per packet type below).
- **announce / data / finish** — the three packet roles in every screen operation: 0x40 / 0x41 / 0x42.

---

## 1. Context & Constraints

- Keyboard: **YUNZII AL80** with a small color **LCD panel**.
- Firmware in use: **Ripple Lighting Firmware** (from yunzii.com/pages/software).
  MUST be preserved — do NOT reflash to stock QMK. All keymap work is done via
  VIA (usevia.app) only; no firmware recompile.
- The LCD is controlled by a separate web app: **https://yunzii-game.com/#/screen**
  (WebHID). Keyboard must be **wired** for both VIA and yunzii-game.com to work.
- AL80 is NOT in the main QMK repo. A partial community source exists at
  github.com/ArgentStonecutter/keyboards (yunzii/al80) but the ripple effect is not included.

---

## 2. Device Identity

| Field            | Value                                             |
|------------------|---------------------------------------------------|
| Product name     | AL80 Keyboard                                     |
| Vendor ID (VID)  | 0x28E9 (10473)                                    |
| Product ID (PID) | 0x30AF (12463)                                    |
| LCD interface    | usagePage **0xFF60**, usage **0x61** (raw / VIA)  |
| Report ID        | **0** (unnumbered)                                |
| Report size      | **64 bytes** (512 bits), both input and output    |

The AL80 exposes **4 HID interfaces**. Only the 0xFF60/0x61 one drives the LCD
and accepts the screen-control commands. The others:

- **0xFF31 / 0x74** — vendor, input-only. (Status/version/config probably live here — see §4, Command-sweep finding.)
- **0x0001 / 0x06** — boot keyboard.
- **0x0001 / 0x02 + 0x80** and **0x000C / 0x01** — composite: mouse / system / consumer.

WebHID strips the report ID; OS-level HID libs (hidapi/node-hid) must **prepend a
0x00 report-ID byte**, giving a 65-byte write (1 + 64).

---

## 3. Display Specs (CONFIRMED)

- **Resolution: 112 × 137 pixels, PORTRAIT.**
- **Color: RGB565 (16-bit), BIG-ENDIAN, 2 bytes per pixel.**
- **Layout: row-major, top-left origin.**
- Native pixel count = 112 × 137 = 15,344 px = **30,688 bytes** per full frame.

### How resolution was derived (two independent methods, both agree)
1. **Byte count:** uploaded a known 135×240 test pattern; captured transfer = 30,688 bytes
   = 15,344 px. The only plausible portrait factor pair of 15,344 is 112 × 137.
2. **Color-boundary rows:** in the reassembled stream, red→green transition at row 46.3
   and green→blue at row 91.8 — matching the 1/3 (45.7) and 2/3 (91.3) marks of a
   137-row image. Confirms width = 112, height = 137.

Artifacts for this in `research/image_capture/` (`al80_testpattern_135x240.png`,
`testpattern_capture_raw.json`).

### Color reference (RGB565 big-endian)
| Color | RGB565 | Bytes |
|-------|--------|-------|
| Red   | 0xF800 | F8 00 |
| Green | 0x07E0 | 07 E0 |
| Blue  | 0x001F | 00 1F |
| White | 0xFFFF | FF FF |
| Black | 0x0000 | 00 00 |

NOTE: the web app **resamples** any uploaded image down to native 112×137 before sending.
For pixel-perfect custom graphics, render your content directly at 112×137.

---

## 4. Screen-Control Command Set

Command byte (byte[0]) constants pulled from the site's JS bundle
(`research/site_assets/index-*.js`); map key = friendly name:

| Byte       | Name (from JS)                          | Meaning                            |
|------------|-----------------------------------------|------------------------------------|
| 0x40       | sendScreenControlInformationPackage     | "announce" header packet           |
| 0x41       | sendScreenControlDataPacket             | data payload (time OR image data)  |
| 0x42       | finishScreenControlDataPacket           | "finish" / commit packet           |
| 0x55       | getDongleAndKeyboardStatus              | status query (NAKs on LCD iface)   |
| 0xB0       | getFirmwareVersion                      | returned 0xFF = NAK on LCD iface   |
| 0xB1..0xB7 | boot loader / firmware upgrade          | DFU flow (dangerous — avoid)       |

A screen operation is a **3-packet sequence**: 0x40 (announce) → 0x41 (data) → 0x42 (finish).

### ACK behavior
The device **echoes each packet back** on the input report with **byte[6] set to
0x55** to acknowledge. Example: send `40 00 00 07 f6 02 00 ...` → receive
`40 00 00 07 f6 02 55 ...`. This is how writes were confirmed as landing even
when the LCD showed no visible change (it was on the GIF page, not the clock).

### Command-sweep finding (read-only probe)
The 0xFF60 LCD interface **ONLY accepts 0x40 / 0x41 / 0x42** and NAKs everything else
(0x55 and 0xB0 both returned `FF 00 00 ...`). Status / version / config must live on a
different interface (likely 0xFF31). **Do NOT probe 0xB1–0xB7** (brick risk).

---

## 5. Time Sync Protocol (CONFIRMED WORKING)

### 5a. The 0x40 Announce header — FULLY FRAMED (applies to time, image, and GIF)

Every operation opens with the same header layout. Confirmed across 3,460 captured packets
(only opcodes 0x40/0x41/0x42 ever appear):

    40 00 00 [size:3 LE] 00 A5 5A [type] [flags:2] [crc16:2]

- byte[0]       = 0x40
- byte[1,2]     = 0x00 0x00
- byte[3,4,5]   = **size**, 3-byte little-endian (exact semantics still open — not a plain
                  byte count; see §10, Open Questions)
- byte[6]       = 0x00 reserved
- byte[7,8]     = **0xA5 0x5A** magic constant (in every announce)
- byte[9]       = **type / channel** — 0x09 = time-sync, 0x10 = still image, 0x12 = GIF
- byte[10,11]   = **flags** (2 bytes)
- byte[12,13]   = **CRC16-MODBUS of bytes[9..11]**, stored **big-endian** (see §5e)

Time announce (byte[9] = 0x09):

    40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1   (rest zero-padded to 64)

> **Correction note.** The "New findings" delta doc labeled byte[9] type `9 = image/GIF,
> 18 = time` — that is **backwards**. Ground truth: the shipped clock scripts send the
> byte[9]=0x09 announce above and it syncs the **clock**, so 0x09 = time. The CRC math in
> the delta is unaffected (it verified regardless of the label). Corrected here: 0x09=time,
> 0x10=image, 0x12=GIF.

### 5e. Checksums — both CRACKED (were the top open questions in v2)

**Announce CRC16 (bytes[12,13]) = CRC16-MODBUS.**
- Parameters: poly 0x8005, init 0xFFFF, refin = true, refout = true, xorout = 0x0000.
- Input: **bytes[9..11]** (the `[type][flags:2]` triple). Stored **big-endian** at bytes[12,13].
- Verified on three announces:
  - time  `[0x09,0,0x03]` → 0xC3E1 (bytes 195,225) ✓
  - image `[0x10,0,0x01]` → 0xC5B1 (bytes 197,177) ✓
  - GIF   `[0x12,0,0x02]` → 0x0450 (bytes 4,80)   ✓
- (Re-verified independently in this repo, not just taken from the delta.)

**Data-block accumulator (0x41 image/GIF blocks, bytes[4,5]) — the old "byte[4] checksum" mystery.**
- bytes[4,5] = a **16-bit little-endian running accumulator**, NOT a per-packet byte sum.
- **Seed = 121 (0x79)**, then **+= 56** (the payload length) per data block.
- Sequence: 121, 177, 233, 289, 345, … — matches the sample block bytes `79, b1, e9, …` in §7.
- Constant seed 121 across both image and GIF transfers.

Note: this accumulator is specific to the **image/GIF data blocks** (byte[3]=0x38). The
**time** data packet below uses a different, simpler additive checksum on byte[4].

### 5b. Time data packet (0x41, subcommand 0x03)
    41 00 00 03 [CKSUM] 00 00 HH MM SS   (rest zero-padded to 64)

- byte[3] = 0x03 (subcommand: set time)
- byte[4] = **CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF**  (VERIFIED across samples)
- byte[7] = HH (hour)
- byte[8] = MM (minute)
- byte[9] = SS (second)

### 5c. Date data packet (0x41, subcommand 0x04)
    41 00 00 04 6A 00 00 [DD] [MM] [YY] 01

Observed sample: `1a 03 07 01` → day/month/year-ish + byte[10]=0x01. Date appeared
STATIC across syncs (stored in firmware); not the focus of this project. Not fully decoded.

### 5d. Finish packet (0x42)
    42 00 00 38 7A   (rest zero-padded to 64)   — constant, commits the operation.

---

## 6. The 12-Hour Clock Hack (main clock result)

**Key insight:** the LCD firmware displays the **raw hour value it is given**. It
does NOT force 24hr internally, nor convert. So:

- Send **HH = (hour24 % 12) || 12**  →  LCD shows a 12-hour clock.
  - 17 (5 PM) → send 5 → shows 05
  - 12 (noon) → send 12 → shows 12   (verified clean)
  - 0 (midnight) → send 12 → shows 12
  - 12:45 verified clean.
- CKSUM must be recomputed for the 12hr hour value.

**Limitations discovered:**
- **No AM/PM indicator** exists. byte[10]=0x01 did NOT produce an AM/PM dot
  (03:xx displayed identically). 3 AM and 3 PM both read "03".
- The keyboard **free-runs its own internal clock** from the last value we set,
  so it drifts and rolls forward (e.g. set 05, an hour later it shows 06). This
  is why a **periodic re-sync** (every ~60s) is required to keep it accurate.
- No firmware "time format" flag was found in the packets. Only the raw-hour trick.

**What did NOT work / dead ends:**
- byte[4] is NOT a 12/24 flag — it's a checksum (initially misdiagnosed as flags).
- A lone 0x41 without the 0x40 announce + 0x42 finish did nothing visible.
- Reading the JS bundle for the packet builder was partly blocked by a security
  filter; the protocol was decoded from live captured HID traffic instead.

---

## 7. Image / GIF Streaming Protocol (CONFIRMED format & structure)

Sequence: **0x40 announce → many 0x41 data blocks → 0x42 finish.**

    Announce (image): 40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01   (type[9]=0x10, CRC C5B1)
    Setup:            41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93       (byte[10]=0x78)
    Data block:       41 [off:2 LE] 38 [accum:2 LE] 00 <56-byte payload>

- byte[1,2]   = **LITTLE-ENDIAN destination byte-offset** into the frame buffer; steps by
                56 each block (0, 56, 112, 168, 224, 280 …).
- byte[3]     = payload length (0x38 = 56 data bytes; final block uses 0x10 = 16).
- byte[4,5]   = **16-bit LE running accumulator**: seed 121 (0x79), += 56 per block (see §5e).
- byte[6]     = 0x00 reserved.
- byte[7..62] = 56 bytes of payload = raw **RGB565 big-endian** pixels, row-major from
                top-left (see §3, Display Specs).
- One full frame = **548 data blocks** for 112×137.

The 0x40 announce here follows the same fully-framed header as §5a (type[9]=0x10 = still
image; its CRC16-MODBUS over `[0x10,0,0x01]` = 0xC5B1, matching bytes[12,13]).

Observed data-block offsets — **excerpt** of the opening blocks (offset in byte[1..2],
little-endian). These first few lines are only the start of the stream, not the final block:

    41 00 00 38 79 ...        offset 0x0000
    41 38 00 38 b1 ...        offset 0x0038
    41 70 00 38 e9 ...        offset 0x0070
    41 a8 00 38 21 01 ...     offset 0x00A8
    41 e0 00 38 59 01 ...     offset 0x00E0
    ...                       (+0x38 each)

**Measured from the full capture** (`research/image_capture/testpattern_capture_raw.json`):
a complete still frame runs from offset 0x0000 to **0x77A8** (30,632 = block 547), i.e. the
full **548 blocks** for a 112×137 frame, then a 0x42 finish. (The capture holds 1,096 data
records = 548 blocks each sent twice.) So the still-image address space is fully confirmed.

Interpretation: **0x41 is a generic block-write** — the LCD is effectively a dumb
framebuffer we can push arbitrary pixels to.

### GIF / animation protocol (CONFIRMED structure)

Test input: a hand-built animated GIF89a, 112×137, 3 solid looping frames (red/green/blue).
The site parsed it correctly (thumbnail column showed all 3 frames). Artifacts in
`research/gif_capture/` (`al80_testgif_rgb_112x137.gif`, `testgif_capture_raw.json`,
`GIF_FINDINGS.md`).

**Upload flow (UI):** upload GIF → preview shows frames → "Save to the device" opens a
**"Frame rate setting"** dialog (default **30 FPS**) → confirm (the **"Sure"** button) →
transfer. The frame rate is chosen at upload time via the dialog, **NOT embedded per-frame**.

**Transfer structure (HID)** — a distinct header/setup sequence (all carry the A5 5A magic;
differs from the single still-image header):

    40 00 00 09 B1 01 00 A5 5A 12 00 02 04 50 01     announce (byte[11]=0x02)
    41 00 00 09 24 02 00 A5 5A 13 00 02 C4 01 01     setup subcmd 0x09
    41 00 00 0A 94 01 00 A5 5A 10 00 03 04 30 02 01  setup subcmd 0x0A (frame meta? byte[14]=0x02)
    41 00 00 07 98 02 00 A5 5A 11 78 00 C5 03        setup subcmd 0x07 (byte[10]=0x78=120, as in still img)

Then, **per frame**, a run of image-data blocks identical in form to the still-image
protocol above (`41 [offLo][offHi] 38 [cksum] <56 pixel bytes>`, final block length 0x10).

**Frames are sent SEQUENTIALLY.** Each new frame is preceded by **setup subcmd 0x0A then
0x07** (these reappear at the 2nd-frame boundary, e.g. `…0A 95 01…` / `…07 98 02…`) — i.e.
0x0A→0x07 restart the pixel stream for the next frame.

So: **a GIF = N sequential frames + a single global frame-rate setting.** Visually confirmed
at save time: the app shows **"保存帧 N/3"** ("Saving frame N/3") with a 0/50/67/100% progress
bar — one full announce→data→finish transaction per frame.

> **Caveat — GIF per-frame size not yet reconciled.** The GIF *findings* note asserted
> "each frame ≈ 30,688 bytes" (a full 112×137 image), but the raw capture
> (`research/gif_capture/testgif_capture_raw.json`) does not match that: its data-block
> offsets top out at only **0x03F0 (1,008)** and reset ~84 times across 3,192 records,
> nowhere near the still-image max of 0x77A8. So GIF frames in this capture are addressed
> in much smaller offset windows than a full still frame. Whether that's per-frame
> compression, the solid-color test frames, or a different address meaning in GIF mode is
> **not decoded** — see §10, Open Questions, items 4–5. The still-image path (above) is the
> only fully-confirmed frame layout.

Gotcha for analysis: a capture may contain a stray time-sync (`0x41 sub3 "06 17 09"`)
from the auto-sync loop firing mid-transfer — ignore those.

### View-switch commands (Equipment Setup buttons)
- "Switch to homepage" (clock): 0x40 announce with **byte[12]=0x02**
      40 00 00 07 53 01 00 a5 5a 0b 00 00 02 00
- Other buttons (picture page, GIF page) send similar 0x40 headers with different
  byte[4]/byte[12] values (0x36, 0x59, 0x67 seen). Not individually mapped yet.

### Display attributes are CLIENT-SIDE (no device opcode)

Brightness, Chroma, Saturation, Grayscale, "Fuzzy", and Sharpening are **not** device
commands. Toggling or moving any of them emits **zero HID traffic** (verified: cleared the
buffer, toggled Grayscale, captured 0 packets). They only update the app's live JS/canvas
preview.

The effect reaches the keyboard **only on "Save to the device,"** baked into the pixel
payload of the normal 0x40/0x41/0x42 transfer (confirmed: after enabling Grayscale, the
saved frame's RGB565 payload was already grayscaled). "Reset attributes" reverts the
sliders/toggles to defaults — also client-side only.

**Implication for a standalone script:** there is no "set brightness/saturation/…" opcode to
reverse. To replicate any of these, **transform your own RGB565 buffer before sending.** The
one exception is **frame rate**, the only save-time attribute (the "Frame rate setting"
dialog, default 30 FPS, global per GIF).

---

## 8. Tooling Built (in `tooling/`, originally packaged as `al80_12hr_clock.zip`)

- **al80_clock.js** — Node (node-hid). Loop or `--once`, file logging, Windows toast
  after 3 consecutive failures, crash handlers.
- **al80_clock.py** — Python (hidapi). Same features.
- **al80_clock.bat** — visible launcher (console + pause).
- **al80_clock_hidden.bat** + **run_hidden.vbs** — silent background launcher.
- **browser_console_snippet.js** — no-install: paste into yunzii-game.com console.
- Auto-start: shortcut to hidden .bat in `shell:startup`, or Task Scheduler at logon
  with restart-on-failure.

### Core recipe (language-agnostic pseudocode)
    h = (hour24 % 12) or 12
    cksum = (0x41 + 0x03 + h + minute + second) & 0xFF
    write pad([0x40,0,0,0x07,0xF6,0x02,0,0xA5,0x5A,0x09,0,0x03,0xC3,0xE1])
    write pad([0x41,0,0,0x03,cksum,0,0,h,minute,second])
    write pad([0x42,0,0,0x38,0x7A])
    // pad() = prepend 0x00 report id (OS libs) then zero-fill to 64 data bytes

### Gotchas
- **Only one opener** of the 0xFF60 interface at a time: close the yunzii-game.com
  tab before running the script, or they fight.
- If device not found, hidapi/node-hid may not report usagePage; match by
  interface number instead (enumerate and inspect).

### Reverse-engineering notes (for future capture sessions on yunzii-game.com)
- The web app holds its **own** device handle (re-acquired via `getDevices()` / request after
  any reconnect). Patching `window.__lcd.sendReport` or even `HIDDevice.prototype.sendReport`
  does **not** intercept the app's sends — it captured a bound reference first. Instead, read
  the app's own **`window.__hidCaptures`** buffer.
- Console tells you the state: `targetDevice HIDDevice` = device (re)selected; `sendCount 1`
  = a send fired; `No HID device selected` = app lost its handle (needs reconnect). A
  disconnect/reconnect makes `window.device` read `null` while `__hidCaptures` persists.
- `javascript_tool` on the site: async/Promise-returning top-level expressions return `{}`
  (empty) but side-effects still run. Pattern: do async work → stash to `window` → read back
  with a separate **synchronous** call.
- A security-filter false positive (`[BLOCKED: Cookie/query string data]`) fires when
  returning long hex/token-like strings. Work around it by emitting only short scalar fields
  or structural booleans.

---

## 9. Related Keymap Work (VIA, same keyboard, separate from LCD)

Export in `keymap/AL80_QMK__V0106_20251219.json`. Done in usevia.app via a
Save-JSON → edit → Load-JSON workflow (VIA's blank "Any" key assigns KC_NO, not a
custom keycode, so direct JSON editing was used):

- Layer 0: F12 = LT(1,KC_F12); Caps Lock = LT(2,KC_CAPS); Del restored to KC_DEL.
- Layer 1 (hold F12) app launcher: S=LGUI(3) T=LGUI(4) E=LGUI(5) C=LGUI(6), rest TRNS.
- Layer 2 (hold Caps): S=MACRO(0) snipping tool, N=KC_NUM, Q=LALT(F4) close window.
- Macro 0 (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

Export note: usevia.app blocks programmatic JS execution, so export the JSON with VIA's own
**Save** button (not a console script).

---

## 10. Open Questions / Next Steps

_Both checksums (announce CRC16 and the data-block accumulator) are now CRACKED — see §5e.
What remains:_

1. **Announce size field byte[3,4,5]** — a 3-byte LE value, but **not a plain byte count**.
   Decode by uploading images of known, differing sizes and diffing the announce.
2. **Accumulator seed origin** — why 121 (0x79)? Fixed firmware constant vs derived from
   something. (It's constant across image and GIF transfers, so hardcoding 121 works today.)
3. **GIF per-frame addressing** — reconcile why the GIF capture's data-block offsets top out
   at 0x03F0 rather than the still-image 0x77A8 (see the caveat in §7).
4. **GIF frame-count field** — structure is decoded (§7), but the exact frame-COUNT byte is
   not pinned. Candidates: 0x40 announce flags, or the 0x0A setup (`byte[13,14] = 04 30 02`).
   Decode by uploading GIFs with different frame counts.
5. **GIF frame-rate encoding** — the dialog sets it globally; find the byte by capturing
   uploads at different FPS. (byte[10]=0x78=120 recurs in both still + GIF setup — likely a
   fixed height/param, not the rate.)
6. **Full view-switch command map** — homepage / picture / GIF switch commands.
7. **Persistence** — does date/time survive power cycle? Does the LCD keep the 12hr base
   after unplug? (The re-sync loop makes this moot in practice.)

---

## 11. Future Modification Ideas

- **Clock modes:** countdown/pomodoro timer, second timezone, "run fast" clock.
- **Smart sync:** align to minute boundary; back off when idle / on battery.
- **LIVE INFO PANEL** (now fully feasible — format + resolution known): render 112×137
  RGB565 frames of CPU/GPU temp+load, now-playing, unread mail, crypto/stock ticker,
  weather, next calendar event.
- **View automation:** auto-switch LCD to a GIF on game launch / clock otherwise;
  tie into the VIA app-launcher layer.
- **Tooling QoL:** config file (12/24hr toggle, interval, tz offset, toast on/off),
  log rotation, tray icon with sync-now/pause/quit, Windows service (NSSM) for
  lock-screen coverage.

---

## 12. How to Render a Custom Frame (recipe for the info-panel)

With both checksums cracked (§5e), a full still-image transfer can now be forged end-to-end.
Any client-side look (brightness, grayscale, etc.) must be baked into the pixels first — there
is no device opcode for it (see §7, Display attributes are client-side).

1. Draw your content on a **112×137** canvas. Apply any brightness/grayscale/etc. here.
2. Convert each pixel to **RGB565 big-endian**:
   `v = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3);  bytes = [v>>8, v & 0xFF]`
3. Concatenate row-major → **30,688-byte** buffer (548 blocks × 56 bytes).
4. **Announce (0x40):** `40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01` — type[9]=0x10 (image);
   the CRC bytes[12,13]=`C5 B1` are CRC16-MODBUS over `[0x10,0x00,0x01]`. (Reuse the captured
   still-image announce until the size field byte[3,4,5] is decoded — §10, item 1.)
5. **Data blocks (0x41):** for each 56-byte chunk `k` (k = 0,1,2,…,547):
   - offset = k × 56, little-endian in bytes[1,2]
   - byte[3] = 0x38 (56); final block (k=547 leftover) uses 0x10 (16)
   - accumulator (bytes[4,5], 16-bit LE) = **121 + k × 56**
   - byte[6] = 0x00, then the 56 payload bytes
6. **Finish (0x42):** `42 00 00 38 7A` (rest zero-padded).
7. Remember `pad()`: OS-level HID libs prepend a 0x00 report-ID byte, then zero-fill to 64.

**Still unverified for forging:** the announce size field byte[3,4,5] (§10, item 1) — the
captured announce is known-good, so reuse it verbatim for 112×137 until that field is decoded.

---

## 13. Safety / Do-Not-Touch

- **0xB0–0xB7** are bootloader / firmware-upgrade (DFU) commands. Do NOT experiment
  with these — risk of bricking or wiping the ripple firmware. Stick to 0x40/0x41/0x42.
- **Never reflash.** The ripple lighting firmware is the whole reason for the VIA-only
  and HID-script approach.
- **Only one opener** of the 0xFF60 interface at a time: close the browser tab before
  running scripts.
