# AL80 Music-Reactive Lighting — Research + Design Brainstorm

**Date:** 2026-07-10 · **Status:** brainstorm (not built) · **Scope:** the GLOBAL-color reactive feature. The per-key spectrum version has its own doc: `al80-per-key-audio-reactive-SPARC.md`.

## Question
Can the AL80 keyboard's RGB lighting react to whatever music/audio is playing on the PC?

## Verdict: yes — and the hard half already exists
The board has **no microphone**, so the keyboard can't hear audio itself (QMK can't self-react to sound). The PC listens and streams colors. And **we already stream colors**: the Lighting tab's software effects (strobe/cycle/breathe) are a host-driven loop that pushes **save-less** `buildVialRGBColorLive(hue,sat)` frames over the live HID connection at animation rate, EEPROM-safe, one-at-a-time, auto-stopping on tab-away/disconnect (`src/ui.js` FX loop ~2340-2490; `lightingFxCtl`). Music-reactive lighting is just a **new frame producer** — an audio analyser — feeding that existing writer. The streaming pipeline is done.

## Research findings (2026-07-10)

### Spotify beat-sync is DEAD for new apps
Spotify killed `GET /v1/audio-analysis/{id}` and `GET /v1/audio-features` for any **new** app on **Nov 27 2024** ("Introducing some changes to our Web API"). A brand-new PKCE dev-mode app (like ours) gets **403 Forbidden**; only apps with extended access granted before that date are grandfathered. Also gone: recommendations, related-artists, 30-sec previews, featured/category playlists. A separate Feb 2026 dev-mode purge removed ~15 more endpoints and now requires the app owner to hold Premium (5-user cap).
- What still works: `GET /v1/me/player/currently-playing` → `progress_ms` (playback position). Enough to sync the *clock*, not to drive *beats*.
- **Consequence:** do NOT design around Spotify beat data. Use live audio capture (better anyway — reacts to *anything*, not just Spotify).
- Sources: developer.spotify.com/blog/2024-11-27-changes-to-the-web-api; Feb 2026 changelog + migration guide; community 403 threads.

### Browser system-audio capture works on Windows/Chrome
`navigator.mediaDevices.getDisplayMedia({ video:true, audio:true, systemAudio:'include' })` → `AudioContext` → `AnalyserNode` is a working, no-native-install pipeline on Chromium/Windows (our target). Gotchas:
- What gets captured depends on the share surface: **Entire screen** + the (opt-in, easy-to-miss) "Share system audio" checkbox = full system audio; **a tab** = that tab's audio (checkbox pre-ticked — cleaner if music is a browser tab); **a window** = no audio.
- Requires a **user gesture + the picker**, shows a "sharing screen" banner, and needs re-consent after reboot / "Stop sharing". Must request `video:true` too (then stop the video track).
- Chromium-desktop-only (Firefox/Safari silently drop the audio; macOS Chrome = tab audio only). Windows is the good case.
- Alternative: `getUserMedia({audio})` on a **loopback device** (Windows "Stereo Mix" or VB-Audio Cable) — one-time setup, then no picker/banner, persists across reboots. This is effectively what SignalRGB/OpenRGB do (WASAPI loopback on the default output).
- Analysis: `AnalyserNode` with `fftSize` 256-1024, `smoothingTimeConstant` 0.6-0.8, `getByteFrequencyData()` (FFT bins) + `getByteTimeDomainData()` (waveform). Do NOT connect the analyser to `ctx.destination` (it's a pass-through tap; connecting doubles the audio).
- Sources: MDN getDisplayMedia / AnalyserNode / Visualizations guide; addpipe demos; SignalRGB/OpenRGB docs.

### Throughput is a non-issue; the firmware is the ceiling
HID interrupt endpoint ~1000 reports/s at 64 B. Global color = 1 small report per frame; even per-key (5 reports/frame) at 60fps = 300/s, ~30% of the ceiling. The real limiter is the **firmware's aw20216s flush/commit rate**, not HID bandwidth.

## Audio → light technique (simple + robust)
- **Brightness / intensity** ← RMS (or peak) amplitude, one-pole smoothed.
- **Hue / color** ← bass/mid/treble band energy (split the FFT bins), map bass↔treble ratio to hue (bass = warm, treble = cool).
- **Beat pulse** ← spectral flux onset (sum of positive bin-to-bin increases; fire when it crosses an adaptive threshold), decay after.

## Two granularities
- **Global color/brightness — this doc's MVP, no firmware change.** Whole-board hue + brightness pulsing. Custom fw: `buildVialRGBColorLive`. Stock fw: `07 03 04 hue sat` (global). Drops into the Lighting tab as a new "Music" effect next to strobe/breathe.
- **Per-key spectrum bar — needs a custom-firmware opcode.** See `al80-per-key-audio-reactive-SPARC.md`.

## Constraints (from our own notes)
- **EEPROM:** save-less streaming only (the FX loop already is).
- **Safety (standing rule):** this is flashy live lighting — the category of the "cop-strobe that landed badly." OPT-IN only, never auto-fire, confirm at-desk (the capture gesture supplies this), default TASTEFUL (bass-breathe, not seizure-strobe), brightness cap + gentle/intense setting.
- **Stock vs custom fw:** global works on both (use the right protocol per fw — al80-studio's `07 03` no-ops on custom VialRGB). Per-key is custom-only.
- **One-owner:** slots into the FX loop's existing mutual exclusion + auto-stop.

## Recommended MVP
Browser, Web Audio via `getDisplayMedia` (tab-share default; loopback-device option), bass/mid/treble energy + beat onset → global hue + brightness through the existing FX-loop streaming path → a new "Music" effect in the Lighting tab. Mostly analyser + mapping since streaming exists. Per-key spectrum on custom firmware is Phase 2 (the SPARC). Do NOT visualize on the LCD — its ~1s frame transfer is far too slow for reactivity; RGB is the right surface.
