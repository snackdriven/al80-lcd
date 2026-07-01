# YUNZII AL80 LCD — Reverse-Engineering Knowledge Base

> Self-contained reference so this project can be resumed cold by a human or another AI.
> Consolidated from all sessions: the HID protocol reverse-engineered for the AL80's LCD,
> the 12-hour clock hack, the CONFIRMED image pixel format (RGB565 BE) and display
> resolution (112×137), the image-stream packet structure, the tooling built, the
> read-only command-sweep result, open questions, and future modification ideas.

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

- **0xFF31 / 0x74** — vendor, input-only. (Status/version/config probably live here — see §4 command-sweep.)
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

### 5a. Announce packet (0x40) for time
    40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1   (rest zero-padded to 64)

Observed structure of the 0x40 header:
- byte[3]     = length / type marker (0x07 for time/date announce)
- byte[4]     = checksum-ish (≈ sum of other bytes; see open question §10)
- byte[5]     = varies 0x01 / 0x02 (payload count?)
- byte[7,8]   = **0xA5 0x5A** magic constant (always present)
- byte[9]     = sequence counter (increments across operations: 09, 0a, 0d, 0e…)
- byte[11]    = **announces the upcoming 0x41 subcommand** (0x03 = time, 0x04 = date)
- byte[12,13] = likely CRC16 of the payload

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

    Announce (image): 40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01   (byte[11]=0x01)
    Setup:            41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93       (byte[10]=0x78)
    Data block:       41 [offLo] [offHi] 38 [cksum] ... 56 bytes payload ...

- byte[1,2] = **LITTLE-ENDIAN destination offset**, increments by 0x38 (=56) each block
- byte[3]   = chunk length (0x38 = 56 data bytes; final block uses 0x10)
- byte[4]   = running checksum
- Pixel bytes are **RGB565 BE, row-major from top-left** (see §3).
- One full frame = **548 data blocks** for 112×137.

Observed data-block offsets from a real capture (offset in byte[1..2], little-endian):

    41 00 00 38 79 ...        offset 0x0000
    41 38 00 38 b1 ...        offset 0x0038
    41 70 00 38 e9 ...        offset 0x0070
    41 a8 00 38 21 01 ...     offset 0x00A8
    41 e0 00 38 59 01 ...     offset 0x00E0
    ...                       (+0x38 each)
    41 f0 03 10 44 01 ...     final chunk, length 0x10

Interpretation: **0x41 is a generic block-write** — the LCD is effectively a dumb
framebuffer we can push arbitrary pixels to.

### GIF / animation protocol (CONFIRMED structure)

Test input: a hand-built animated GIF89a, 112×137, 3 solid looping frames (red/green/blue).
The site parsed it correctly (thumbnail column showed all 3 frames). Artifacts in
`research/gif_capture/` (`al80_testgif_rgb_112x137.gif`, `testgif_capture_raw.json`,
`GIF_FINDINGS.md`).

**Upload flow (UI):** upload GIF → preview shows frames → "Save to the device" opens a
**"Frame rate setting"** dialog (default **30 FPS**) → confirm → transfer. The frame rate
is chosen at upload time via the dialog, **NOT embedded per-frame**.

**Transfer structure (HID)** — a distinct header/setup sequence (all carry the A5 5A magic;
differs from the single still-image header):

    40 00 00 09 B1 01 00 A5 5A 12 00 02 04 50 01     announce (byte[11]=0x02)
    41 00 00 09 24 02 00 A5 5A 13 00 02 C4 01 01     setup subcmd 0x09
    41 00 00 0A 94 01 00 A5 5A 10 00 03 04 30 02 01  setup subcmd 0x0A (frame meta? byte[14]=0x02)
    41 00 00 07 98 02 00 A5 5A 11 78 00 C5 03        setup subcmd 0x07 (byte[10]=0x78=120, as in still img)

Then, **per frame**, a run of image-data blocks identical in form to the still-image
protocol above (`41 [offLo][offHi] 38 [cksum] <56 pixel bytes>`, offset stepping
0x00, 0x38, 0x70, … 0x3F0; final block length 0x10). Each frame = ~30,688 bytes =
one full 112×137 RGB565 big-endian image.

**Frames are sent SEQUENTIALLY.** Each new frame is preceded by **setup subcmd 0x0A then
0x07** (these reappear at the 2nd-frame boundary, e.g. `…0A 95 01…` / `…07 98 02…`) — i.e.
0x0A→0x07 restart the pixel stream for the next frame.

So: **a GIF = N sequential full frames + a single global frame-rate setting.**

Gotcha for analysis: a capture may contain a stray time-sync (`0x41 sub3 "06 17 09"`)
from the auto-sync loop firing mid-transfer — ignore those.

### View-switch commands (Equipment Setup buttons)
- "Switch to homepage" (clock): 0x40 announce with **byte[12]=0x02**
      40 00 00 07 53 01 00 a5 5a 0b 00 00 02 00
- Other buttons (picture page, GIF page) send similar 0x40 headers with different
  byte[4]/byte[12] values (0x36, 0x59, 0x67 seen). Not individually mapped yet.

---

## 8. Tooling Built (shipped in `tooling/`)

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

---

## 9. Related Keymap Work (VIA, same keyboard, separate from LCD)

Export in `keymap/AL80_QMK__V0106_20251219.json`. Done in usevia.app via a
Save-JSON → edit → Load-JSON workflow (VIA's blank "Any" key assigns KC_NO, not a
custom keycode, so direct JSON editing was used):

- Layer 0: F12 = LT(1,KC_F12); Caps Lock = LT(2,KC_CAPS); Del restored to KC_DEL.
- Layer 1 (hold F12) app launcher: S=LGUI(3) T=LGUI(4) E=LGUI(5) C=LGUI(6), rest TRNS.
- Layer 2 (hold Caps): S=MACRO(0) snipping tool, N=KC_NUM, Q=LALT(F4) close window.
- Macro 0 (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

---

## 10. Open Questions / Next Steps

1. **0x40 checksum (byte[4])** — consistently ≈ (sum of payload bytes) but off by a
   small constant (1–2). Nail the exact formula; needed to forge new announce packets.
2. **0x40 byte[12,13]** — presumed CRC16 of payload. Identify polynomial/seed.
3. **Image announce/setup header** — exact width/height/length encoding. We have samples
   in the capture (announce byte[3]=0x08, setup byte[10]=0x78); correlate to derive fields.
4. **GIF frame-count field** — structure is decoded (§7), but the exact frame-COUNT
   byte is not pinned. Likely in the 0x40 announce (byte[12,13] = `04 50`) or the 0x0A
   setup (byte[13,14] = `04 30 02`). Decode by uploading GIFs with different frame counts.
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

1. Draw your content on a **112×137** canvas.
2. Convert each pixel to **RGB565 big-endian**:
   `v = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3);  bytes = [v>>8, v & 0xFF]`
3. Concatenate row-major → **30,688-byte** buffer.
4. Send the 0x40 image announce, then 0x41 blocks (56 bytes each, LE offset stepping
   by 0x38), then 0x42 finish.
5. **Unknowns to nail first:** the exact announce/setup header fields and the
   checksum/CRC (§10, items 1–3).

---

## 13. Safety / Do-Not-Touch

- **0xB0–0xB7** are bootloader / firmware-upgrade (DFU) commands. Do NOT experiment
  with these — risk of bricking or wiping the ripple firmware. Stick to 0x40/0x41/0x42.
- **Never reflash.** The ripple lighting firmware is the whole reason for the VIA-only
  and HID-script approach.
- **Only one opener** of the 0xFF60 interface at a time: close the browser tab before
  running scripts.
