# YUNZII AL80 LCD — Reverse-Engineering Knowledge Base (v2)

> Self-contained reference so this project can be resumed cold by a human or another AI.
> v2 adds: CONFIRMED image pixel format (RGB565 BE), CONFIRMED display resolution
> (112x137), image-stream packet structure, and the read-only command-sweep result.

---

## 1. Context & Constraints
- Keyboard: YUNZII AL80 with a small color LCD panel.
- Firmware: Ripple Lighting Firmware (yunzii.com/pages/software). MUST be preserved -
  do NOT reflash to stock QMK. Keymap work via VIA (usevia.app) only; no recompile.
- LCD controlled by web app https://yunzii-game.com/#/screen (WebHID). Keyboard must be WIRED.
- AL80 not in main QMK repo. Partial community source: github.com/ArgentStonecutter/keyboards.

## 2. Device Identity
| Field | Value |
|-------|-------|
| Product | AL80 Keyboard |
| VID | 0x28E9 (10473) |
| PID | 0x30AF (12463) |
| LCD interface | usagePage 0xFF60, usage 0x61 (raw/VIA) |
| Report ID | 0 (unnumbered) |
| Report size | 64 bytes (512 bits) in & out |

4 HID interfaces total; only 0xFF60/0x61 drives the LCD. OS-level HID libs must prepend
a 0x00 report-ID byte (65-byte write = 1 + 64). WebHID strips the report ID.

## 3. ***DISPLAY SPECS (CONFIRMED)***
- **Resolution: 112 x 137 pixels, PORTRAIT.**
- **Color: RGB565 (16-bit), BIG-ENDIAN, 2 bytes per pixel.**
- **Layout: row-major, top-left origin.**
- Native pixel count = 112 * 137 = 15,344 px = 30,688 bytes.

### How resolution was derived (two independent methods, both agree)
1. Byte count: uploaded a known 135x240 test pattern; captured transfer = 30,688 bytes
   = 15,344 px. Only plausible portrait factor pair of 15,344 is 112 x 137.
2. Color-boundary rows: in the reassembled stream, red->green transition at row 46.3
   and green->blue at row 91.8 - matching the 1/3 (45.7) and 2/3 (91.3) marks of a
   137-row image. Confirms width=112, height=137.

### Color reference (RGB565 big-endian)
| Color | RGB565 | Bytes |
|-------|--------|-------|
| Red   | 0xF800 | F8 00 |
| Green | 0x07E0 | 07 E0 |
| Blue  | 0x001F | 00 1F |
| White | 0xFFFF | FF FF |
| Black | 0x0000 | 00 00 |

NOTE: the web app RESAMPLES any uploaded image down to native 112x137 before sending.
For pixel-perfect custom graphics, render your content directly at 112x137.

## 4. Screen-Control Command Set (from site JS bundle)
| Byte | Name | Meaning |
|------|------|---------|
| 0x40 | sendScreenControlInformationPackage | announce/header |
| 0x41 | sendScreenControlDataPacket | data payload (time OR image) |
| 0x42 | finishScreenControlDataPacket | finish/commit |
| 0x55 | getDongleAndKeyboardStatus | status (NAKs on LCD iface) |
| 0xB0-0xB7 | firmware upgrade / bootloader | DANGEROUS - do not touch |

ACK: device echoes each packet on input report with byte[6] set to 0x55.

### Command-sweep finding (read-only probe, v2)
The 0xFF60 LCD interface ONLY accepts 0x40/0x41/0x42 and NAKs everything else
(0x55 and 0xB0 both returned FF 00 00...). Status/version/config must live on a
different interface (likely 0xFF31). Do NOT probe 0xB1-0xB7 (brick risk).

## 5. Time Sync Protocol (CONFIRMED WORKING)
Announce (time): 40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1
Time data:       41 00 00 03 [CKSUM] 00 00 HH MM SS
                   CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF   (VERIFIED)
                   byte7=hour, byte8=min, byte9=sec
Date data:       41 00 00 04 6A 00 00 DD MM YY 01   (static; not fully decoded)
Finish:          42 00 00 38 7A
0x40 header fields: byte3=len, byte4=checksum-ish, byte7,8=A5 5A magic,
  byte9=sequence counter, byte11=next subcommand (0x03 time / 0x04 date),
  byte12,13=likely CRC16.

## 6. THE 12-HOUR CLOCK HACK (main clock result)
Firmware displays the RAW hour it's given. Send HH = (hour24 % 12) || 12 -> 12hr clock.
- 12:45 verified clean; noon/midnight both show 12.
- NO AM/PM indicator (byte[10]=1 did nothing). Keyboard free-runs its own clock ->
  re-sync every ~60s to prevent drift.
Dead ends: byte4 is a checksum not a flag; lone 0x41 w/o 0x40+0x42 does nothing.

## 7. Image / GIF Streaming Protocol (CONFIRMED format & structure)
Sequence: 0x40 announce -> many 0x41 data blocks -> 0x42 finish.
- Announce (image): 40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01   (byte11=0x01)
- Setup:            41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93     (byte10=0x78)
- Data block:       41 [offLo] [offHi] 38 [cksum] ... 56 bytes payload ...
    byte1,2 = LITTLE-ENDIAN destination offset (increments by 0x38=56 each block)
    byte3   = chunk length (0x38 = 56 data bytes; final block 0x10)
- Pixel bytes are RGB565 BE, row-major from top-left (see section 3).
- One full frame = 548 data blocks for 112x137.
GIF = same block-write, multiple frames (framing not yet fully decoded).

### View-switch commands (Equipment Setup buttons)
- Switch to homepage/clock: 40 00 00 07 53 01 00 A5 5A 0B 00 00 02 00 (byte12=0x02)
- Picture / GIF page: similar 0x40 headers, byte4/byte12 differ (0x36/0x59/0x67 seen).

## 8. Related VIA Keymap Work (same board, separate from LCD)
Done via Save-JSON -> edit -> Load-JSON (VIA "Any" key = KC_NO, so edit JSON directly):
- L0: F12=LT(1,KC_F12); Caps=LT(2,KC_CAPS); Del restored.
- L1 (hold F12) launcher: S=LGUI(3) T=LGUI(4) E=LGUI(5) C=LGUI(6), rest TRNS.
- L2 (hold Caps): S=MACRO(0) snip, N=KC_NUM, Q=LALT(F4) close window.
- Macro0 (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

## 9. Open Questions / Next Steps
1. 0x40 byte4 checksum exact formula (≈ payload sum, off by small constant).
2. 0x40 byte12,13 CRC16 polynomial/seed.
3. Image announce/setup header: exact width/height/length encoding (we have samples in
   the capture: announce byte3=0x08, setup byte10=0x78; correlate to derive the fields).
4. GIF frame framing / timing.
5. Full view-switch command map.

## 10. Future Modification Ideas
- Clock: countdown/pomodoro, 2nd timezone, run-fast clock.
- Smart sync: align to minute boundary; back off when idle/on battery.
- LIVE INFO PANEL (now fully feasible - format+res known): render 112x137 RGB565 frames
  of CPU/GPU temp+load, now-playing, unread mail, ticker, weather, next calendar event.
- View automation: auto-switch LCD to GIF on game launch / clock otherwise.
- Tooling QoL: config file (12/24hr, interval, tz, toast), log rotation, tray icon, service.

## 11. Safety / Do-Not-Touch
- 0xB0-0xB7 = bootloader/DFU. Never experiment - brick/wipe risk.
- Never reflash. Ripple firmware is the reason for the VIA-only + HID-script approach.
- Only one opener of the 0xFF60 interface at a time: close the browser tab before running scripts.

## 12. How to render a custom frame (recipe for the info-panel)
1. Draw your content on a 112x137 canvas.
2. Convert each pixel to RGB565 big-endian: v = ((R>>3)<<11)|((G>>2)<<5)|(B>>3); bytes = [v>>8, v&0xFF].
3. Concatenate row-major -> 30,688-byte buffer.
4. Send 0x40 image announce, then 0x41 blocks (56 bytes each, LE offset stepping by 0x38), then 0x42 finish.
5. Unknowns to nail first: the exact announce/setup header fields and checksum/CRC (section 9).
