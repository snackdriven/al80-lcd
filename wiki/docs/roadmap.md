# Roadmap — options we haven't built

!!! tip "TL;DR"

    - Two whole feature classes cost the firmware **zero flash**: host-side app work, and 1-byte `PK_*` status packets over the USART3 link that's already wired.
    - The b75Pro enum has display opcodes we've never sent — `PK_LIGHT_MODE` (0x08), a native 12/24-hour toggle, and a big-typed-letter mode drawn by the module.
    - Flash is the wall: **56 KB app** (confirmed from the linker script + `nm` on the linked `.elf` — the board links against the 64 KB `STM32F103x8` tier regardless of `config.h`'s "xB/128 KB" header comment, minus the stm32duino bootloader's 8 KB carve-out), and as of the latest build (v1.3.0/`v25_locks`) there's **~2.37 KB left**. Cheap wins rank first.

Mined 2026-07-06 from the b75Pro sibling source, `RIPPLE.bin`, and this KB. Every item cites where it came from, so it's checkable, not invented.

!!! success "Shipped since this survey"
    - **Per-layer encoder** — done and confirmed on-device (v1.3.0). L0 volume, L1 RGB brightness, L2 RGB hue, L3 media. Built as a hardcoded `encoder_update_user`, not `ENCODER_MAP` — the encoder isn't in this board's Vial/VIA layout, so `ENCODER_MAP` was invisible.
    - **Independent side LED bar** — shipped in v1.2.0 (opcodes 0x46/47/48). The status-meter idea below is the next step on top of it.
    - **Instant caps/num-lock LCD icons** — shipped in v1.3.0. Pushed on state change via a gated `led_update_kb` hook, no more 30s lag. Eager debounce (`sym_eager_pk`) in the same release killed the knob-press mute lag too.
    - **Hotkey → LCD panel, HOST half** — `research/al80-hotkey-panel-switch-SPARC.md`. al80-studio's inbound `0x4B` reader (`device.js` → `'panelRequest'`) + the debounced `cycler.jumpTo`/`togglePaused`/`step` router (`host/panel-request.js`), device-free tested. Firmware half now built too (see the consolidated-firmware bullet below).
    - **Per-key audio-reactive RGB, HOST builders** — `research/al80-per-key-audio-reactive-SPARC.md`. al80-studio's `src/protocol.js` `buildLiveLeds`/`buildLiveFrame`/`buildLiveStop` (new opcode `0x49`/`0x4A`), device-free tested (`test/protocol.test.mjs`). Firmware `0x49` handler now built too (see the consolidated-firmware bullet below). This phase also resolved the long-ambiguous MCU-part/flash-cap question (see the TL;DR line above and `research/al80-buildout-discoveries.md`).
    - **Consolidated firmware: view-switch + hotkey + per-key keycodes** — `research/al80-firmware-view-switch-keycodes-SPARC.md` (+ hotkey + per-key SPARCs). ONE custom-QMK build (`firmware/al80-keyboard-src/`, artifact `AL80_CUSTOM_QMK_v28_keycodes.bin`) that finally adds a `process_record_kb` to this build (it shipped none): view keys `CUSTOM(22-24)` emit the host-free `PK_GO` announce over USART3; `PANEL_*` keys `CUSTOM(25-29)` fire that plus a `raw_hid_send` `0x4B` to the host cycler; the `0x49` per-key LED stream handler + `g_live_rgb[]` + indicators paint + idle timeout. **Compiles clean, +452 B → 1,976 B of the 56 KB flash free. NOT yet flashed** — on-device verify is `research/al80-lcd-morning-playbook.md`. Device-free wire-bytes test green (`firmware/test/firmware-wire.test.mjs`: announce bytes == SPARC A4 table == live `protocol.js buildView`, `al80_crc16` == `ga`, `0x4B`/`0x49` framing).
    - **Panel auto-cycle, the real always-on host** — `research/al80-lcd-panel-auto-cycle-SPARC.md`. `host/cycle-run.mjs` + `host/cycle.js` now own the one Device and rotate now-playing/weather/clock on a per-panel dwell, dropping idle/stale panels, jumping to now-playing on a track change, and preempting to an alert card via the existing `127.0.0.1:7333` intake — no browser tab. Device-free tests green (`host/test/cycle.test.mjs`, 7/7). Panels (`host/panels/*.js`) implement a small `poll/available/render` interface any future dashboard idea (Pomodoro, meeting countdown, wedding countdown) can join by adding one file to `CYCLE_PANELS`. **On-device rotation/banding confirm and autostart unification (repointing `run-nowplaying.vbs`) are still open** — see `research/al80-buildout-discoveries.md`.

## 🎛️ Cheap firmware wins

| Option | Flash | Value | Where |
|---|---|---|---|
| **Screen power-off key** — toggle the C9 enable pin to blank the LCD. This is the "sleep" the KB said didn't exist (it's a GPIO, not an opcode). | ~100 B | high | `al80.c:347` |
| **RGB layer indicator** — tint a row per active layer via `rgb_matrix_indicators_advanced_kb()`. | ~300 B | high | KB §D6 |
| **RGB off on host sleep** — `RGB_MATRIX_SLEEP` isn't set. | ~50 B | med | `config.h` |
| ~~**Host-free view-switch keys** — keycodes that emit `PK_GO_HOME` / `PK_TOGGLE_PIC` / `PK_GO_GIF`.~~ **✅ BUILT** (consolidated firmware, +452 B for all three keycode features; flash pending). | ~200 B | med | `mk25047.c:1412` |
| **Caps Word** — standard QMK, not enabled. | ~400 B | med | — |

## 📟 Native module features to probe first

Send-and-watch on-device *before* spending flash — the display module may already draw these (unconfirmed on the AL80). Source: b75Pro `mk25047/uart_mod.h:26-59`, `keyboard_screen.c:217-390`.

- **`PK_LIGHT_MODE` (0x08)** — a lighting icon/name on the homepage.
- **`PK_SWITCH_TIME`** — a real 12/24-hour toggle. Would retire the whole host-side "12-hour hack."
- **`PK_LETTER_SHOW` / `PK_LETTER_OFF`** — the letter you just typed, drawn large by the module. No pixel/framebuffer cost.

## 🖼️ Zero-firmware-flash (host-side app)

- **Startup boot animation** (mode-0 GIF) — a vendor button we never exposed.
- **Live status cards on the LCD** — weather ✅ and now-playing ✅ ship today on the always-on host (`cycle-run.mjs`, see "Shipped since this survey" above); next calendar event, the wedding countdown (bot already exists), and a Pomodoro ring are unbuilt but just need a new `panels/*.js` file implementing `poll/available/render` and a slot in `CYCLE_PANELS` — the host dependency (`research/al80-lcd-panel-auto-cycle-SPARC.md`, superseding the original `al80-always-on-host-SPARC.md` plan) is done.

## 🔦 Side bar as a status meter

The bar is **3 LEDs already in the matrix at indices 76–78** (driver 1 / CS pin C8), flagged keylight — which is why they match the keys today. Override those three in `rgb_matrix_indicators_advanced_kb()` (~150 B, RAM ~3 B) to drive a battery / caps / layer / notification meter, with a bar-color command mirroring the existing palette protocol (0x43-0x45).

## 🚫 Not worth it (given the 56 KB ceiling)

- **Bluetooth / 2.4G on custom** — expensive, and going wireless is *less* control per our own RE (§D5). The radio is a separate coprocessor taking only 3 inbound commands.
- **Autocorrect** — the dictionary blob is too big when you're cutting features to fit.
- **Hardware RTC port** — medium flash and needs the LSE/backup domain; the 60s host re-sync already makes drift moot.
- **More framebuffer RGB effects** — each one is exactly the flash you're reclaiming.

## ⭐ Top 3

Per-layer encoder shipped (v1.3.0), so the next-best value-per-byte:

1. **Screen power-off key** — ~100 B, reuses the C9 enable already in `al80.c`, and closes something the KB wrongly concluded was impossible (it's a GPIO, not an opcode).
2. **Side bar as a status meter** — the independent bar colour is already shipped (v1.2.0); the remaining step is driving those three LEDs off battery / caps / layer state (~150 B).
3. **Probe the undocumented PK opcodes** — a 30-minute send-and-watch, not a build. Highest upside in the survey at near-zero cost; tells you which native features are real before you spend flash.
