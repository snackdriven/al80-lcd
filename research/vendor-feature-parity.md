---
title: YUNZII AL80 — Vendor App Feature-Parity + Payload Inventory
status: active
updated: 2026-07-02
source: static decode of research/site_assets/index-8Bj3uPPc.js (the yunzii-game.com / Lynnx web app)
compared against: al80-studio (src/protocol.js, src/ui.js, index.html)
confidence: source-decoded unless flagged "needs live capture"
---

# Vendor App Feature-Parity + Payload Inventory

Static decode of the vendor web bundle (`index-8Bj3uPPc.js`, 2.34 MB minified) against
AL80 Studio. No hardware used. Every claim is traceable to a byte offset in the bundle.

## 0. Scope note — the bundle is the whole Lynnx configurator, not just the LCD

The bundle is the full YUNZII/Lynnx keyboard app: keymap + macros, advanced keys (RT / DKS /
MT / SOCD / TGL / RS / Mod-Tap), per-key RGB lighting effects, a large music-visualization
engine (audio capture → spectrum → LED effects), firmware DFU, radio/backlight sleep timers,
and the **LCD screen** module. 822 unique English UI strings.

Only the **LCD screen module** speaks the `A5 5A` screen protocol that AL80 Studio implements.
Everything else (keyboard backlight brightness, wired/2.4G/BT sleep timers, LED effects, macros,
advanced keys, firmware) runs on the separate `GamingKeyboard2` opcode family (0x10–0x42 config
writes, per AL80_KNOWLEDGE_BASE §14a) — a different protocol that our tool does not target and
that is out of scope for an LCD tool. Those are listed in §6 for completeness but not decoded to
the byte.

**Bottom line up front:** the LCD command set is fully enumerated below and has **no** brightness,
backlight, rotation, theme-color, or sleep opcode. The one genuinely missing *LCD* feature is the
**"Set as startup animation"** GIF path (mode 0). The one correctness bug this audit surfaced is a
**dimension mismatch**: the current vendor app treats the AL80 picture/GIF page as **96×160**, but
our tool hardcodes 112×137.

---

## 1. Complete LCD HID command census

Regex `[165,90,type,flag,subcmd` over the bundle, plus reading every emitter. All emitters live in
two components: the Equipment-setup menu (`hDe`, offset ~1.828M) and the picture/GIF upload
components (~2.147M–2.189M). **These are the only `A5 5A` screen commands that exist.**

| type | hex | flag | subcmd | role | emitter |
|-----:|-----|-----:|-------:|------|---------|
| 9 | 0x09 | 0 | 3 | set time `[H,M,S]` | time handler `f`, sent 3× |
| 10 | 0x0A | 0 | 4 | set date `[YY,DOW,MM,DD]` | time handler `f`, sent 3× |
| 11 | 0x0B | 0 | 0 | view → homepage/clock | menu `i` |
| 12 | 0x0C | *lenHi* | *lenLo* | still-image **length descriptor** (0x41 data) | picture save `X` |
| 13 | 0x0D | 0 | 0 | view → picture page | menu `o` |
| 14 | 0x0E | 0 | 0 | clear picture (loop ×16 slots) | menu `d` / picture `ce` |
| 15 | 0x0F | 0 | 0 | view → GIF page | menu `c` |
| 16 | 0x10 | 0 | 1 | still-image announce | picture save `X` |
| 16 | 0x10 | 0 | 3 | GIF per-frame header (0x41 data) | GIF save `Pr` |
| 17 | 0x11 | *lenHi* | *lenLo* | GIF per-frame length descriptor (0x41 data) | GIF save `Pr` |
| 18 | 0x12 | 0 | 1 | clear-GIF step 1 | menu `u` |
| 18 | 0x12 | 0 | 2 | GIF start / GIF finish(frame-count) | GIF save `Pr` |
| 19 | 0x13 | 0 | 2 | GIF setup / GIF finish(FPS) / clear-GIF step 2 | GIF save `Pr` / menu `s` |

Announce CRC (bytes 12,13 = CRC16-MODBUS of `[type,flag,subcmd]`, big-endian), verified:
`09,0,3→C3E1 · 0A,0,4→0150 · 0B→0200 · 0D→03E0 · 0E→0310 · 0F→C341 · 10,0,1→C5B1 ·
0C,78,00→C393 · 10,0,3→0430 · 11,78,00→C503 · 12,0,2→0450 · 13,0,2→C401 · 12,0,1→0510`.

**No unmapped type exists.** Every `A5 5A` command maps to a known role. There is categorically no
LCD opcode for brightness, backlight, screen rotation/orientation, background/theme color, screen
sleep/timeout, or per-picture display duration.

---

## 2. Feature enumeration (user-facing LCD actions)

From the label objects (`{"zh-cn":…,en:…}`) and the wired click handlers.

### 2a. Screen module — real, HID-backed features

| # | English label (var) | zh-cn | Handler | HID |
|---|--------------------|-------|---------|-----|
| 1 | Update device time (`x5gim56`) | 更新设备时间 | `f` | type 9 + type 10, ×3 |
| 2 | Switch to the homepage (`ljrqz55`) | 切换到主页 | `i` | view type 11 |
| 3 | Switch to the picture page (`spr6y16`) | 切换到图片页 | `o` | view type 13 |
| 4 | Switch to the GIF page (`lswzza7`) | 切换到GIF页 | `c` | view type 15 |
| 5 | Clear the picture (`ei0h1k4`) | 清除图片 | `d`/`ce` | type 14 ×16 |
| 6 | Clear GIF (`myhpol5`) | 清除GIF | `u`+`s` | type 18/1 then 19/2 |
| 7 | Upload pictures → Save to the device (`v0lqki5`) | 保存到设备 | `X` | type 16/1 + len(0x0C) + pixels |
| 8 | Upload GIF → **Set as startup animation** (`e8js477`) | 设置为开机动画 | `Pr(0)` | GIF flow, **mode 0** |
| 9 | Upload GIF → **Save to the device** (GIF page) (`v0lqki5`) | 保存到设备 | `Pr(1)` | GIF flow, **mode 1** |
| 10 | Upload GIF → **Save GIF to main page** (`zek0dkb`) | 保存GIF到设备主页面 | `Pr(2)` | GIF flow, **mode 2** (AL80-only, gated `pid===12463`) |
| 11 | Frame rate setting (`aX`), Frames/sec (`cX`) | 帧率设置 / 帧/秒 | dialog `Z` | trailing byte of type-19 finish |

### 2b. Screen module — client-side only (bake into pixels, ZERO HID)

Confirmed both by KB §7 (toggling emits 0 packets) and by reading the picture component: these are
canvas filters applied before the pixel upload, not device commands.

- Position / fit: **居中 center** (`g4g82`, value "0") · **铺满 fill** (`py5j2`, value "1")
- **Brightness** (亮度 `dwhk2`), slider −1…1
- **Chroma / Colour** (色度 `mph02`), slider −1…1
- **Saturation** (饱和度 `mvzrf3`), slider −1…1
- **Grayscale** (灰度 `jn7a2`), toggle
- **Blur / Fuzzy** (模糊 `iqix2`), toggle
- **Sharpen** (锐化 `pt6u2`), toggle
- **Reset attributes** (重置属性 `ix53m24`)

### 2c. "Set the display duration" is a mislabel, not a feature

The label object `WV` has en `"Set the display duration"` but its zh-cn is `更新设备时间`
("update device time") and it points at the time handler. There is **no** picture-slideshow
duration command anywhere in the bundle. Do not chase it.

---

## 3. GIF modes decoded — the three save buttons

The GIF component (`Pr = async Ie => {…}`, offset ~2.1809M) takes a **mode** `Ie` from three
buttons and drives one shared transfer routine (`Ur`, ~2.1819M):

```
Ie===0 → frames capped at 64 ,  canvas = device dims (t×n)  → "Set as startup animation"
Ie===1 → frames capped at 160,  canvas = device dims (t×n)  → "Save to the device" (GIF page)
Ie===2 → frames capped at 42 ,  canvas = 96×64              → "Save GIF to main page" (AL80-only)
```

Device dims `t×n` come from a per-PID table `X1[newProductId]`:

```
X1 = {12463:{width:96,height:160}, 12545:{160,96}, 12724:{240,135}, 12689:{160,80}, ...}
        ^ 12463 = 0x30AF = AL80  → 96 × 160
```

The wire flow is identical for all three modes; only the trailing **mode byte** (`et`) and the
frame dimensions change. Per KB §14c and confirmed here:

```
start   (0x40): A5 5A 12 00 02  04 50  [mode] 00
setup   (0x41): A5 5A 13 00 02  C4 01  [mode] 00
per frame:
  header(0x41): A5 5A 10 00 03  04 30  02 [mode] [frameIdx]
  length(0x41): A5 5A 11 [lenHi lenLo] [crc]        ; len = w·h·2 BIG-ENDIAN
  pixels(0x41): RGB565-BE, sliced into 1024-byte logical chunks, then 56-byte reports,
                offset little-endian in bytes[1,2]; (every 16th frame: ~3 s flash-write pause)
FINISH  (0x41): A5 5A 12 00 02  04 50  [mode] [FRAME_COUNT]
FINISH  (0x41): A5 5A 13 00 02  C4 01  [mode] [FPS]
finish  (0x42): (empty)
```

FPS (`Z`) = the "Frame rate setting" slider, range **1–60**, default **30**, carried as the single
trailing byte of the type-19 finish. FRAME_COUNT (`Fe`) = trailing byte of the type-18 finish.

### Concrete example — "Set as startup animation", 10 frames @ 24 fps, 96×160

```
announce : A5 5A 12 00 02 04 50 00 00       (mode=0)
setup    : A5 5A 13 00 02 C4 01 00 00
per frame (×10): header A5 5A 10 00 03 04 30 02 00 <idx>
                 length A5 5A 11 78 00 C5 03        (len 0x7800 = 30720 = 96·160·2)
                 pixels …
finish#1 : A5 5A 12 00 02 04 50 00 0A       (frame count = 10)
finish#2 : A5 5A 13 00 02 C4 01 00 18       (fps = 24)
0x42
```

Change one byte (`00`→`01`, cap 160) for the GIF page; (`00`→`02`, dims 96×64, cap 42) for main page.

---

## 4. Still-image path + the 96×160 dimension correction (IMPORTANT)

Vendor still-image save handler `X` (~2.1476M):

```
announce : A5 5A 10 00 01 C5 B1 01               (type 0x10, subcmd 1, +extra 01)
length   : A5 5A 0C [lenHi lenLo] [crc]          ; len = w·h·2 BIG-ENDIAN
           for AL80 96×160 → 0x7800 → A5 5A 0C 78 00 C3 93
pixels   : RGB565-BE, 56-byte reports, LE offset in bytes[1,2]
finish   : 0x42
```

**The catch.** `len = width·height·2` with `width,height` from `X1[12463] = 96×160`, so
`len = 30720 = 0x7800`. That is exactly the `78 00` byte pair in the captured setup packet
`A5 5A 0C 78 00 C3 93`. AL80_KNOWLEDGE_BASE previously read `0x78` as "a fixed panel param = 120";
it is not — it is the **high byte of the 30720-byte frame length for a 96×160 panel**.

- 96×160×2 = **30720 = 0x7800** (crc of `[0C,78,00]` = C3 93) ✓ matches the capture verbatim
- 112×137×2 = 30688 = 0x77E0 (crc of `[0C,77,E0]` = BB 97) — would need `77 E0`, which the capture
  does **not** show

So the current vendor app uploads the AL80 picture/GIF page at **96×160**, and the setup packet in
our own capture agrees. Our tool (`protocol.js`) hardcodes the `0x78 0x00` length **and** then
streams 112×137 = 30688 bytes of pixels — a 32-byte under-run against its own declared length, and
the wrong aspect ratio. The main-page mode-2 path (96×64 = 12288 = 0x3000) is separate and correct.

> Reconciliation with KB §3 (112×137): the KB derived 112×137 from a byte-count of 30688 = 548×56
> with "no tail block." 30720 = 548×56 + 32, so a 32-byte tail block was most likely missed in that
> count. Both the source math (w·h·2 from X1) and the capture's own descriptor byte (`78 00`) point
> to **96×160**. Treat 112×137 as superseded for the picture/GIF page. **Flag: needs one live
> capture to confirm the tail-block handling on the current firmware**, but the dimension itself is
> source-solid.

---

## 5. Parity matrix

| Feature | Vendor command (type/subcmd + payload) | In AL80 Studio? | Notes |
|---------|----------------------------------------|-----------------|-------|
| Set time (12/24h) | type 9/3 `[H,M,S]`, ×3 | **Yes** | 12h hack = send `H%12||12`. Matches vendor `f`. |
| Set date | type 10/4 `[YY,DOW,MM,DD]`, ×3 | **Yes** | Order + ×3 repeat match. |
| Clock sync loop | (client-side re-send) | **Yes (better)** | We auto-resync every 60 s; vendor sends once per click. |
| View → clock/home | type 11/0 announce+finish | **Yes** | `buildView(HOMEPAGE)`. |
| View → picture page | type 13/0 | **Yes** | `buildView(PICTURE)`. |
| View → GIF page | type 15/0 | **Yes** | `buildView(GIF)`. |
| Clear picture | type 14/0 ×16 | **Yes** | `buildClearPicture()` loops 16. |
| Clear GIF | type 18/1 + 19/2 | **Yes** | `buildClearGif()`. |
| Still image → picture page | type 16/1 + len(0x0C, w·h·2 BE) + pixels | **Partial** | Built, but at **112×137** not the vendor's **96×160**; declared length (0x7800) ≠ data length (30688). See §4. |
| Still image → main page | (1-frame mode-2 GIF, 96×64) | **Yes** | `buildMainPageImage` = 1-frame mode-2. Matches vendor mode-2 dims. |
| GIF → main page (mode 2) | GIF flow, mode 2, 96×64, cap 42 | **Yes** | `buildMainPageGif`. Exact match incl. 42-frame cap. |
| GIF → GIF page (mode 1) | GIF flow, mode 1, 96×160, cap 160 | **No / mislabeled** | Our non-main GIF path (`buildGifTransfer`) sends **mode 0**, at 112×137, cap 60 — wrong mode, dims, and cap for the "GIF page." |
| **GIF → startup animation (mode 0)** | GIF flow, **mode 0**, 96×160, cap 64 | **No (as a feature)** | Not exposed. `buildGifTransfer` happens to emit mode 0 but is labeled "gif page" and uses 112×137/cap-60. No boot-animation UI. |
| Frame rate (FPS) | trailing byte of type-19 finish, 1–60, dflt 30 | **Yes** | We clamp 1–60, default 30. |
| Image adjust: brightness/saturation/grayscale/fit | client-side pixel filters, 0 HID | **Yes** | We also have contrast + dither. |
| Image adjust: chroma / blur / sharpen | client-side, 0 HID | **Partial** | We expose contrast+dither instead of chroma/blur/sharpen. Cosmetic; no HID gap. |
| VIA keymap / macro export | (VIA protocol, separate) | **Yes** | Our keymap tab; offline JSON. |
| Keyboard backlight brightness / off-timers | GamingKeyboard2 config write (not A5 5A) | **No** | Not an LCD feature; different protocol. §6. |
| Radio sleep timers (wired/2.4G/BT) | device-config blob offsets (not opcodes) | **No** | Not LCD. §6. |
| RGB lighting effects / music viz | GamingKeyboard2 setLightMessage etc. | **No** | Not LCD; large separate subsystem. §6. |
| Advanced keys (RT/DKS/MT/SOCD/…) | GamingKeyboard2 0x36–0x3B etc. | **No** | Not LCD. §6. |
| Firmware DFU | 0xB0–0xB7 | **No (by design)** | Deliberately never emitted (brick risk). |

---

## 6. Broader keyboard features present in the bundle (NOT LCD, out of scope)

Listed so the inventory is complete; these use the `GamingKeyboard2` opcode family, not `A5 5A`,
and are not decoded to the byte here (would need a separate capture pass):

- Keyboard **backlight**: Background light, Backlight lamp, Side light lamp, logo lamp; brightness.
- **Sleep / timeout**: Wired backlight off time, 2.4G backlight off time, 2.4G sleep time,
  Bluetooth sleep time, "Set the display duration" (30 min / 10 min / 5 min / 2 min / fixed).
- **Lighting effects**: dozens (Breath, Rainbow, Ripple, Neon, Flame, Vortex, Starry sky, …) +
  a full **music visualization** engine (audio capture, spectrum, BPM, waveform effects).
- **Macros** (record/play count/stop mode), **combination keys**.
- **Advanced keys**: RT (Rapid Trigger), DKS (Dynamic Keystroke), MT (Mod-Tap), TGL (Toggle),
  RS (Rapid Shift), SOCD (Snappy Tappy), Mutual exclusion, dead-zone/travel calibration.
- **Firmware**: check for updates, firmware list, DFU upgrade flow (0xB0–0xB7).
- **Color theme / Theme** selector — this is the *web app UI* theme, not a device command.

None of these touch the LCD. There is no LCD screen-brightness, screen-rotation, or screen-sleep
command in the whole bundle.

---

## 7. Gap list (what the vendor has for the LCD that we don't), ranked by user value

1. **Correct picture/GIF-page dimensions: 96×160, not 112×137.** `[HIGH]` `[source-solid; live-capture
   to confirm tail-block only]`
   Our `WIDTH/HEIGHT = 112/137` and the 30688-byte frame are wrong for the current app. Use
   **96×160 = 30720 bytes**; the length descriptor is `A5 5A 0C 78 00 C3 93` (which we already send —
   we just feed it the wrong pixels). Fix: render picture/GIF-page frames at 96×160 and stream the
   full 30720 bytes (548×56 + a 32-byte tail). Main-page (96×64) path is unaffected.

2. **"Set as startup animation" (boot GIF).** `[HIGH]` `[decoded-from-source]`
   A first-class vendor button we don't expose. Same GIF flow, **mode byte = 0**, frames at 96×160,
   cap **64**. Payload = §3 with `[mode]=00`; finish `A5 5A 12 00 02 04 50 00 <count>` +
   `A5 5A 13 00 02 C4 01 00 <fps>`. Lets a user set a custom power-on animation — high novelty value.

3. **Fix the "GIF page" mode.** `[MED]` `[decoded-from-source]`
   Our non-main GIF path emits mode 0 (startup) but calls itself the GIF page. The real GIF-page
   save is **mode 1**, cap **160**, at 96×160. Either relabel our current path as "startup animation"
   (see #2) and add a real mode-1 GIF-page button, or drop the 112×137 path entirely.

4. **Per-mode frame caps.** `[LOW]` `[decoded-from-source]`
   Enforce vendor caps: mode 0 → 64, mode 1 → 160, mode 2 → 42. We currently cap main at 42 (right)
   and non-main at 60 (wrong).

5. **Image adjustments: chroma / blur / sharpen.** `[LOW]` `[client-side, no HID]`
   Cosmetic parity only. Purely canvas filters; bake into pixels before upload. No protocol work.

Nothing in the LCD command set is undecoded. The only items needing a **live capture to confirm**
are (a) the 96×160 tail-block byte layout on the current firmware, and (b) whether the current
ripple firmware actually renders the picture/GIF-page views at all (KB already notes these "may not
display" — the main page is the reliable surface). Everything else here is solid from source.
