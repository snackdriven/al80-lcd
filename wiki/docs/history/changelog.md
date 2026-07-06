---
title: History / Changelog
status: reference
scope: The chronological session log, superseded theories, open questions, and future ideas
---

# History / Changelog

The reference pages carry the *current* ground truth. This page is the narrative: how the
understanding got there, which theories were retired, and what's still open. When a fact here
conflicts with a reference page, the reference page wins.

!!! tip "TL;DR"

    - Biggest unlock (2026-07-04): **`PK_ADD_PIC` (0x0C)** is how you actually *show* a written picture — now-playing is LIVE on-device.
    - Panel was **corrected to 96×160** (not 112×137); a dropped **32-byte tail block** had been malforming every image.
    - Retired theories: **column-major** rendering, the **per-scanline parity-slip** banding cause, and **WS2812** side-bar LEDs (it's aw20216s).

## 📦 2026-07-06 — Semver releases start (v1.0.0 → v1.2.0)

Versioning restarted from the messy v2–v21 dev builds into a clean semver line on al80-lcd
Releases. Each one is a flash-verified `release.sh` cut:

- **v1.0.0** — first stable. Keys + Vial + clean LCD images + battery + **18 RGB effects**. The known-good fallback.
- **v1.1.0** — **reactive lighting** (splash/reactive effects that light on keypress).
- **v1.2.0** — **independent side LED bar** (matrix LEDs 76–78, opcodes 0x46/47/48; own colour + brightness, separate from the keys). Current latest.
- **v1.3.0** *(coming)* — **per-layer rotary encoder** (done, on-device) + **instant caps/num-lock LCD icons** (a `led_update_kb` hook; landing once a lag regression is fixed).

## 🔋 2026-07-06 — Homepage widget protocol + boot handshake

From b75Pro source: the homepage gauges (connection, OS, lock states, **battery**) are fed by the
keyboard as 1-byte `PK_*` status packets, init'd as a **batch** on boot via a `screen_boot_step`
state machine. A lone `PK_BATT_QUANTITY` may have no widget to fill, which is why the gauge went
empty on custom after the first image push. Ported in `v16_homepage` (untested on-device). Detail:
[Homepage widgets](../firmware/homepage-widgets.md).

## ⚙️ 2026-07-05 — Custom-firmware image SHEAR = UART TX jitter, not geometry

Custom firmware rendered images sheared while stock rendered clean. Not a width/format/pacing
problem: the stock raw-HID handler forwards bytes **byte-identically** to the custom fw. Real
cause: `rgb_matrix` (aw20216s SPI flush) + Vial preempt the USART3 TX interrupt → gaps → the module
re-syncs mid-stream → diagonal on patterns, invisible on solids. Fix (confirmed): gate
`aw20216s_flush()` on a `g_screen_busy` flag **and** route the banked main-page transfer through
the per-bank-paced host path. Lesson: **disassemble RIPPLE.bin first** for "works on stock, fails
on custom." Detail: [Stock firmware & disassembly](../firmware/stock-and-disassembly.md).

## 📟 2026-07-04 — Picture DISPLAY protocol cracked + now-playing LIVE + full-system RE

The big unlock: **how to actually SHOW a written picture.** Every prior session could *write* a
still image (549/549 blocks ACKed) but the panel kept showing an OLD picture: a **display/commit**
problem, not a pixel problem. Key results:

- **`PK_ADD_PIC` (0x0C)** is the commit-and-display command; two settles (300 ms after announce,
  30 ms after setup) are mandatory; a trailing `0x0D` (`PK_TOGGLE_PIC`) **breaks** it by advancing
  past the frame. Detail: [Display commit](../protocol/display-commit.md).
- **now-playing is LIVE on-device** (Spotify card via `host/nowplaying-run.mjs`), the first live
  payload that proved the display sequence. Detail: [Now-playing](../how-to/now-playing.md).
- **Custom-QMK LCD is portable from source**: the enable is **C9 (driven high)**, not B7 (B7 is
  the aw20216s LED EN only). No logic analyzer needed. Detail: [Custom QMK](../firmware/custom-qmk.md).
- **VIA keymap editing works on stock** with the screen intact.

!!! warning "Two theories retired this day"
    (1) The panel is **row-major** — column-major (borrowed from the AttackShark sibling) rendered
    the image **sideways**. (2) The red/blue banding was **dropped bytes from unpaced blasting**
    (fix = ACK-gate each block), **not** a per-scanline parity slip and **not** a byte-swap. The
    side bar is **aw20216s, not WS2812**.

## 📟 2026-07-02 — Corrected & complete LCD protocol (live-capture + disassembly)

Byte-verified against live captures of the vendor app and a Thumb-2 disassembly of two official
bins. Where it conflicted with older notes, this session won:

- **Panel is 96×160, not 112×137.** The old figure came from a capture script that silently dropped
  a final **32-byte tail block**, losing the last 16 pixels, so every still image built was
  malformed. The firmware length field (`0x7800 = 30,720`) is authoritative.
- **Still image = 548 × 56-byte blocks + 1 × 32-byte tail.**
- **GIF format** = a MODE byte (0/1/2), per-frame `FRAME_INDEX` (drop it → renders white), banked
  1 KB windows, **mandatory send pacing** (30 ms/bank, 3 s every 16th frame).
- **Both checksums cracked:** the `yne` additive checksum (`bytes[4,5]`, one rule for every packet)
  and CRC16-MODBUS announces (`bytes[12,13]`). The old "seed 121 accumulator" model was debunked.
- **Date payload** = `[YY, dayOfWeek, month, day]`; **clear commands** decoded (picture = type 14
  ×16; GIF = type 18/19).

### 2026-07-02 overnight — the banding theory that was later retired

The overnight session proposed a "per-scanline 1-byte parity slip" as the banding root cause. This
was **disproven on-device 2026-07-04** (a byte-swap would band a solid color too; the fix never
rendered clean). Kept here as a record of the wrong turn. The loose ends it closed (GIF frame
count/rate, no clock-bg-color command, WebHID length quirk) remain correct.

## 📖 Open questions

Almost everything is source-confirmed. What genuinely remains:

- **Persistence**: does date/time survive a power cycle? (The re-sync loop makes this moot.)
- **Custom-QMK LCD**: final on-device confirmation of the C9-high enable path (flash-and-watch).
- **Side-bar LEDs**: exact CS/SW channels for the 3 bar LEDs.
- **Encoder direction**: CW/CCW index convention (index 0 = CCW in VIA vs CW in the app), unverified.

Everything else is decoded and confirmed across captures, the web JS bundle, and the desktop Qt
app: checksums, CRC, full command map, still-image + GIF byte-maps, view-switch, clear, time/date,
and DFU (documented to avoid).

## 🔧 Future modification ideas

- **Clock modes:** countdown/pomodoro timer, second timezone, "run fast" clock.
- **Smart sync:** align to the minute boundary; back off when idle / on battery.
- **Live info panel** (partly shipped, now-playing is live): CPU/GPU temp+load, unread mail,
  crypto/stock ticker, weather, next calendar event. Same render → `PK_ADD_PIC` path.
- **View automation:** auto-switch the LCD to a GIF on game launch / clock otherwise; tie into the
  VIA app-launcher layer.
- **Tooling QoL:** config file (12/24hr toggle, interval, tz offset, toast on/off), log rotation,
  tray icon, Windows service (NSSM) for lock-screen coverage.
- **RGB:** recolor preset effects (rainbow → 1–2 chosen colors) while keeping the LCD, the driver
  for the custom-QMK work.
