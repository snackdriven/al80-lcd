---
title: YUNZII AL80 LCD — Reverse-Engineering Knowledge Base
status: active
updated: 2026-07-02
device: YUNZII AL80 keyboard (VID 0x28E9, PID 0x30AF)
scope: HID protocol for the AL80 LCD panel — 12-hour clock hack, still-image and GIF streaming, VIA keymap
confirmed: FULLY DECODED — protocol re-derived from web JS + desktop Qt app (§14). One additive checksum (yne) all packets, CRC16-MODBUS announces, full command map, still-image + GIF upload byte-maps, GIF frame-count/FPS bytes, date payload, clear commands, DFU sequence. Display 96×160 RGB565 BE (corrected 2026-07-02; was mis-stated as 112×137).
---

# YUNZII AL80 LCD — Reverse-Engineering Knowledge Base

Self-contained reference so this project can be resumed cold by a human or another AI.
Consolidated from all sessions: the HID protocol reverse-engineered for the YUNZII AL80's
LCD panel, the 12-hour clock hack, the confirmed image pixel format (RGB565 big-endian) and
display resolution (**96×160** — corrected 2026-07-02, see the corrected-protocol section
below; older text says 112×137), the still-image and GIF packet structure, the tooling built,
the read-only command-sweep result, open questions, and future modification ideas.

> **HEADS UP (2026-07-02):** Several long-standing claims below are now proven WRONG by a live
> reverse-engineering session (live captures of the vendor app + capstone disassembly of two
> official firmwares). The panel is **96×160, not 112×137**; still images have a **32-byte tail
> block**; GIFs need **mandatory send pacing**. Read the corrected section immediately below
> first — it supersedes the older text, which is kept with inline correction markers.

---

## 2026-07-02 — Corrected & complete LCD protocol (live-capture + disassembly verified)

Every fact in this section is byte-verified against live captures of the vendor app and a
capstone Thumb-2 disassembly of two official firmware binaries. Where it conflicts with older
sections, **this section wins.** Older wrong claims are marked inline with `> CORRECTION (2026-07-02)`.

### C1. Panel is 96×160, NOT 112×137

The display is **96 wide × 160 tall = 15,360 px = 30,720 bytes** RGB565 big-endian.

The old "112×137 / 30,688 bytes / 548 blocks" figure was **wrong**. Our first capture-analysis
script filtered out a final **32-byte data block** (the one with `byte[3] = 0x20`), so the last
16 pixels were dropped and every still image we built was malformed and never rendered.

Correct still-image data = **548 × 56-byte blocks + 1 × 32-byte tail block**. The 548 blocks
cover offsets `0 … 30687`; the 32-byte tail sits at offset **30,688 (0x77E0)**; total frame
length = **30,720 (0x7800)**.

The type-0x0C length setup packet proves it:

    41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93

declares length **0x7800 = 30,720 = 96×160**. The value we used to call "the 0x78 fixed panel
param (120)" at byte[10] was a **misread** — it's the **high byte of the frame length** (0x78 <<
8 = 0x7800), with byte[11] = 0x00 the low byte.

### C2. Still image (picture page)

Flat, no banking. Sequence:

    announce  (0x40, type 0x10):  40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01
    length    (0x41, type 0x0C):  41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93     ; len 0x7800 = 30,720
    data      (0x41):             548 × 56-byte blocks + 1 × 32-byte tail (byte[3]=0x20)
                                  global little-endian offsets; tail at 0x77E0, total len 0x7800
    finish    (0x42):             42 00 00 38 7A

The upload **AUTO-SHOWS** as a full-screen, image-only view. There is **NO separate view-switch
command** — uploading the image is what switches the view. (This corrects the older idea that a
standalone type-0x0D "picture-view" switch is required.)

### C3. GIF / animation — one wire format, a MODE byte with three modes

    mode 0 = startup animation   96×160,  cap 64 frames
    mode 1 = GIF page            96×160,  cap 160 frames
    mode 2 = main page           96×64 = 12,288 bytes, cap 42 frames (AL80-specific, PID-gated in the app)

Structure (mode carried in the `extra` bytes throughout):

    announce  (0x40, type 0x12, extra [mode, 0])
    setup     (0x41, type 0x13, extra [mode, 0])
    per frame:
      header  (0x41, type 0x10, subcmd 3, extra [0x02, mode, FRAME_INDEX])
      length  (0x41, type 0x11, [lenHi, lenLo]  ; BIG-ENDIAN frame length)
      data    (banked — see C5)
    finish    (0x41, type 0x12, extra [mode, FRAME_COUNT])
    finish    (0x41, type 0x13, extra [mode, FPS])
    finish    (0x42)

### C4. Per-frame header = [0x02, mode, FRAME_INDEX]

The **frame index is the 10th payload byte** (the header length byte is `0x0A` = 10) and
increments 0, 1, 2, …

Dropping it (sending only `[0x02, mode]`) makes every frame index 0, so frames overwrite each
other and **the GIF renders WHITE**. This was a real bug we hit.

Byte-verified via the checksum: frame N's header checksum = base + N.
- mode-2 frame 0 header = `… 04 30 02 02 00`, checksum **0x95**
- mode-2 frame 1 header = `… 04 30 02 02 01`, checksum **0x96**

### C5. Banking — 1024-byte banks, offset resets per bank

Each frame's pixel data is streamed in **1024-byte BANKS**. Each bank = **18 blocks of 56 bytes
+ 1 block of 16 bytes** (18×56 + 16 = 1024).

The packet offset (`bytes[1,2]`, little-endian) **RESETS per bank**: 0, 0x38, 0x70, … 0x3B8,
then the 16-byte block at **0x3F0**. The device advances banks implicitly (it keeps its own
destination pointer and bumps it 1024 bytes each completed bank).

- mode 2 (12,288 B) = **12 banks/frame** (228 blocks)
- modes 0/1 (30,720 B) = **30 banks/frame** (570 blocks)

Control packets are byte-identical between our builder and the vendor's.

### C6. FPS and FRAME COUNT

- **FPS** = the trailing byte of the type-0x13 finish packet.
- **FRAME COUNT** = the trailing byte of the type-0x12 finish packet.

### C7. Send pacing is MANDATORY for GIFs (this was the killer bug)

The device needs time to commit each bank. Sent back-to-back, banks overwrite each other and
the GIF renders as **garbage BARS** — even the vendor's OWN exact captured bytes fail if you
blast them at full speed.

The vendor's `Ur` send routine (decoded from the web bundle) paces like this:

- **30 ms** after the initial setup.
- **Per frame:** send the header, then `sleep(frameIndex % 16 === 0 ? 3000 : 30)` — i.e. a
  **3-second pause** after frame 0 and every 16th frame, else 30 ms; then send the length; then
  send the frame data in 1024-byte banks with **30 ms after EACH bank**.
- **30 ms** after each finish setup.

**Still images need no pacing** (they're flat, no banks).

Confirmed on-device: with this pacing, a 3-frame GIF animates on the main page with the clock
intact.

### C8. Pixel format — RGB565 BIG-ENDIAN (confirmed)

    value = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3)
    emitted as [ value>>8, value & 0xFF ]

(Vendor source: `[pt>>8 & 255, pt & 255]`.)

### C9. Firmware (capstone Thumb-2 disassembly of two official bins)

- The user's **"ripple" firmware = YUNZII official v1.21** (USB bcdDevice **0x0121**), **66,780
  bytes**. Compared against **V0119** ("10-min sleep", bcdDevice **0x0119**), **58,956 bytes**.
  Ripple is the **NEWER** build, not a stripped one. VID **0x28E9** / PID **0x30AF**; HID
  descriptors identical.
- The LCD command dispatch is **BYTE-IDENTICAL** between the two firmwares (just relocated). The
  announce-type dispatch is a `cmp` ladder for **9/10/11** (time / date / homepage) plus a **TBB
  jump table** (ripple @flash **0x08005f2e**, V0119 @**0x08004852**) covering types **0..16**:
  types **9–15** route to a shared handler that writes the `0x55` ACK and calls a subroutine;
  **type 16** (image) has its own handler. The picture/GIF pages render via the upload-TYPE
  handlers, **not** via standalone 0x0D / 0x0F view-switch commands.
- **Sleep timeout** is a tunable little-endian **u32 milliseconds**: ripple = **240000 (4 min)**
  at flash **0x08005838**; V0119 = **600000 (10 min)** at **0x08004158**.

### C10. Clock background color — there is NO HID command for it

The clock homepage is **firmware-drawn with a fixed background**; the app only sets the time
value. Every "color / theme / background / dynamic color" option in the vendor app targets the
**RGB BACKLIGHT** (per-key lighting) — a different opcode family, out of scope for the LCD.

### Related research (2026-07-02 session)

- `research/vendor-feature-parity.md` — full vendor feature + payload inventory.
- `research/al80-feature-map.md` — manual → RGB / keymap modification map.
- `firmware/YUNZII_AL80_V0119_10MIN_SLEEP.bin` — the comparison firmware (bcdDevice 0x0119, 10-min sleep).

---

## Quick Reference (all key constants)

| Thing | Value |
|-------|-------|
| Device | YUNZII AL80 mechanical keyboard with color LCD |
| Vendor ID / Product ID | 0x28E9 / 0x30AF |
| LCD HID interface | usagePage 0xFF60, usage 0x61 (raw / VIA) |
| Report ID / report size | 0 (unnumbered) / 64 data bytes |
| Display resolution | **96 × 160 px, portrait** (corrected 2026-07-02; was mis-stated 112×137) |
| Pixel format | RGB565, **big-endian**, 2 bytes/px, row-major, top-left origin |
| Full frame size | **30,720 bytes** = 96×160×2 = 548 × 56-byte blocks **+ 1 × 32-byte tail** (byte[3]=0x20, at offset 0x77E0); total len 0x7800 |
| Screen-op sequence | 0x40 announce → 0x41 data → 0x42 finish |
| Announce type byte[9] | 0x09 = time, 0x10 = image, 0x12 = GIF |
| Announce CRC bytes[12,13] | CRC16-MODBUS of bytes[9..11], stored big-endian |
| Data-packet checksum bytes[4,5] | 16-bit LE = `(0x41+offLo+offHi+len+Σpayload) & 0xFFFF` |
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

The **same 0xFF60/0x61 interface also speaks the VIA protocol** (usevia.app uses it for all
keymap/lighting config). VIA commands live in the `0x01–0x15` byte range; the LCD screen
commands (`0x40/0x41/0x42`) sit above them, which is how one interface serves both — and why
only one process can hold it at a time. Full VIA command set + coexistence notes:
`research/via-protocol.md`.

---

## 3. Display Specs (CONFIRMED)

> **CORRECTION (2026-07-02):** the resolution below is WRONG. The panel is **96 × 160 = 15,360
> px = 30,720 bytes**, proven by the type-0x0C length setup (`… 5A 0C 78 00 …` = 0x7800 =
> 30,720) and disassembly. The old 112×137 / 30,688 figure came from a capture script that
> silently dropped a final 32-byte block, so we were 16 px short. See section C1 up top. The
> pixel format, endianness, and layout below are still correct.

- **Resolution: ~~112 × 137~~ → 96 × 160 pixels, PORTRAIT.**
- **Color: RGB565 (16-bit), BIG-ENDIAN, 2 bytes per pixel.**
- **Layout: row-major, top-left origin.**
- Native pixel count = 96 × 160 = 15,360 px = **30,720 bytes** per full frame.

### How resolution was derived (SUPERSEDED — kept for history)
> The two "independent methods" below both agreed on 112×137 and were both wrong: they were
> derived from the same truncated capture (missing the 32-byte tail). The authoritative source
> is now the firmware length field `0x7800` and disassembly (section C1). Do not trust the math
> below.

1. **Byte count:** uploaded a known 135×240 test pattern; captured transfer = 30,688 bytes
   = 15,344 px. The only plausible portrait factor pair of 15,344 is 112 × 137. *(Wrong: the
   capture was missing 32 bytes; true transfer = 30,720.)*
2. **Color-boundary rows:** in the reassembled stream, red→green transition at row 46.3
   and green→blue at row 91.8 — matching the 1/3 (45.7) and 2/3 (91.3) marks of a
   137-row image. Confirms width = 112, height = 137. *(Wrong, same truncated data.)*

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

NOTE: the web app **resamples** any uploaded image down to native **96×160** before sending.
For pixel-perfect custom graphics, render your content directly at **96×160**. (Older text said
112×137 — corrected 2026-07-02, see C1.)

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

    40 00 00 07 [c4 c5] 00 A5 5A [type] [param] [subcmd] [crc16:2]

- byte[0]       = 0x40
- byte[1,2]     = 0x00 0x00
- byte[3]       = **payload length marker** = `(lastIndex - 7)`. In the site's builder `Bn`
                  this is `(i-7)` where `i` defaults to 63 → **0x38 (56)** for a full data
                  packet; for the short announces it comes out to 0x07. So it's a length, not a
                  version constant. (Source: `Bn` in the site JS — see §5f.)
- byte[4,5]     = **additive checksum `yne`, little-endian** = `(sum of all packet bytes with
                  bytes[4,5] held at 0) & 0xFFFF`. **SOLVED from source** — this is NOT a
                  per-command constant. rev2.1's "constants" (homepage 339, picture 566, GIF
                  601, time 758) are simply `yne()` of each packet. Same function as the data
                  checksum (§5e); one rule for every packet.
- byte[6]       = 0x00 reserved
- byte[7,8]     = **0xA5 0x5A** magic constant (in every announce)
- byte[9]       = **type / channel** (see the command table in §7)
- byte[10]      = **param** (usually 0)
- byte[11]      = **subcmd**
- byte[12,13]   = **CRC16-MODBUS of bytes[9..11]**, stored **big-endian** (see §5e)

Time announce (byte[9] = 0x09):

    40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1   (rest zero-padded to 64)

> **Type-byte note — SETTLED by source (§5f).** The site JS `f` (time handler) sends the
> byte[9]=0x09 announce to set the **clock** (`type 9 = time`, `type 10 = date`). rev2.1's
> "type 9 is a generic data-write channel" claim is **wrong**. Confirmed mapping: **0x09=time,
> 0x0A=date, 0x0B=homepage-view, 0x0D=picture-view, 0x0F=GIF-view, 0x0E=clear-picture,
> 0x10=image-upload, 0x12=GIF-upload/clear, 0x13=GIF sub-op**. The CRC math (§5e) holds regardless.

### 5e. Checksums — both CRACKED (were the top open questions in v2)

**Announce CRC16 (bytes[12,13]) = CRC16-MODBUS.**
- Parameters: poly 0x8005, init 0xFFFF, refin = true, refout = true, xorout = 0x0000.
- Input: **bytes[9..11]** (the `[type][flags:2]` triple). Stored **big-endian** at bytes[12,13].
- Verified on three announces:
  - time  `[0x09,0,0x03]` → 0xC3E1 (bytes 195,225) ✓
  - image `[0x10,0,0x01]` → 0xC5B1 (bytes 197,177) ✓
  - GIF   `[0x12,0,0x02]` → 0x0450 (bytes 4,80)   ✓
- (Re-verified independently in this repo, not just taken from the delta.)

**Data-packet checksum (0x41, bytes[4,5]) — CRACKED and verified in-repo.**

    bytes[4,5] (16-bit LITTLE-ENDIAN) = ( 0x41 + offLo + offHi + len + Σpayload ) & 0xFFFF

i.e. a **16-bit additive checksum over the whole 64-byte packet, excluding the checksum
field itself** (bytes[4,5]) and the zero pad. Verified against every image data block in
the archived captures: **1096/1096 still + 3192/3192 GIF = 4288/4288 exact matches**
(`research/analyze_captures.py`).

> **Correction — supersedes the "seed 121 / += 56 accumulator" claim in both delta docs.**
> That model is wrong. It only *looks* like a running counter on a zero/constant payload:
> for offset 0, len 0x38 the header sum is `0x41 + 0 + 0 + 0x38 = 121`, so an all-zero
> payload gives 121, 177 (next offset adds nothing but the changed offset bytes)… On real
> pixel data the value is content-dependent (e.g. block 0 of the test pattern = 0x19B7, not
> 121). The correct rule is the additive checksum above.

This rule is **unified across every packet — confirmed from the site source (§5f).** The
builder computes bytes[4,5] with `yne()` for *all* opcodes, announce and data alike:

    yne(o) = ( Σ o[i] ) & 0xFFFF, stored little-endian at o[4],o[5]   (o[4],o[5] = 0 while summing)

So the announce bytes[4,5] we long treated as a "per-command constant" is the same checksum:
homepage `[40,0,0,07,0,0,0,A5,5A,0B,0,0,02,00]` sums to **339 = 0x0153** → bytes `53 01`,
matching the captured announce. rev2.1's constants (339/566/601/758) were just `yne()` values.
And the CRC16 poly `0x8005`/`0xA001` is confirmed: the source `ga()` is
`n=0xFFFF; for b: n^=b; ×8{ n&1 ? (n>>=1, n^=0xA001) : n>>=1 }; return [n>>8, n&255]`.

### 5f. Source confirmation (reverse-engineered from the site JS bundle)

The whole protocol above was re-derived from `research/site_assets/index-8Bj3uPPc.js` (the
yunzii-game.com screen app), which confirmed the packet math and closed the last checksum
question. Key functions (deobfuscated):

**Packet builder** — one function builds every packet:

    Bn = (t, n, r=["00","00"], i=63) => {
      let o = [t, ...r, (i-7).toString(16), "00","00","00", ...n];  // opcode, off, len, pad, payload
      const c = yne(o);                                            // additive checksum
      o[4] = c[0]; o[5] = c[1];                                    // stored little-endian
      return o;
    }

**Checksum** `yne` — additive, little-endian (bytes[4,5]): `sum(all bytes as ints) & 0xFFFF`.

**CRC16** `ga` — CRC16-MODBUS (init 0xFFFF, poly 0xA001, big-endian) over `[type,flag,subcmd]`,
placed at bytes[12,13] of announces.

**Command map** — a literal `{sendScreenControlInformationPackage:"0x40", …DataPacket:"0x41",
finish…:"0x42", getDongleAndKeyboardStatus:"0x55", getFirmwareVersion:"0xB0", toBootLoader:"0xB1",
getBootLoaderStatus:"0xB2", confirmFirmwareInfo:"0xB3", startUpgrade:"0xB4", transferUpgradeData:"0xB5",
upgradeComplete:"0xB6", endUpgrade:"0xB7", …}` — dispatched by `Dr(cmd,…)→Bn`. This is the
authoritative source for the `0xB1–0xB7` DFU names in §13.

**View / command handlers** (the Equipment-setup menu `h[]`, Chinese labels → handler → type):

| Menu label | Handler | Sends |
|-----------|---------|-------|
| 切换到主页 Switch to homepage | `i` | announce type **11** |
| 切换到图片页 Switch to picture page | `o` | announce type **13** |
| 切换到GIF页 Switch to GIF page | `c` | announce type **15** |
| 更新设备时间 Update device time | `f` | see §5b/§5c |
| 清除图片 Clear picture | `d` | announce type **14**, sent **16×** (the 16 image slots) |
| 清除GIF Clear GIF | `u` | announce type **18** subcmd 1 → type **19** subcmd 2 |

**Time/date handler `f`** (source):

    D=[165,90,9,0,3,195,225]   // time announce: A5 5A, type 9, 0, subcmd 3, crc C3E1
    T=[165,90,10,0,4,1,80]     // date announce: A5 5A, type 10, 0, subcmd 4, crc 0150
    P=[hour,minute,second]                    // time data payload
    M=[YY, dayOfWeek(1-7), month, dayOfMonth] // date data payload
    for(3×): announce(D)→data(P)→finish, announce(T)→data(M)→finish

So the whole "update time" is **repeated 3×**, and the date payload order is `[year, weekday,
month, day]` — see §5c.

### 5b. Time data packet (0x41, subcommand 0x03)
    41 00 00 03 [CKSUM] 00 00 HH MM SS   (rest zero-padded to 64)

- byte[3] = 0x03 (subcommand: set time)
- byte[4] = **CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF** (VERIFIED) — this is just the low
  byte of the unified 16-bit data-packet checksum in §5e (byte[5]=0 for small values).
- byte[7] = HH (hour)
- byte[8] = MM (minute)
- byte[9] = SS (second)

### 5c. Date data packet (0x41, subcommand 0x04) — DECODED from source

    41 00 00 04 [CKSUM] 00 00 [YY] [DOW] [MM] [DD]

Payload order is **`[year(2-digit), dayOfWeek(1–7), month, dayOfMonth]`** (from the site's `f`
handler, §5f: `M=[YY, day()||7, month()+1, date()]`). The old sample `1a 03 07 01` decodes as
**year 0x1A=26 (2026), weekday 3, month 7 (July), day 1** — i.e. 2026-07-01, matching when it
was captured. Earlier we'd guessed `[DD][MM][YY]`; that was wrong. byte[4]=the §5e checksum.
Sent together with the time packet, 3× (§5f).

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
    Setup:            41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93       (type 0x0C; 0x7800=30,720 length)
    Data block:       41 [off:2 LE] 38 [accum:2 LE] 00 <56-byte payload>

> **CORRECTION (2026-07-02):** byte[10]=0x78 in the Setup packet is **NOT a panel param** — it's
> the **high byte of the frame length** (`0x78 00` = 0x7800 = 30,720 = 96×160). See C1.

- byte[1,2]   = **LITTLE-ENDIAN destination byte-offset** into the frame buffer; steps by
                56 each block (0, 56, 112, 168, 224, 280 …).
- byte[3]     = payload length. **CORRECTION (2026-07-02):** a still image is **548 × 0x38 (56)
                blocks + 1 × 0x20 (32) tail block** = 30,688 + 32 = **30,720** bytes (96×160). The
                old "every block is 56, no tail" claim was WRONG — our capture script dropped the
                final 32-byte block, losing the last 16 pixels (see C1). (A separate 0x10 = 16-byte
                block length appears in GIF bank tails; see the GIF section below.)
- byte[4,5]   = **16-bit LE additive checksum** = `(0x41+offLo+offHi+len+Σpayload) & 0xFFFF`
                (see §5e — verified 4288/4288 blocks; NOT the old "seed 121" accumulator).
- byte[6]     = 0x00 reserved.
- byte[7..62] = 56 bytes of payload = raw **RGB565 big-endian** pixels, row-major from
                top-left (see §3, Display Specs).
- One full frame = **548 × 56-byte blocks + 1 × 32-byte tail** for **96×160** (30,720 bytes).
                (Old text said 548 blocks for 112×137 — corrected 2026-07-02, see C1.)

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
a complete still frame ends with the 32-byte tail block at offset **0x77E0 (30,688)**, i.e.
**548 × 56-byte blocks + 1 × 32-byte tail = 30,720 bytes** for a **96×160** frame, then a 0x42
finish.
> **CORRECTION (2026-07-02):** the earlier reading of this same capture stopped at the last
> 56-byte block (offset 0x77A8 = 30,632) and called it "548 blocks, 112×137, 30,632/30,688
> bytes." That was the bug — the analysis script filtered out the final `byte[3]=0x20` (32-byte)
> block at 0x77E0, dropping the last 16 pixels. Correct total length is 30,720 (0x7800). See C1.

Interpretation: **0x41 is a generic block-write** — the LCD is effectively a dumb
framebuffer we can push arbitrary pixels to.

### GIF / animation protocol (CONFIRMED structure)

> **CORRECTION (2026-07-02):** the authoritative GIF spec is now sections **C3–C7** up top. Key
> fixes to the text below: (1) frames are **96×160 = 30,720 bytes** (or **96×64 = 12,288** in
> mode 2), not 112×137/30,688; (2) there's a **MODE byte** (0/1/2) threaded through every
> packet; (3) the per-frame header carries a **FRAME_INDEX** (10th byte) that increments — drop
> it and the GIF renders WHITE; (4) **send pacing is mandatory** (30 ms/bank, 3 s every 16th
> frame) or the GIF renders as garbage bars. The banking description below is correct.

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

**GIF frame addressing — RESOLVED (decoded offline from the raw capture).** GIF frames *are*
full-panel RGB565 frames (**96×160 = 30,720 bytes**, or 96×64 = 12,288 in mode 2 — corrected
2026-07-02, was 112×137/30,688), but they are **not** streamed in the still image's single
continuous flat offset space. Instead the pixel data is sent in **banked 1 KB windows**:
byte[1,2] offset runs `0x0000 → 0x03F0` (19 blocks) then **resets to 0** for the next bank.
Analysis of `research/gif_capture/testgif_capture_raw.json`:

- 3 frames, delimited by the setup pair (six of each = 3 frames × 2 setup roles). See C3 for the
  authoritative packet types (0x13/0x10/0x11 with the MODE byte); the `0x0A/0x07` naming here is
  the older capture's subcmd view.
- Per frame: **30 banks/frame** for 96×160 (or 12 for mode 2) → one full frame. (Measured runs
  per frame in this capture: 31, 30, 25; the spread is duplicate sends + partial trailing banks.)
- 86 data runs total, each capped at offset 0x03F0 — this is why a naive max-offset read
  showed 0x03F0 and looked like it contradicted a full-frame byte count. It doesn't: the device
  advances the bank base implicitly (see C5), it's not carried in byte[1,2].

So the still image uses one flat offset space (ending with the 32-byte tail at 0x77E0, total
0x7800); the GIF uses banked 1 KB windows
with the same 56-byte block form inside each bank. Each **1 KB bank = 18 × 56 + one 16-byte
(0x10) tail block** (1008 + 16 = 1024) — this is the only place the 0x10 block length appears
(the still image has none). Measured: the GIF capture's blocks are 3,024 × 56-byte + 168 ×
16-byte = 84 banks × 2 sends.

**Bank addressing is IMPLICIT — decoded offline (resolves the old bank-base question).** There
is **no per-bank address field** anywhere in the packets. Proof: the test GIF's first frame is
a solid color, and consecutive banks are **byte-for-byte identical** (same `0→0x3F0` offsets,
same payload, same checksums). If a bank index lived in any byte, bank 0 and bank 1 would
differ; they don't. So the device keeps its own destination pointer and **advances it by 1024
bytes each time byte[1,2] completes a 0→0x3F0 cycle** (i.e. each finished bank). byte[1,2] is
therefore an **intra-bank offset only**, not a frame offset.

Frame boundaries carry the setup packets; banks between them do not:

    per frame:  ANNOUNCE(type 0x12) → SETUP 0x09 → SETUP 0x0A → SETUP 0x07 → [bank]×N
    per bank:   19 data blocks (18 × 56 + 1 × 16), offset 0x0000 … 0x03F0, then straight into
                the next bank's 0x0000 with NOTHING in between

The `0x0A`/`0x07` setup pair resets the pointer for a new frame. So to forge a GIF you replay
the frame-boundary setups and stream banks sequentially — the addressing takes care of itself.
(Aside: on a zero/black payload the checksum is `0x41+offLo+offHi+0x38` = 121, 177, 233… — this
is the entire origin of the debunked "seed 121 accumulator"; see §5e.)

Gotcha for analysis: a capture may contain a stray time-sync (`0x41 sub3 "06 17 09"`)
from the auto-sync loop firing mid-transfer — ignore those.

### View-switch / command table (captured live from the Equipment-setup buttons)

Each is an announce + 0x42 finish with **zero data packets**. Values below are from the
rev2.1 session (not re-derivable from this repo's captures, which didn't press these buttons):

| Command | type byte[9] | subcmd byte[11] | announce bytes[4,5] |
|---------|-------------|-----------------|---------------------|
| Switch to homepage (clock) | 11 | 0 | 83, 1 |
| Switch to picture page     | 13 | 0 | 54, 2 |
| Switch to GIF page         | 15 | 0 | 89, 2 |
| Update device time (txn 1) | 9  | 3 | 246, 2 → data payload `[0x12,0x2F]` |
| Update device time (txn 2) | 10 | 4 | — → data payload `[26,3,7,1]` (packed date/time) |

The announce CRC16-MODBUS (§5e) was generalized and **verified on 5 distinct commands**
(homepage 0x0200, picture 0x03E0, GIF 0xC341, time-A 0xC3E1, time-B 0x0150).

**Clear commands — DECODED from source (§5f), never need capturing:**
- **Clear picture** = announce **type 14** + finish, sent **16 times** (once per image slot).
- **Clear GIF** = announce **type 18 subcmd 1** + finish, then **type 19 subcmd 2** + finish.

> **type-9 caveat / discrepancy to resolve.** rev2.1 says type 9 / subcmd 3 is a **generic
> data-write channel**, reused for the time txn AND (it claims) the image/GIF pixel transfer,
> and that `[4,5]=246,2` is *not* an image frame-size. But **this repo's still capture shows
> the image transfer using announce type 0x10** (`…5A 10 00 01 C5 B1 01`, [4,5]=207,2), and
> the GIF using type 0x12 — not type 9. Both can't be literally true, so they're likely from
> different capture sessions / app states. Measured-here mapping: **0x09=time, 0x10=image,
> 0x12=GIF**. rev2.1's "generic channel" framing is recorded but unverified against this repo's data.

> **Cross-reference (community, independent confirmation).** @nvoostrom's VIA definition
> (`keymap/community/AL80_QMK_V0104-FIX-20250424.json`, from the ArgentStonecutter/keyboards
> repo) exposes these three view switches as **named custom keycodes**: `HOM` (homepage/clock),
> `IMG` (image), `GIF`. Yunzii's own definitions ship only `KC_USB`, so this independently
> confirms homepage/image/GIF are first-class firmware view commands — matching the three
> captured switch types (11/13/15) above. The same definition names sibling functions we
> haven't sniffed (backlight `BLT`, brightness `B+`/`B-`, connectivity, reset, OS switch). See
> `keymap/community/README.md`.

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

### Throughput / refresh rate (measured on-device, 2026-07-01)

A full 550-packet frame is **HID-write-bound, not device-bound** — and on Windows the killer is
`setTimeout` resolution, not the USB link:

| Inter-packet gap | Full frame | fps |
|------------------|-----------|-----|
| 5 / 2 / 1 ms | ~8.5 s | 0.12 |
| **0 ms** | **~0.55 s** | **~1.8** |

Any nonzero sleep costs ~15.6 ms (Windows timer floor), so 550 sleeps ≈ 8.5 s. Send frames with
**no inter-packet sleep** (or `setImmediate` / a sub-ms busy-wait) for ~2 fps full frames; ~1 ms
per packet is the real throughput. A small partial region (e.g. a clock's seconds ≈ 10–40 blocks)
would be ~10–40 ms at gap=0 — *if* partial updates are honored (see `converter/experiments/`,
outcome still pending an eyes-on check). Raw captures + logs: `converter/experiments/RESULTS.md`.

---

## 9. Related Keymap Work (VIA, same keyboard, separate from LCD)

Current keymap: `keymap/al80_keymap.json` (4 layers, macros, encoders — the live layout).
The `keymap/AL80_QMK__V0106_20251219.json` alongside it is the VIA keyboard *definition*, not
the bindings. Done in usevia.app via a Save-JSON → edit → Load-JSON workflow (VIA's blank
"Any" key assigns KC_NO, not a custom keycode, so direct JSON editing was used):

- Layer 0: F12 = LT(1,KC_F12); Caps Lock = LT(2,KC_CAPS); Del restored to KC_DEL.
- Layer 1 (hold F12) app launcher: S=LGUI(3) T=LGUI(4) E=LGUI(5) C=LGUI(6), rest TRNS.
- Layer 2 (hold Caps): S=MACRO(0) snipping tool, N=KC_NUM, Q=LALT(F4) close window.
- Macro 0 (snip): Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI).

Export note: VIA's own **Save** button always works. Programmatic JS export is
intermittent — `window.__editedJSON` holds the keymap string when the site allows JS exec
(it was blocked one session, available the next), so don't rely on it.

---

## 10. Open Questions / Next Steps

_After reading the site JS bundle (§5f), almost everything is now source-confirmed. Both
checksums, the full command map, the date payload, the clear commands, and view-switching are
all solved. What genuinely remains:_

1. ~~Announce bytes[4,5]~~ — **SOLVED (§5e/§5f):** it's the `yne` additive checksum, same rule
   as data packets. Never a per-command constant. (And byte[3] is a length marker, not a
   version constant.)
2. ~~Date payload / time bit-mapping~~ — **SOLVED (§5c):** date = `[YY, dayOfWeek, month, day]`,
   time = `[H, M, S]`, both sent 3×.
3. ~~Clear commands~~ — **SOLVED (§5f/§7):** clear-picture = type 14 ×16; clear-GIF = type 18/19.
4. ~~GIF bank-base encoding~~ — **RESOLVED (§7):** implicit/sequential (1024 bytes per completed
   0→0x3F0 cycle), proven by byte-identical consecutive banks.
5. ~~GIF frame-count + frame-rate encoding~~ — **SOLVED from source (§14c):** frame count = the
   trailing byte of the type-18 GIF finish packet; FPS = the trailing byte of the type-19 finish
   packet (slider 1–60, default 30). Both single bytes, sent at end of transfer.
6. **Persistence** — does date/time survive power cycle? (The re-sync loop makes this moot.) The
   one item left, and it barely matters.

**Net: the protocol is fully decoded** — checksums, CRC, full command map, still-image + GIF
upload byte-maps, view-switch, clear, time/date, DFU (documented to avoid). Confirmed across
captures, the web JS bundle, and the desktop Qt app.

---

## 11. Future Modification Ideas

- **Clock modes:** countdown/pomodoro timer, second timezone, "run fast" clock.
- **Smart sync:** align to minute boundary; back off when idle / on battery.
- **LIVE INFO PANEL** (now fully feasible — format + resolution known): render **96×160**
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

1. Draw your content on a **96×160** canvas. Apply any brightness/grayscale/etc. here. (Corrected
   2026-07-02 from 112×137, see C1.)
2. Convert each pixel to **RGB565 big-endian**:
   `v = ((R>>3)<<11) | ((G>>2)<<5) | (B>>3);  bytes = [v>>8, v & 0xFF]`
3. Concatenate row-major → **30,720-byte** buffer (548 × 56-byte blocks + 1 × 32-byte tail).
4. **Announce (0x40):** `40 00 00 08 CF 02 00 A5 5A 10 00 01 C5 B1 01` — type[9]=0x10 (image);
   the CRC bytes[12,13]=`C5 B1` are CRC16-MODBUS over `[0x10,0x00,0x01]`. (Reuse the captured
   still-image announce until the size field byte[3,4,5] is decoded — §10, item 1.)
5. **Data blocks (0x41):** **548 blocks of 56 bytes + 1 final 32-byte tail block** (548 × 56 +
   32 = 30,720; the tail has byte[3] = 0x20 — corrected 2026-07-02, do NOT drop it, see C1):
   - offset = running byte offset, little-endian in bytes[1,2] (0, 56, 112, … 30,688)
   - byte[3] = 0x38 (56) for the 548 blocks; **0x20 (32) for the final tail block**
   - byte[6] = 0x00, then the payload bytes (56, or 32 for the tail)
   - checksum (bytes[4,5], 16-bit LE) = `(0x41 + offLo + offHi + len + Σpayload) & 0xFFFF`
     — compute it **after** laying down the payload (see §5e)
6. **Finish (0x42):** `42 00 00 38 7A` (rest zero-padded).
7. Remember `pad()`: OS-level HID libs prepend a 0x00 report-ID byte, then zero-fill to 64.

**Length is now decoded (2026-07-02):** send the type-0x0C setup packet
`41 00 00 07 21 03 00 A5 5A 0C 78 00 C3 93` after the announce — byte[10,11] = `78 00` = 0x7800
= 30,720 = 96×160 (see C1/C2). No longer a mystery field.

---

## 13. Safety / Do-Not-Touch

- **0xB0–0xB7** are bootloader / firmware-upgrade (DFU) commands. Do NOT experiment
  with these — risk of bricking or wiping the ripple firmware. Stick to 0x40/0x41/0x42.
- **Never reflash.** The ripple lighting firmware is the whole reason for the VIA-only
  and HID-script approach.
- **Only one opener** of the 0xFF60 interface at a time: close the browser tab before
  running scripts.

**The exact DFU sequence to avoid** (decoded from source — this is what a firmware update
does, so never send it): `0xB1 toBootLoader` → poll `0xB2 getBootLoaderStatus` (every 200ms,
≤20 tries) → `0xB3 confirmFirmwareInfo` with a **56-byte header** (bytes[6..9]=file size LE,
bytes[10..13]=CRC32 LE) → `0xB4 startUpgrade` → `0xB5 transferUpgradeData` (chunked) →
`0xB6 upgradeComplete` → `0xB7 endUpgrade`. A second, colliding `mechanicalKeyboard*` DFU set
(opcodes 0x00–0x04/0x10/0x20/0x55) exists for a different device family — irrelevant to the AL80,
just don't confuse the two.

---

## 14. Full Protocol Reference (decoded from source)

Cross-checked against two independent front-ends: the **web app** JS bundle
(`research/site_assets/index-8Bj3uPPc.js`) and the **desktop app** (`apps/AL80_LCD_SCREEN…exe`,
a Qt5 native app `MK856.exe` whose export/RTTI symbols name every routine — `HidWriteLCDHead/
Data/EndInfo` = 0x40/0x41/0x42, `WriteDeviceLCDPicture/Gif/GifHead/GifEnd/GIFFrameRate/Time/Date`,
`OnSendScreenSwitchInfoToDevice`, `OnSendScreenDelAllPicInfoToDevice`; pixels are `uint16_t*`
RGB565; GIF frames decoded with FFmpeg). Both are front-ends over the identical HID protocol.

### 14a. Command map (the AL80 uses the `GamingKeyboard2` opcode profile)

`0x10 beginConnect · 0x11 endConnect · 0x12/0x13 get/setDeviceMessage · 0x14/0x15 get/setData ·
0x16 getKeyboard · 0x17/0x18 get/setKeyMessage · 0x19/0x1A get/setLightMessage · 0x1B/0x1C
get/setMacro("hong") · 0x1D/0x1E tbLight on/off · 0x1F getPoorNum · 0x20 restKeyBoard(factory
reset) · 0x21 getLightRect · 0x30/0x31 get/setProfile · 0x32–0x35 Fn message · 0x36–0x3B
magnetic-axis (analog-key) config · 0x40 announce · 0x41 data · 0x42 finish · 0x55
getDongleAndKeyboardStatus · 0xB0–0xB7 firmware/DFU (see §13)`.

`getDongleAndKeyboardStatus (0x55)` decodes **only a sleep bit** (`hasSleep = !response[7]`) —
despite the name there's **no battery %** in this protocol. Per-radio backlight/sleep timers
(wired/2.4G/BT) live in the device-config blob at byte offsets 23/15,17/19,21, not as opcodes.

### 14b. Still-image upload (type 0x10) — full byte-map

    announce (0x40):  A5 5A 10 00 01 [crcHi crcLo] 01
    length   (0x41):  A5 5A 0C [lenHi lenLo] [crc]        ; len = width·height·2, BIG-ENDIAN
    pixels   (0x41):  RGB565 big-endian bytes, auto-chunked (see 14d)
    finish   (0x42):  (empty)

RGB565 is packed `((R>>3)<<11)|((G>>2)<<5)|(B>>3)` off a canvas resized to the panel size with
`imageSmoothingEnabled=false`, then split high-byte-first (`v>>8`, `v&255`).

### 14c. GIF upload (types 0x12/0x13) — frame-count + FPS SOLVED

    start  (0x40):  A5 5A 12 00 02 [crc] [mode] 00        ; mode 0/1/2
    start  (0x41):  A5 5A 13 00 02 [crc] [mode] 00
    per frame:
      header (0x41): A5 5A 10 00 03 [crc] 02 [mode] [frameIdx]
      length (0x41): A5 5A 11 [lenHi lenLo] [crc]         ; per-frame len, BIG-ENDIAN
      pixels (0x41): RGB565 BE, 1024-byte logical chunks then physical chunking (14d)
      (every 16th frame: ~3s pause for the device's flash write)
    FINISH (0x41):  A5 5A 12 00 02 [crc] [mode] [FRAME_COUNT]   ; ← count in the trailing byte
    FINISH (0x41):  A5 5A 13 00 02 [crc] [mode] [FPS]           ; ← FPS in the trailing byte
    finish (0x42):  (empty)

- **FRAME COUNT** = trailing byte of the type-18 finish packet (`Fe`, capped 64/160/42 by mode).
- **FPS** = trailing byte of the type-19 finish packet (`Z`, the "帧率设置 / Frame rate setting"
  slider, range **1–60**, default **30**). Both are single bytes, sent at the *end* of the transfer.

> **Variant note.** This web component emits GIF control subcmds **0x02/0x03**, whereas this
> repo's own GIF *capture* showed setup subcmds **0x09/0x0A/0x07** and the banked 1 KB windows
> (§7). The bundle has several product code paths; the captured device/firmware may take a
> different one. Our capture is ground truth for *this* keyboard; the source byte-maps above are
> the app's general implementation. Reconcile with a fresh capture if forging GIFs.

### 14d. Chunking (both still + GIF)

Every logical byte array is split into **`(reportLen − 7)`-byte** payloads (56 at reportLen=63).
Each 0x41 report carries its **absolute byte offset** little-endian in `bytes[1,2]`; the final
chunk's length byte = `len − offset + 7`. GIF frames are additionally pre-sliced into 1024-byte
logical blocks before that. Length *descriptors* (the 0x0C/0x11 packets) store their value
**big-endian**; the per-report *offset* is **little-endian**. bytes[4,5] is always the `yne`
additive checksum (§5e).
