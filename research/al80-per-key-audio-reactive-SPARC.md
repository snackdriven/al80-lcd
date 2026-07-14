# SPARC — Per-Key Audio-Reactive RGB on the YUNZII AL80

**Date:** 2026-07-10 · **Status:** SPARC (not built). Firmware side **grounded in the real source** (`~/qmkwork/vial-qmk/keyboards/yunzii/al80/` — `al80.c`, `config.h`, `rules.mk`, `keyboard.json`, `rgb_matrix_kb.inc` — + `AL80_KNOWLEDGE_BASE.md`). Host side grounded in `src/protocol.js`, `src/hid.js`, `src/ui.js`, `host/device.js`. **⚠ CORRECTION** marks where source contradicted the earlier summarized facts; **⚠ VERIFY** marks the (few) remaining on-device checks.

**Feature:** a live spectrum/VU visualizer painted across the keys, reacting to whatever audio is playing on the PC, streamed save-less from the browser (WebHID), headless node path as the alternative. Companion to the global-color feature (`al80-music-reactive-lighting-brainstorm.md`).

## Two headline corrections from the real source
1. **The per-key LED "walk" is probably NOT a blocker.** The electrical scramble is already resolved inside the driver: `g_aw20216s_leds[]` exists in source (`al80.c:286-310`, recovered from RIPPLE.bin @ 0x080116A0), so `rgb_matrix_set_color(logical_index,…)` already maps to the right physical LED. The compiled SPLASH/SOLID_REACTIVE effects (which radiate by physical distance via `g_led_config.point`) "work" on-device → both the electrical table and physical coordinates are already correct. So the host just sends **logical rgb-matrix order** (the `keyboard.json` layout, already in-repo); no wire-side remap, no mandatory walk. One cheap gating check confirms it (R.1).
2. **The flash budget is unresolved and may be much larger than feared.** `config.h:4` says **STM32F103xB (128 KB)**, not the x8/64 KB in the summarized facts. Must be resolved from the linker script + last `.map` (R.4). The handler is only ~200-400 B regardless.

---

## S — Specification

### S.1 Goal
Opt-in "Music (per-key)" mode: capture system audio in-browser, FFT/RMS it, map band energy to a per-key color/brightness field across the 82-LED aw20216s matrix, stream it save-less at ~30-60 fps. Tasteful by default, never auto-fire.

### S.2 Functional
- **FR1** Capture PC audio with a user gesture (`getDisplayMedia({audio, systemAudio:'include'})` primary; loopback `getUserMedia` secondary). Chromium-desktop only.
- **FR2** Analyse via `AudioContext` → `AnalyserNode` (`getByteFrequencyData` bands, `getByteTimeDomainData` RMS). Never connect the analyser to `destination`.
- **FR3** Map analysis → 82-entry RGB field, indexed by **rgb-matrix LED index** (`keyboard.json rgb_matrix.layout` order), using each LED's physical `(x,y)`.
- **FR4** Stream save-less over a **new raw-HID opcode**, ≤6 reports/frame, RAM-only, applied in `rgb_matrix_indicators_advanced_kb`.
- **FR5** Firmware falls back to the prior effect after an **idle timeout** when frames stop.
- **FR6** Two visualizers: **Pulse** (gentle bass-driven board-wide brightness — default) and **Spectrum bars** (per-column graphic-EQ — opt-in "intense").
- **FR7** Stop on: Stop, tab hidden, disconnect, audio track end.
- **FR8** Detect stock-vs-custom firmware; disable per-key with a clear message on stock.

### S.3 Non-functional
- **NFR1 Safety:** opt-in only, no auto-start; brightness cap (~60% default); flash-rate guard clamping per-frame delta even in "intense"; gentle default. (Standing rule: never fire startling live effects, confirm at-desk first.)
- **NFR2 EEPROM:** zero writes on the audio path. Only allowed persistent write = the one-time base-effect pin (mirrors `startFx` at `ui.js:2435`).
- **NFR3 Flash:** handler must fit the budget (R.4). No new RGB effect.
- **NFR4 Latency:** < ~50 ms (one analyser frame + one HID frame).

### S.4 Scope / non-goals
In: streaming opcode + handler; browser audio pipeline; `protocol.js` builders; "Music (per-key)" tab reusing the FX-loop; headless `host/device.js` hook.
Out: Spotify beat/analysis API (dead since Nov 2024). Global-color reactivity on stock (`buildLightSet(LIGHT.COLOR,…)` = one global hue; separate weaker feature, mention as fallback only). Any EEPROM-persisted "audio profile."

### S.5 Constraints (from source)
- `RAW_EPSIZE 64` (`config.h:42`) → 64-byte reports on `0xFF60/0x61` (shared with LCD + VIA + palette + bar).
- VIA command IDs top out at `0x13`; `0xFE/0xFF` reserved. Customs used: `0x40-0x42` (LCD), `0x43-0x45` (palette), `0x46-0x48` (side bar). **Free: `0x14-0x3F`, `0x49-0xFD`.**
- `raw_hid_receive_kb(uint8_t *data, uint8_t length)` gets the **live report pointer**; via.c calls `raw_hid_send(data,length)` on return → every report is echoed in place (`al80.c:348`, comment `:426`).
- All RGB (keys + bar) is one aw20216s chain on SPI1; `aw20216s_flush()` gated by `g_screen_busy` during LCD transfers (`al80.c:18-22, 366, 371`).

---

## P — Pseudocode

```
[system audio] --getDisplayMedia({video:true,audio:true,systemAudio:'include'})--> MediaStream  // gesture+picker
  -> AudioContext.createMediaStreamSource -> AnalyserNode (fftSize 512, smoothing 0.7)
  rAF loop (~60fps):
    getByteFrequencyData(freq[256]); getByteTimeDomainData(wave[512])
    mapAudioToField(freq,wave,mode,opts) -> rgb[82*3]     // Pulse: rms->val,bassHue; Spectrum: 15 log cols
      apply brightnessCap, flashGuard(prev,next)
    buildLiveFrame(rgb) -> 5 reports [0x49,off,count,r,g,b×count]
    hid.send(reports,{gap:0})                              // save-less, ignore echo
  firmware raw_hid_receive_kb 0x49: memcpy into g_live_rgb[off*3..]; g_live_active=1; g_live_last=now
  rgb_matrix_indicators_advanced_kb: if active, for i in [min,max): rgb_matrix_set_color(i, cap(g_live_rgb[i]))
  matrix_scan_kb: if active && elapsed(g_live_last) > IDLE_MS: active=0   // prior effect resumes
  aw20216s_flush() over SPI1 (skipped while g_screen_busy)
```

---

## A — Architecture

### A.1 Wire protocol — new opcode `0x49 AP_LIVE_LEDS` (next free after bar `0x48`)
**Report (64 B):** `[0x49, offset, count, R,G,B×count(≤20), spare]`. count max = (64-3)/3 = 20. 82 LEDs → **5 reports** (offsets 0/20/40/60/80, counts 20/20/20/20/2).
**Apply = live partial write, no double-buffer.** Each report memcpys its slice into `g_live_rgb[]`; the indicators hook repaints the whole buffer every render, so a torn frame (chunks from N and N-1) is ≤1 render (~16 ms), invisible. Cheaper in flash/RAM than double-buffer+present; matches existing save-less single-report streaming (`ui.js:2407`).
**Activation/timeout:** any 0x49 sets active + refreshes timestamp. No explicit start. Stream stops → `matrix_scan_kb` clears active after `IDLE_MS`.
**Optional `0x4A AP_LIVE_CTRL`** (polish): `[0x4A, sub, arg]` — sub0 stop-now, sub1 set-cap, sub2 set-timeout. MVP skips it.

**Encoding trade study (why RGB 3B/led):** RGB 3B (5 reports, memcpy-only, smallest code) ✅ chosen — throughput isn't the bottleneck (R.3) and flash is. HSV 2B (3 reports) ❌ loses per-key brightness (which IS the VU signal) + needs hsv_to_rgb×82. RGB565 2B ❌ needs unpack for invisible gain. Palette-indexed 1B ⚠ good v2 throughput optimization (needs LUT + upload opcode), overkill for MVP.

### A.2 Firmware model (grounded in `al80.c`)
```c
static uint8_t  g_live_rgb[RGB_MATRIX_LED_COUNT*3];  // 82*3 = 246 B
static volatile bool     g_live_active = false;
static volatile uint32_t g_live_last   = 0;
#ifndef AL80_LIVE_IDLE_MS
#  define AL80_LIVE_IDLE_MS 500
#endif
#ifndef AL80_LIVE_MAX_VAL
#  define AL80_LIVE_MAX_VAL 160          // ~63% cap (NFR1); host also caps
#endif

// Handler case — mirrors the 0x47 side-bar SET verbatim (al80.c:410-417):
case AP_LIVE_LEDS: {                      // 0x49: [op, offset, count, r,g,b×count]  RAM only
    uint8_t off=data[1], cnt=data[2];
    if ((uint16_t)off+cnt <= RGB_MATRIX_LED_COUNT) {
        memcpy(&g_live_rgb[off*3], &data[3], (uint16_t)cnt*3);
        g_live_active=true; g_live_last=timer_read32();
        data[6]=0x55;                     // ACK in place (echoed by via.c raw_hid_send)
    } else data[6]=0x0F;                  // out of range
    break;
}

// Injection point — CONFIRMED: this is exactly where the side bar already overrides per-key (al80.c:268-279):
bool rgb_matrix_indicators_advanced_kb(uint8_t led_min, uint8_t led_max) {
    if (g_live_active) {
        for (uint8_t i=led_min; i<led_max && i<RGB_MATRIX_LED_COUNT; i++) {
            uint8_t r=g_live_rgb[i*3], g=g_live_rgb[i*3+1], b=g_live_rgb[i*3+2];
            if (AL80_LIVE_MAX_VAL<255){ r=(uint16_t)r*AL80_LIVE_MAX_VAL>>8; g=(uint16_t)g*AL80_LIVE_MAX_VAL>>8; b=(uint16_t)b*AL80_LIVE_MAX_VAL>>8; }
            rgb_matrix_set_color(i, r,g,b);
        }
        // when live is active it also owns bar 76-78; guard the loop to skip 76..78 if the bar should stay put
    }
    if (bar_independent && !g_live_active) { /* existing 76..78 override */ }
    return rgb_matrix_indicators_advanced_user(led_min, led_max);
}

// Idle fallback — extend matrix_scan_kb (al80.c:430-433), already runs the screen-busy watchdog:
void matrix_scan_kb(void) {
    if (screen_busy_wd && --screen_busy_wd==0) g_screen_busy=false;
    if (g_live_active && timer_elapsed32(g_live_last) > AL80_LIVE_IDLE_MS) g_live_active=false; // prior effect resumes
    matrix_scan_user();
}
```
`config.h`: `#define AP_LIVE_LEDS 0x49` (+ `AP_LIVE_CTRL 0x4A` polish). Because we only *override* in the indicators hook and never touch `rgb_matrix_config`, clearing `g_live_active` instantly restores the user's effect — no re-selection, no EEPROM.

**⚠ g_screen_busy (CONFIRMED, document it):** `aw20216s_flush()` is skipped while `g_screen_busy` (LCD transfer in flight, `al80.c:366`). During an album-art push the matrix freezes on its last values for the transfer (hundreds of ms) then resumes; the `screen_busy_wd` watchdog prevents a permanent freeze. Audio-reactive + heavy LCD streaming compete on the same SPI/CPU — expect a brief stall per LCD image commit. Guidance: don't run per-key audio + continuous LCD GIF/image at full tilt, or accept the stutter.

### A.3 Host / browser
**New `src/protocol.js` builders** (pure, node-testable, follow `kbReport` at `protocol.js:474`): `buildLiveLeds(offset, leds)` → one `[0x49,offset,count,r,g,b…]` chunk (count 1..20, clamp8); `buildLiveFrame(rgb246)` → chunk into ≤5 reports; `buildLiveStop()` → `[0x4A,0]`. Add `RGB_MATRIX_LED_COUNT=82`, `LED_BAR_RANGE=[76,78]`.

**"Music (per-key)" effect reuses the FX-loop machinery** (`ui.js:2398-2450`): the software-FX loop already streams save-less at animation rate, guards with a generation token + running flag, and stops on tab-away (`ui.js:445`), view/tab change (`:467`), and disconnect. Per-key audio = same machine, different frame source, `requestAnimationFrame` clock:
```js
async function startMusicPerKey(mode){
  stopFx();
  if (!connected) return err('Connect first.');
  if (!perKeyAvailable) return err('Per-key music needs the custom firmware.');
  mediaStream = await navigator.mediaDevices.getDisplayMedia({video:true,audio:true,systemAudio:'include'}); // gesture
  if (!mediaStream.getAudioTracks().length){ stopMusic(); return err('No system audio — tick "Share system audio".'); }
  mediaStream.getAudioTracks()[0].addEventListener('ended', stopMusic);
  audioCtx=new AudioContext(); const src=audioCtx.createMediaStreamSource(mediaStream);
  analyser=audioCtx.createAnalyser(); analyser.fftSize=512; analyser.smoothingTimeConstant=0.7;
  src.connect(analyser);                                // NOT to destination
  const freq=new Uint8Array(analyser.frequencyBinCount), wave=new Uint8Array(analyser.fftSize);
  const cap=+brightnessCapSlider.value; let prev=new Uint8Array(RGB_MATRIX_LED_COUNT*3);
  const token=++audioToken;
  const tick=async()=>{
    if (token!==audioToken) return;
    analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave);
    const rgb=mapAudioToField(freq,wave,mode,{cap,prev,intense:intenseToggle.checked}); prev=rgb;
    try { await hid.send(buildLiveFrame(rgb),{gap:0}); } catch(e){ stopMusic(); return err('Send failed: '+e.message); }
    if (token===audioToken) rafId=requestAnimationFrame(tick);
  };
  tick();
}
function stopMusic(){ audioToken++; if(rafId)cancelAnimationFrame(rafId); mediaStream?.getTracks().forEach(t=>t.stop()); audioCtx?.close(); audioCtx=analyser=mediaStream=null; }
lightingFxCtl.stop = () => { stopFx(); stopMusic(); };
```
**`mapAudioToField`** (host does the visual math; firmware stays dumb). Uses `LED_XY` baked from `keyboard.json rgb_matrix.layout` (index→x,y; precompute column bucket on x∈[0..224] + row rank on y∈{0,13,26,39,52,64}). **Pulse (default):** board-wide HSV, bass→hue, RMS→value. **Spectrum bars:** 15 log-spaced columns from freq; energy climbs rows bottom→top (graphic EQ); hue = column (bass red → treble blue). Both end with `flashGuard(prev,out,maxDelta)` clamping per-channel change/frame (anti-strobe). Bar LEDs 76-78 excluded or their own column.

### A.4 Headless node (`host/device.js`)
`setLiveLeds(rgb246)` → `this._send(buildLiveFrame(rgb))` (no gate, save-less — unlike `setRGB`'s set+save VIA pairs). `stopLive()` → `_send([buildLiveStop()])`. Node audio needs an OS loopback (Stereo Mix/VB-Cable via WASAPI/portaudio) + FFT; same mapping ported. Later phase.

### A.5 Firmware detection (stock vs custom)
No capability query for 0x49. Reuse the existing `0x46` bar-GET as a probe: send `buildBarGet()`, expect a well-formed `[0x46,h,s,v,indep]` reply (handler `al80.c:403-409`). Stock has no 0x46 handler → no such reply → per-key disabled + message "Per-key music needs the custom AL80 firmware; stock only supports one global color." `0x49` on stock hits via.c's default case and no-ops (harmless).

---

## R — Refinement

### R.1 ⚠ CORRECTION — the LED order is (probably) already correct; the walk is contingent, not a blocker
- `rgb_matrix_set_color(index,…)` takes the **logical** rgb-matrix index (0..81). The aw20216s driver maps logical→electrical through **`g_aw20216s_leds[]`, which already exists in source** (`al80.c:286-310`, "recovered from RIPPLE.bin @ flash 0x080116A0"). The electrical scramble is resolved inside the driver; callers never see electrical order.
- `g_led_config.point[i].{x,y}` = physical position of logical index i, from `keyboard.json rgb_matrix.layout` (`:54-137`). PALETTE_CYCLE already reads `.point[i].x` for a spatial wave (`rgb_matrix_kb.inc:54`).
- Compiled `RGB_MATRIX_KEYREACTIVE_ENABLED` + SPLASH/SOLID_REACTIVE (`config.h:110-122`), which radiate by physical distance, are stated to "work" → both the electrical table and physical coords are already correct.

**Conclusion:** if directional/reactive effects render cleanly, **no per-key walk is required** — host sends logical order using the in-repo `keyboard.json` layout, firmware's `g_aw20216s_leds` does the electrical mapping.
**⚠ VERIFY (one cheap gate):** flash v13/v14, run `ENABLE_RGB_MATRIX_CYCLE_LEFT_RIGHT` (compiled, `config.h:90`), watch one sweep. Clean left→right ⇒ ship the host layout table, done (likely). Shears/diagonal ⇒ then do the walk (temp mode lighting one `rgb_matrix_set_color(i)` at a time, i=0..81, photograph which physical key lights, correct the `g_aw20216s_leds` initializer). NB the KB's image-shear note (§357-371) is about the **USART3 LCD passthrough**, a different subsystem — don't conflate with RGB order.

### R.2 Torn frames
Partial write means chunks from two frames coexist ≤1 render (~16 ms at 60 fps) — undetectable for VU motion. No double-buffer. Add `0x4A present` gating only if a future dense effect tears.

### R.3 Throughput / commit-rate
- HID: 5 reports/frame × 60 = 300 out/s (< ~1000/s ceiling); via.c echoes 300 in/s, host ignores. Fine.
- **⚠ Real ceiling = rgb_matrix flush cadence, not HID.** SPI1 = APB2 72 MHz ÷4 = 18 MHz; an aw full flush is tens of µs — negligible. Cap = QMK's rgb_matrix task rate (`RGB_MATRIX_LED_FLUSH_LIMIT`/hz). **⚠ VERIFY** the configured refresh hz; if < 60, the board samples the latest `g_live_rgb` at its own rate (newest wins) — 60 fps host frames are harmless. Recommend host rAF-paced but rate-limited to ~45-60 fps, drop rather than queue.

### R.4 ⚠ Flash/RAM budget (must resolve the MCU-part question)
- RAM: 246 + flags + ts ≈ **252 B** vs 20 KB. Non-issue.
- Flash: one switch case (memcpy + ts) + a for-loop w/ optional scale + one `if` ≈ **~200-400 B**. No new effect, no LUT.
- **⚠ VERIFY — MCU part discrepancy:** `config.h:4` header = **STM32F103xB (128 KB)**; the summarized facts said **x8 (64 KB, ~2.5 KB free)**; `keyboard.json:5,7` = `STM32F103`/`STM32_F103_STM32DUINO`. Read the **linker script** (`__flash0_size__` / MEMORY region) + the last build's `.map`/size before trusting any budget. `config.h:106-109` records reactive effects were only afforded by disabling TAP_DANCE/COMBO/KEY_OVERRIDE — so flash is tight regardless; the ~200-400 B handler fits either way but 64 KB leaves little margin.
- Flash-saving levers if needed: drop framebuffer effects `DIGITAL_RAIN`/`PIXEL_RAIN` (`config.h:103-104`) and some `SOLID_REACTIVE_*` variants (`:111-118`) — the visualizer supersedes most.

### R.5 Failure modes
Silence → RMS≈0 → dark field, frames keep flowing (stays in music mode dark); optional host silence-detect → `buildLiveStop()`. Tab hidden → `lightingFxCtl.stop()` (`ui.js:445`) → `stopMusic` → firmware idle timeout restores prior effect. Unplug → send throws → `stopMusic`; on replug the auto-reconnect (`hid.js:104-119`) restores the link, user restarts (audio needs a fresh gesture). LCD collision → `g_screen_busy` skips flush, lights hold then resume, watchdog bounds it. Idle timeout → prior effect resumes, zero EEPROM. Stock fw → 0x46 probe fails → per-key disabled + fallback message; 0x49 no-ops. Out-of-range chunk → `data[6]=0x0F`, buffer untouched.

### R.6 Safety (NFR1)
Opt-in dedicated control, never auto/on-connect. Gesture-gated (getDisplayMedia picker). Brightness cap host slider (~60%) **and** firmware `AL80_LIVE_MAX_VAL` (defense in depth). `flashGuard` clamps per-channel change/frame in both modes so even "intense" can't strobe. Default mode = **Pulse** (gentle breathing), not the bar spectrum. First run: one-time "this makes the keyboard light up to your audio — start?" confirm.

---

## C — Completion

### C.1 Phased plan
- **Phase 0 — resolve blockers (cheap, gating):** ⚠VERIFY R.1 (CYCLE_LEFT_RIGHT sweeps clean?), bake the `keyboard.json` layout table (index→x,y, col/row buckets) into the host, resolve R.4's MCU-part/flash from the linker script + `.map`.
- **Phase 1 — firmware MVP:** add 0x49 handler + `g_live_rgb` + indicators paint + `matrix_scan_kb` timeout + `config.h` opcode. Build, confirm size, flash.
- **Phase 2 — host builders + static test:** `buildLiveLeds`/`buildLiveFrame` + unit tests; a "send test pattern" button (single lit key walking 0→81; solid columns; rainbow ramp) — no audio. Verify logical index → expected physical key.
- **Phase 3 — audio MVP (Pulse):** getDisplayMedia + AnalyserNode + Pulse mapping + cap + flashGuard, wired into the FX-loop stop machinery. Gentle default.
- **Phase 4 — Spectrum bars + intense:** column/row mapping, graphic-EQ, intense toggle (flash-guarded), stock-fw detection message.
- **Phase 5 — polish:** 0x4A control opcode, headless `host/device.js setLiveLeds` + loopback capture, onset/beat pulse, palette-indexed 1B if throughput ever needs it.

### C.2 Test plan
**Host unit (mirror `protocol.js` tests, `toHex` at `:543`):** `buildLiveLeds` byte layout + clamp8 + rejects count 0/>20; `buildLiveFrame(246)` → 5 reports, offsets 0/20/40/60/80, counts 20/20/20/20/2, every LED covered once, each ≤64 B; `mapAudioToField` deterministic on a canned fixture (silence→dark; single-band spike → only that column; cap + flashGuard respected); layout table 82 entries in range, 76-78 flagged.
**On-device (SAFE, static before audio — hard rule):** (1) clock/small-write sanity to confirm the wire. (2) walking single LED 0→81 → correct physical key each step (validates R.1). (3) solid columns + rainbow ramp → orientation correct, no shear. (4) idle timeout: stop mid-pattern → prior effect resumes within IDLE_MS. (5) LCD collision: push album-art while streaming → lights hold then resume, no crash. (6) cap: max-white never exceeds configured brightness. (7) only then enable audio, start in Pulse.
**Regression:** typing latency, encoder, Caps/Num icons, battery gauge, PALETTE_CYCLE, side bar — all unaffected (addition only writes `g_live_rgb` + reads it in the indicators hook).

### C.3 Done-criteria
Per-key field streams save-less at ~45-60 fps with zero EEPROM writes; static test pixel-correct (mapping validated); Pulse + Spectrum work, flash-guarded, capped; stops on Stop/hide/disconnect/track-end + firmware idle fallback; stock fw disabled with message, 0x49 harmless; firmware size measured + within budget; no regressions.

### C.4 Open questions / must-verify
1. **⚠ MCU part + flash headroom** — F103xB (128 KB) per config.h vs x8 (64 KB) per summarized facts; resolve from linker script + `.map` (R.4).
2. **⚠ LED order** — does CYCLE_LEFT_RIGHT sweep clean on v13/v14? If yes, no walk; if no, walk + fix `g_aw20216s_leds` (R.1).
3. **⚠ rgb_matrix refresh hz** — sets the true frame ceiling; confirm newest-wins sampling is OK (R.3).
4. **Bar ownership during music** — live owns 76-78, or the independent bar stays put? One `if` in the indicators hook; recommend live owns the whole board.
5. **Silence handling** — hold dark vs auto-fallback after N s (R.5).
6. **via.c echo cost** — every 0x49 triggers `raw_hid_send` (`al80.c:426`); within budget; 0x4A could suppress if IN traffic ever matters.

**Grounding for the implementer:** the streaming machinery already exists and is proven — copy `ui.js:startFx/stopFx/sendFrame` (2398-2450) for the loop, `protocol.js:kbReport` (474) for the builder, and the `0x47` side-bar SET + `rgb_matrix_indicators_advanced_kb` pair (`al80.c:410-417, 268-279`) verbatim as the firmware template. `0x49` slots after the custom range `0x43-0x48`; the firmware change is deliberately tiny (a buffer, a paint loop, a timeout) because flash is the binding constraint. The big de-risk vs the first draft: the per-key remap is almost certainly already done in `g_aw20216s_leds`, so this is mostly a host-side + tiny-firmware feature, not a hardware-reverse-engineering project.
