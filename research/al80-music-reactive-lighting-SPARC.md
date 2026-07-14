# SPARC — GLOBAL-Color Music-Reactive Lighting on the YUNZII AL80

**Date:** 2026-07-10 · **Status:** SPARC (design only). Host side grounded in `src/protocol.js`, `src/ui.js`, `src/hid.js`, `host/device.js`, `host/nowplaying-run.mjs`, `host/lib/art.js`. Firmware side grounded in the real `qmkwork/vial-qmk/quantum/vialrgb.c`, `quantum/via.c`, `keyboards/yunzii/al80/config.h`, + `AL80_KNOWLEDGE_BASE.md`. Companion to `al80-per-key-audio-reactive-SPARC.md` (that one owns the audio-capture + safety detail + the per-key firmware opcode; THIS one owns the **one-color, no-firmware, stock-and-custom** story). Supersedes `al80-music-reactive-lighting-brainstorm.md`. **⚠ VERIFY** marks the few on-device checks.

## Headline: the whole feature is "existing FX loop + audio color source + which-save-less-command." No firmware change.

Three facts settle the design:
1. **The per-frame path is already zero-EEPROM on BOTH firmwares.** The brief's fear ("streaming brightness on stock is an EEPROM problem because `buildLightBrightness` is a set+save PAIR") is a false alarm. The EEPROM write lives ONLY in al80-studio's convenience wrapper `buildLightBrightness = (v) => [buildLightSet(...), buildLightSave()]` (`protocol.js:414`). The bare primitive `buildLightSet(LIGHT.BRIGHTNESS,[v])` is a single save-less report; stock firmware routes it through `*_noeeprom` (`via.c:637`, id 1 → `rgb_matrix_sethsv_noeeprom`). Only `id_custom_save` (`09 03`) touches eeconfig. **So stock CAN do full hue + brightness reactivity save-less** — just never send `09 03`.
2. **Custom is even cleaner:** `buildVialRGBColorLive(hue,sat,val)` (`protocol.js:459`) → `vialrgb_set_mode` → `rgb_matrix_mode/speed/sethsv_noeeprom` (`vialrgb.c:66,168`), hue+sat+val in one 64-byte report.
3. **The two firmwares need DIFFERENT wire commands, and the app must detect which.** On custom, VialRGB replaced the VIA rgb-matrix channel so stock `07 03 …` no-ops (`ui.js:2316-2319`). On stock, VialRGB's `07 41 …` doesn't exist. Today the FX loop streams `buildVialRGBColorLive` unconditionally (custom-only). The firmware-detect + command-pick is the one genuinely new bit of logic.

---

## S — Specification

### S.1 Goal
Opt-in **"Music" software effect** in the Lighting tab: capture PC audio in-browser, reduce it to **one HSV per frame** (bands→hue, RMS→brightness, onset→beat pop), stream save-less to the whole board at rAF rate. Works on **stock and custom firmware** (standard save-less primitives only — no new opcode, no reflash). Gentle by default, never auto-fires.

### S.2 Functional
- **FR1** Capture behind a user gesture: `getDisplayMedia({video:true,audio:true,systemAudio:'include'})` (primary); loopback `getUserMedia` (secondary). Chromium-desktop only. (Reuse per-key FR1.)
- **FR2** `AudioContext → AnalyserNode`, fftSize 256-512, smoothing 0.7; `getByteFrequencyData` (bands) + `getByteTimeDomainData` (RMS). Never connect analyser → destination.
- **FR3** Reduce each frame to **one global HSV** (not an 82-LED field): hue from band ratios, value from amplitude, optional onset pop. Slew-limit + brightness-cap.
- **FR4** Detect stock vs custom + stream the matching save-less command: custom → `buildVialRGBColorLive(h,s,v)` (1 report); stock → `buildLightColorLive(h,s)` + save-less `buildLightSet(LIGHT.BRIGHTNESS,[v])` (2 reports).
- **FR5** One-time EEPROM pin at start (base effect → Solid, WITH save), then zero writes per frame (mirrors `startFx` `ui.js:2435`).
- **FR6** Slot into `lightingFxCtl`/`startFx`/`stopFx` — mutually exclusive with Strobe/Cycle/Breathe/palette, auto-stop on Stop, tab-away (`ui.js:445/467`), disconnect (`ui.js:161`). rAF clock. Teardown stream+ctx on stop.
- **FR7** Two visualizers: **Breathe** (bass→brightness, slow hue drift — gentle default) and **Pulse** (onset flashes accent). Optional **Follow-hue** (dominant freq → hue cycle).
- **FR8** Stop on: Stop, tab hidden, disconnect, audio track `ended`, silence timeout (optional).
- **FR9** Headless node path (secondary): a save-less `setRGBLive` on `host/device.js` driven by an OS loopback source.

### S.3 Non-functional
- **NFR1 Safety:** opt-in only, never auto/on-connect; brightness cap ~60% default (**host-enforced — firmware does NOT cap**, R.3); flash/slew guard so a bass drop can't strobe; gentle default (Breathe); first-run at-desk confirm.
- **NFR2 EEPROM:** zero writes on the audio path; only the one-time base-effect pin.
- **NFR3 No firmware change** (existing VIA/VialRGB save-less primitives only — the whole advantage over per-key).
- **NFR4 Latency:** < ~50 ms.

### S.4 Scope / non-goals
In: browser audio→HSV pipeline; stock-vs-custom detection + command selection; "Music" effect reusing the FX-loop; ONE small new builder (`buildLightBrightnessLive`); optional headless node hook; deterministic mapping tests.
Out: per-key/spectrum field (that's the other SPARC — needs opcode 0x49); Spotify beat API (dead); EEPROM-persisted "audio profile"; any new raw-HID opcode (if it needs one, it's become the per-key feature).

### S.5 Constraints (from source)
- One app writes at a time (`hid.js:225-229`). `SEND_LEN=64` (`:29`); 64-byte unnumbered output reports via `send(reports,{gap:0})` (`:207`). `viaReport` refuses `0x0a`/`0x0b` (eeprom-reset/bootloader) by construction (`protocol.js:392-394`) — the audio path physically can't wipe EEPROM or jump to DFU. **No firmware brightness ceiling:** `RGB_MATRIX_MAXIMUM_BRIGHTNESS` unset in al80 config.h → default 255; the cap is entirely the host's job.

---

## P — Pseudocode

```
[system audio] --getDisplayMedia({video:true,audio:true,systemAudio:'include'})--> MediaStream  // gesture+picker
  -> AudioContext.createMediaStreamSource -> AnalyserNode(fftSize 512, smoothing 0.7)
  -> src.connect(analyser)                                   // NEVER analyser.connect(destination)
fw = detectFirmware()            // 'custom'|'stock' (P.4) — decides which save-less command
pinBaseEffectSolidWithSave(fw)   // the ONE and ONLY EEPROM write (mirrors startFx ui.js:2435)
state = { prevVal, prevHue, prevFreq, flux[] }
rAF loop (token-guarded like startFx):
  analyser.getByteFrequencyData(freq[256]); analyser.getByteTimeDomainData(wave[512])
  hsv = mapAudioToHSV(freq,wave,mode,{cap,state})           // P.2 — ONE color
  reports = pickSaveLessCommand(fw,hsv)                     // P.3
  hid.send(reports,{gap:0})                                 // save-less; ignore echo
  requestAnimationFrame(next)
stop(): token++; cancelAnimationFrame; stream.getTracks().stop(); audioCtx.close()  // FR8
```

### P.2 mapAudioToHSV (pure, testable — the global-specific math)
```
rms  = sqrt(mean((wave[i]-128)^2))/128                       // overall loudness 0..1
bass = mean(freq[1..8]); mid = mean(freq[9..40]); treb = mean(freq[41..120]); total = bass+mid+treb+1
hueTarget = (bass*0 + mid*85 + treb*170)/total              // bass=red(0) mid=green(85) treble=blue(170)
flux = sum_i max(0, freq[i]-prevFreq[i]); prevFreq=freq
onset = flux > movingAvg(flux)*1.5 + eps                    // adaptive threshold
switch mode:
  BREATHE (default): valTarget = lerp(0.15,1.0,smoothstep(rms)); hue = slew(state.hue,hueTarget,0.02)
  PULSE:  base = lerp(0.10,0.55,rms); valTarget = onset ? min(1,base+0.45) : base; hue = onset ? accentHue : slew(state.hue,hueTarget,0.06)
  FOLLOW_HUE: valTarget = lerp(0.20,1.0,rms); hue = slew(state.hue, dominantBinHue(freq), 0.10)
// SAFETY: cap + slew + flash guard
valTarget *= cap                                            // ~0.60 default (host slider)
val = slewLimit(prevVal, valTarget, MAX_VAL_DELTA_PER_FRAME) // anti-strobe
hue = slewLimitWrap(prevHue, hue, MAX_HUE_DELTA_PER_FRAME)
return { hue: round(hue), sat: 255, val: round(val*255) }   // ONE global HSV
```

### P.3 pickSaveLessCommand(fw, {hue,sat,val}) — the crux
```
custom: return [ buildVialRGBColorLive(hue,sat,val) ]                       // 1 report, hue+sat+val
stock : return [ buildLightColorLive(hue,sat),                             // 07 03 04 hue sat (:425)
                 buildLightBrightnessLive(val) ]                           // 07 03 01 val (NEW, save-less)
```

### P.4 detectFirmware() — reuse the proven probe
```
reply = viaTransact(buildBarGet(), d=>d[0]===0x46, 400)    // 0x46 side-bar GET; custom-only (protocol.js:489)
return reply ? 'custom' : 'stock'                          // corroborate w/ buildFirmwareVersion (:532, wired ui.js:3200)
```

---

## A — Architecture

### A.1 Audio pipeline (browser)
Identical to the per-key doc — reuse verbatim, only swap the mapper: gesture → `getDisplayMedia` → check `getAudioTracks().length` (empty = user didn't tick "share system audio") → `ended` listener → `AudioContext` → `createMediaStreamSource` → `AnalyserNode(512, 0.7)`; `src.connect(analyser)` and stop. rAF clock (live signal, not `frameFn(i)`). The only global-vs-per-key difference: the mapper returns ONE HSV — no LED layout table, no geometry.

### A.2 Stock-vs-custom command selection + detection (the new logic)

| | Custom (vial-qmk) | Stock (ripple, VIA) |
|---|---|---|
| Reactive command | `buildVialRGBColorLive(h,s,v)` `07 41 02 00 spd h s v` (`:459`) | `buildLightColorLive(h,s)` `07 03 04 h s` + `buildLightBrightnessLive(v)` `07 03 01 v` |
| Reports/frame | 1 | 2 |
| hsv in one write? | yes (`vialrgb.c:168`) | no — id 4 (`via.c:651`) + id 1 (`via.c:637`) |
| Save-less? | yes (all `*_noeeprom`) | yes (save is only `09 03`) |
| Brightness reactivity? | yes | **yes** (the myth-buster — R.1) |
| Base-effect pin | `buildVialRGB(SOLID=2,{val:255})` (`:457`) | `buildLightEffect(SOLID)` + one `buildLightSave` |
| Firmware brightness cap | none | none |

Detection: `buildBarGet()` (`:489`) round-trip via `viaTransact` (used `ui.js:3200`). Custom replies `[0x46,h,s,v,indep]`; stock default-cases it → no reply → 'stock'. Cache per connection (invalidate on disconnect `ui.js:161`). Wrong-firmware commands are harmless no-ops, so a misdetect degrades to "no reactivity," never a bad write. Ship a manual override toggle.

### A.3 protocol.js reuse — ONE tiny new builder
Everything else exists (custom: `buildVialRGBColorLive` `:459`, `buildVialRGB` `:457`; stock: `buildLightColorLive` `:425`, `buildLightSet`/`LIGHT` `:401`/`:388`, `buildLightEffect`+`buildLightSave` `:415`/`:405`). The one addition (mirrors `buildLightColorLive`):
```js
/** SAVE-LESS brightness set for real-time animation. One 07 03 01 <val> report, no 0x09 save.
 *  Companion to buildLightColorLive; the streaming loop uses this instead of buildLightBrightness
 *  (which appends a save = EEPROM). Stock via_qmk_rgb_matrix_set_value handles id 1 noeeprom. */
export const buildLightBrightnessLive = (v) => buildLightSet(LIGHT.BRIGHTNESS, [v]);   // next to :425
```
That's the entire protocol delta. Both primitives are already `clamp8`- and `viaReport`-guarded.

### A.4 "Music" effect wired into startFx/lightingFxCtl
Reuse the lifecycle wholesale — `stopFx` (`:2398`) bumps `fxToken`, clears the timer, fires on disconnect/section/tab (`:161/:445/:467`). Music is `startFx`'s twin with an audio color source + rAF clock. Register `stopMusic` into the `lightingFxCtl.stop` chain so all teardown points cover it.
```js
let audioToken=0, rafId=null, mediaStream=null, audioCtx=null, analyser=null;
async function startMusic(mode){
  stopFx(); stopMusic();                                   // exclusive with every other effect
  if (!connected) return err('Connect first.');
  const fw = await detectFirmware();                       // 'custom'|'stock'
  try { mediaStream = await navigator.mediaDevices.getDisplayMedia({video:true,audio:true,systemAudio:'include'}); }
  catch { return err('Screen/audio share was cancelled.'); }
  if (!mediaStream.getAudioTracks().length){ stopMusic(); return err('No system audio — tick "Share tab/system audio".'); }
  mediaStream.getAudioTracks()[0].addEventListener('ended', stopMusic);
  audioCtx=new AudioContext(); const srcNode=audioCtx.createMediaStreamSource(mediaStream);
  analyser=audioCtx.createAnalyser(); analyser.fftSize=512; analyser.smoothingTimeConstant=0.7; srcNode.connect(analyser);
  const pin = fw==='custom' ? proto.buildVialRGB(SOLID,{val:255}) : [...proto.buildLightEffect(1)]; // ONE-TIME EEPROM pin
  if (!await guardedSend('Music → Solid Color', fxStatus, pin)){ stopMusic(); return; }
  const freq=new Uint8Array(analyser.frequencyBinCount), wave=new Uint8Array(analyser.fftSize);
  const cap=+brightnessCapSlider.value/100, state=newMapState(), token=++audioToken;
  const tick=async()=>{
    if (token!==audioToken) return;
    analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave);
    const hsv=mapAudioToHSV(freq,wave,mode,{cap,state});
    try { await hid.send(pickSaveLessCommand(fw,hsv),{gap:0}); } catch(e){ stopMusic(); return err('Send failed: '+e.message); }
    if (token===audioToken) rafId=requestAnimationFrame(tick);
  };
  tick();
}
function stopMusic(){ audioToken++; if(rafId){cancelAnimationFrame(rafId);rafId=null;} mediaStream?.getTracks().forEach(t=>t.stop()); audioCtx?.close(); mediaStream=audioCtx=analyser=null; }
const prevStop=lightingFxCtl.stop; lightingFxCtl.stop=()=>{ prevStop(); stopMusic(); };  // now covered by :161/:445/:467
```
UI: a "Music" card — mode select (Breathe default/Pulse/Follow-hue), brightness-cap slider (0-100, default 60), Start/Stop. Start is the required gesture for `getDisplayMedia`.

### A.5 Node/headless path (host/device.js) — secondary
Precedent works: `nowplaying-run.mjs:153` tints RGB per track via `setRGB({effect:1,color:{hue,sat}})`. But `setRGB` (`device.js:232-240`) uses stock set+SAVE pairs (EEPROM) — fine per-track, fatal per-frame. So the node loop needs a save-less sibling `setRGBLive({hue,sat,val})` → custom `[buildVialRGBColorLive]` / stock `[buildLightColorLive, buildLightBrightnessLive]` via `this._send` (no gate). Node audio needs an OS loopback (WASAPI/Stereo Mix/VB-Cable) + FFT; the pure mapper ports unchanged (`host/lib/art.js` has rgbToHsv/hsvToRgb/dominantColor). Lower priority.

---

## R — Refinement

### R.1 The "stock brightness streaming" problem — solved, it was a mirage
The save is ONLY in the wrapper `buildLightBrightness` (`protocol.js:414`) — strip it. The bare `buildLightSet(LIGHT.BRIGHTNESS,[v])` (`:401`) is one save-less report; firmware handles it noeeprom: `via_qmk_rgb_matrix_set_value` id 1 → `rgb_matrix_sethsv_noeeprom(get_hue(),get_sat(),value)` (`via.c:637`), preserving current hue/sat. Color id 4 preserves current value (`via.c:651`). So the two-report stock frame composes to full HSV, zero cross-talk, zero EEPROM. **Both firmwares get hue+brightness reactivity**; stock just costs one extra report/frame (non-issue at rAF). **⚠ VERIFY:** the cited `via.c` is the *custom* vial-qmk tree; the *stock ripple* fw is proprietary but VIA-compatible (usevia streams live color while dragging without hammering EEPROM, `KB:569`), so near-certain. Confirm once on stock hardware: stream a brightness ramp 30 s → power-cycle → saved brightness unchanged (proves no per-frame EEPROM write).

### R.2 EEPROM safety
Only write = the one-time base-effect pin at start. Every frame after is `*Live` (save-less) by construction. `viaReport` (`:392`) hard-refuses `0x0a`/`0x0b` so a mapping bug can't reset EEPROM / jump to bootloader. The custom pin is proven in `startFx` (`:2435`); the stock pin is the standard set+save pair, once.

### R.3 Firmware brightness cap = host-only (safety-critical)
`RGB_MATRIX_MAXIMUM_BRIGHTNESS` unset in al80 config.h → default 255. Nothing on-device clamps brightness. The P.2 `cap` multiply + the slider are the ONLY ceiling. Default cap 0.60; clamp `val` again at the builder edge (`clamp8` `:389`). Two independent host-side clamps because the firmware offers none.

### R.4 Anti-strobe
`slewLimit(prevVal,target,MAX_VAL_DELTA)` caps per-frame value change (~10-15%/frame) so a bass drop ramps, not snaps — even in Pulse. `slewLimitWrap` on hue takes the short way round the wheel (reuse `lerpHue` `ui.js:2454`) + caps rotation. Default mode = **Breathe** (slow), not Pulse. Pulse's onset bump is additive on a slewed base → reads as a swell.

### R.5 Capability differences
Custom: 1 report/frame, hsv atomic, lowest latency (could later drive BREATHING/HUE_WAVE via speed — out of scope). Stock: 2 reports/frame, hue/sat + val on separate ids but composable + independent, save-less — full parity. Neither caps brightness (R.3). Both no-op the other's command → misdetect is safe.

### R.6 Failure modes
Silence → Breathe holds a dim floor (val 0.15·cap), frames keep flowing; optional after N s near-zero flux → `stopMusic` + rest on solid (`restTo` `ui.js:2420`). Tab hidden/section → `lightingFxCtl.stop()` → chained `stopMusic`. Disconnect → `hid.send` throws (`hid.js:225`) → `stopMusic`; `ui.js:161` also fires; replug auto-reconnect (`hid.js:104-119`) restores link, user restarts (fresh gesture required). Track `ended` → `stopMusic`. Misdetect → wrong command no-ops; log + manual override. Interface contention → "one app at a time" throw (`hid.js:225-229`).

### R.7 Safety checklist
opt-in Start (never on-connect) · `getDisplayMedia` gesture+picker gate · host cap slider (60% default) AND builder-edge `clamp8` · per-frame value+hue slew guard · gentle Breathe default · first-run one-time confirm · never a startling effect (standing rule).

---

## C — Completion

### C.1 Phased plan
- **Phase 0 (done here):** confirm both firmwares save-less per-frame (R.1); detection = `buildBarGet` probe.
- **Phase 1 — MVP Breathe on custom:** add `buildLightBrightnessLive`; Music card + `startMusic/stopMusic` wired into `lightingFxCtl.stop`; Breathe only; custom path; cap slider + slew guard. Reuses ~90% of `startFx`.
- **Phase 2 — stock support:** `detectFirmware`; `pickSaveLessCommand` branch; stock pin. Verify R.1 on stock hardware.
- **Phase 3 — visualizers:** Pulse + Follow-hue; mode select.
- **Phase 4 — node path:** `setRGBLive` + OS loopback + FFT; port the pure mapper.

### C.2 Test plan (host-side, deterministic)
New builder: `buildLightBrightnessLive(200)` → single `07 03 01 c8`, clamp8, ≤64 B, no `09` save. **`mapAudioToHSV` on canned FFT fixtures (the key pure-function test):** silence → dim floor `val≈0.15·cap·255`; bass spike → hue≈0; treble spike → hue≈170; synthetic flux jump → Pulse `onset` + value bump then decay; cap respected (cap 0.6 → never `val>153`); slew respected (target 0→255 in one step → output rises ≤MAX_VAL_DELTA/frame); hue wrap short-path. `pickSaveLessCommand`: custom → 1 report `07 41…`; stock → 2 reports `07 03 04…`,`07 03 01…`; neither has a `09` save. Node dry-run: `setRGBLive` emits right report count per fw + zero save reports (contrast `setRGB`). Lifecycle (JSDOM): start calls `stopFx` first; tab-away/disconnect/`ended` tear down stream+ctx + cancel rAF.

### C.3 Done-criteria
Music streams one global HSV save-less at rAF on BOTH firmwares with zero EEPROM writes on the audio path (one-time pin only); mapping validated on fixtures; Breathe(default)+Pulse+Follow-hue work, capped + slew-guarded; stops on Stop/tab-away/disconnect/track-end/silence; fw auto-detected + manual override; no new opcode/reflash; no regression to existing effects (shared `startFx`/`stopFx`/`fxToken`).

### C.4 Open questions / must-verify
1. **⚠ Stock ripple truly noeeprom on per-frame set-value** (R.1) — confirm w/ brightness-ramp + power-cycle on stock hardware.
2. Detection primitive — `buildBarGet` (0x46) proves custom; corroborate w/ `buildFirmwareVersion`; ship a manual override.
3. Band bin ranges assume fftSize 512 @ ~44.1 kHz; tune against real music (opinionated defaults, nothing user-exposed).
4. Silence policy — hold dim floor vs auto-rest after N s (recommend hold-floor for MVP).
5. rAF vs the FX loop's setTimeout clock — the two token systems (`fxToken` vs `audioToken`) don't need merging as long as `startMusic` calls `stopFx()` and the chained `lightingFxCtl.stop` includes `stopMusic`.

**Grounding for the implementer:** copy `startFx`/`stopFx`/`sendFrame` (`ui.js:2398-2450`), swap `frameFn(i)` for `mapAudioToHSV` + `setTimeout` for `requestAnimationFrame`. The only protocol addition is the one-line `buildLightBrightnessLive`; every other primitive exists + is tested. The stock-brightness "problem" is a wrapper artifact, not a firmware limit (`via.c:632-651`). This really is the existing software-FX machine + an audio color source + a firmware-aware save-less command picker — no firmware change, works on stock and custom.
