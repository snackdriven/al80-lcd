# YUNZII AL80 LCD — Reverse-Engineering Knowledge Base

> **SUPERSEDED — this is v1, kept for archival detail.** The current reference is
> [`AL80_KNOWLEDGE_BASE.md`](AL80_KNOWLEDGE_BASE.md) (v2), which confirms display
> resolution (112×137) and pixel format (RGB565 BE) and adds the image-stream
> structure. v1 is retained because it holds a few granular capture samples and
> per-interface details that v2 compressed out.

> Purpose: a self-contained reference so this project can be resumed cold by a
> human or another AI. Documents the HID protocol we reverse-engineered for the
> AL80's LCD screen, the 12-hour clock hack, the tooling built, open questions,
> and future modification ideas.
>
> Last updated: (session where 12hr clock was achieved)

---

## 1. Context & Constraints

- Keyboard: **YUNZII AL80** with a small color **LCD panel**.
- Firmware in use: **Ripple Lighting Firmware** (from yunzii.com/pages/software).
  MUST be preserved — do NOT reflash to stock QMK. All keymap work is done via
  VIA (usevia.app) only; no firmware recompile.
- The LCD is controlled by a separate web app: **https://yunzii-game.com/#/screen**
  (WebHID). Keyboard must be **wired** for both VIA and yunzii-game.com to work.
- AL80 is NOT in the main QMK repo. A partial community source exists at
  github.com/ArgentStonecutter/keyboards (yunzii/al80) but ripple effect not included.

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
- 0xFF31 / 0x74 (vendor, input-only)
- 0x0001 / 0x06 (boot keyboard)
- 0x0001 / 0x02 + 0x80 + 0x000C/0x01 (composite: mouse/system/consumer)

WebHID strips the report ID; OS-level HID libs (hidapi/node-hid) must **prepend a
0x00 report-ID byte**, giving a 65-byte write (1 + 64).

---

## 3. Screen-Control Command Set

Command byte (byte[0]) constants pulled from the site's JS bundle
(assets/index-*.js), map key = friendly name:

| Byte  | Name (from JS)                          | Meaning                          |
|-------|-----------------------------------------|----------------------------------|
| 0x40  | sendScreenControlInformationPackage     | "announce" header packet         |
| 0x41  | sendScreenControlDataPacket             | data payload (time OR image data)|
| 0x42  | finishScreenControlDataPacket           | "finish"/commit packet           |
| 0x55  | getDongleAndKeyboardStatus              | status query                     |
| 0xB0  | getFirmwareVersion                      | (returned 0xFF = NAK on LCD iface)|
| 0xB1..0xB7 | boot loader / firmware upgrade     | DFU flow (dangerous - avoid)     |

A screen operation is a **3-packet sequence**: 0x40 (announce) -> 0x41 (data) -> 0x42 (finish).

### ACK behavior
The device **echoes each packet back** on the input report with **byte[6] set to
0x55** to acknowledge. Example: send "40 00 00 07 f6 02 00 ..." -> receive
"40 00 00 07 f6 02 **55** ...". This is how we confirmed writes were landing even
when the LCD showed no visible change (it was on the GIF page, not the clock).

---

## 4. Time Sync Protocol (CONFIRMED WORKING)

### 4a. Announce packet (0x40) for time
    40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1   (rest zero-padded to 64)

Observed structure of the 0x40 header:
- byte[3]  = length/type marker (0x07 for time/date announce)
- byte[4]  = checksum-ish (≈ sum of other bytes; see open question below)
- byte[5]  = varies 0x01/0x02 (payload count?)
- byte[7,8]= **0xA5 0x5A** magic constant (always present)
- byte[9]  = sequence counter (increments across operations: 09, 0a, 0d, 0e...)
- byte[11] = **announces the upcoming 0x41 subcommand** (0x03 = time, 0x04 = date)
- byte[12,13] = likely CRC16 of the payload

### 4b. Time data packet (0x41, subcommand 0x03)
    41 00 00 03 [CKSUM] 00 00 HH MM SS   (rest zero-padded to 64)

- byte[3]  = 0x03 (subcommand: set time)
- byte[4]  = **CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF**  (VERIFIED across samples)
- byte[7]  = HH (hour)
- byte[8]  = MM (minute)
- byte[9]  = SS (second)

### 4c. Date data packet (0x41, subcommand 0x04)
    41 00 00 04 6A 00 00 [DD] [MM] [YY] 01
Observed: 1a 03 07 01 -> day/month/year-ish + byte[10]=0x01. Date appeared STATIC
across syncs (stored in firmware); not the focus of this project. Not fully decoded.

### 4d. Finish packet (0x42)
    42 00 00 38 7A   (rest zero-padded to 64)   — constant, commits the operation.

---

## 5. THE 12-HOUR CLOCK HACK (the main result)

**Key insight:** the LCD firmware displays the **raw hour value it is given**. It
does NOT force 24hr internally, nor convert. So:

- Send **HH = (hour24 % 12) || 12**  ->  LCD shows a 12-hour clock.
  - 17 (5 PM) -> send 5 -> shows 05
  - 12 (noon) -> send 12 -> shows 12   (verified clean)
  - 0  (midnight) -> send 12 -> shows 12
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

## 6. Image / GIF Streaming (OBSERVED, NOT FULLY DECODED)

When uploading pictures/GIFs via the site, hundreds of 0x41 packets stream with
an **incrementing address in byte[1..2]**:

    41 00 00 38 79 ...
    41 38 00 38 b1 ...
    41 70 00 38 e9 ...
    41 a8 00 38 21 01 ...
    41 e0 00 38 59 01 ...
    ... (offset increases by 0x38 = 56 bytes each; byte[3]=0x38 = payload length)
    41 f0 03 10 44 01 ...  (last chunk uses 0x10 length)

Interpretation: **0x41 is a generic block-write**; byte[1..2] = little-endian
destination offset, byte[3] = chunk length (0x38 = 56 data bytes/packet), byte[4]
= running checksum. The LCD is effectively a dumb framebuffer we can push arbitrary
pixels to. **Open work:** decode the 0x40 announce header that precedes an image
(sets dimensions/format), and the pixel format (likely RGB565, LCD appears ~portrait).

### View-switch commands (from Equipment Setup buttons)
- "Switch to homepage" (clock): 0x40 announce with **byte[12]=0x02**
      40 00 00 07 53 01 00 a5 5a 0b 00 00 02 00
- Other buttons (picture page, GIF page) send similar 0x40 headers with different
  byte[4]/byte[12] values (0x36, 0x59, 0x67 seen). Not individually mapped yet.

---

## 7. Tooling Built (shipped in al80_12hr_clock.zip)

- **al80_clock.js** — Node (node-hid). Loop or --once, file logging, Windows toast
  after 3 consecutive failures, crash handlers.
- **al80_clock.py** — Python (hidapi). Same features.
- **al80_clock.bat** — visible launcher (console + pause).
- **al80_clock_hidden.bat** + **run_hidden.vbs** — silent background launcher.
- **browser_console_snippet.js** — no-install: paste into yunzii-game.com console.
- Auto-start: shortcut to hidden .bat in shell:startup, or Task Scheduler at logon
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

## 8. Related Keymap Work (VIA, same keyboard, separate from LCD)

Done in usevia.app via a Save-JSON -> edit -> Load-JSON workflow (VIA's blank "Any"
key assigns KC_NO, not a custom keycode, so direct JSON editing was used):
- Layer 0: F12 = LT(1,KC_F12); Caps Lock = LT(2,KC_CAPS); Del restored to KC_DEL.
- Layer 1 (hold F12) app launcher: S=LGUI(3) T=LGUI(4) E=LGUI(5) C=LGUI(6), rest TRNS.
- Layer 2 (hold Caps): S=MACRO(0) snipping tool, N=KC_NUM, Q=LALT(F4) close window.
- Macro 0 (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

---

## 9. Open Questions / Next Steps

1. **0x40 checksum (byte[4])** — consistently ≈ (sum of payload bytes) but off by a
   small constant (1-2). Nail the exact formula; needed to forge new announce packets.
2. **0x40 byte[12,13]** — presumed CRC16 of payload. Identify polynomial/seed.
3. **Image stream header** — decode dimensions + pixel format (RGB565?) to push
   arbitrary bitmaps -> enables a live info panel (CPU/GPU, weather, now-playing, etc).
4. **View-switch map** — fully map homepage/picture/GIF switch commands.
5. **Persistence** — does date/time survive power cycle? Does the LCD keep 12hr base
   after unplug? (Re-sync loop makes this moot in practice.)

## 10. Future Modification Ideas (brainstorm)

- **Clock modes:** countdown/pomodoro timer, second timezone, "run fast" clock.
- **Smart sync:** align to minute boundary; back off when idle/on battery.
- **Live info panel** (needs image protocol): CPU/GPU temp+load, now-playing,
  unread mail count, crypto/stock ticker, weather, next calendar event.
- **View automation:** auto-switch LCD to a GIF on game launch / clock otherwise;
  tie into the VIA app-launcher layer.
- **Tooling QoL:** config file (12/24hr toggle, interval, tz offset, toast on/off),
  log rotation, tray icon with sync-now/pause/quit, Windows service (NSSM) for
  lock-screen coverage.

---

## 11. Safety / Do-Not-Touch

- 0xB0-0xB7 are bootloader/firmware-upgrade commands. Do NOT experiment with these
  — risk of bricking or wiping the ripple firmware. Stick to 0x40/0x41/0x42.
- Never reflash. The ripple lighting firmware is the whole reason for the VIA-only
  and HID-script approach.
