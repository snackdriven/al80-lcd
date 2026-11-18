# Roadmap — options that we did not build

!!! tip "TL;DR"

    - Two full classes of features use **zero flash** in the firmware: host-side app work, and 1-byte `PK_*` status packets over the USART3 link that is already wired.
    - The b75Pro enum has display opcodes that we did not send yet: `PK_LIGHT_MODE` (0x08), a native 12/24-hour toggle, and a mode in which the module draws a large typed letter.
    - Flash is the limit. The app has **56 KB**. The linker script and `nm` on the linked `.elf` confirm this value. The board links against the 64 KB `STM32F103x8` tier, minus the 8 KB carve-out of the stm32duino bootloader. The "xB/128 KB" header comment in `config.h` does not change this. The latest build (v1.3.0/`v25_locks`) has **~2.37 KB left**. The list puts low-cost wins first.

We collected these options on 2026-07-06 from the b75Pro sibling source, `RIPPLE.bin`, and this KB. Each item cites its source, so you can check it. No item is invented.

!!! success "Shipped since this survey"
    - **Per-layer encoder**: done and confirmed on-device (v1.3.0). L0 is volume, L1 is RGB brightness, L2 is RGB hue, and L3 is media. It is a hardcoded `encoder_update_user`, not `ENCODER_MAP`. The encoder is not in the Vial/VIA layout of this board, so `ENCODER_MAP` was not visible.
    - **Independent side LED bar**: shipped in v1.2.0 (opcodes 0x46/47/48). The status-meter idea below is the next step on top of it.
    - **Instant caps/num-lock LCD icons**: shipped in v1.3.0. A gated `led_update_kb` hook pushes the icons when the state changes, so the 30s lag is gone. The eager debounce (`sym_eager_pk`) in the same release also removed the mute lag on a knob press.
    - **Hotkey → LCD panel, HOST half**: `research/al80-hotkey-panel-switch-SPARC.md`. This half has two parts in al80-studio, and both have device-free tests:

        - The inbound `0x4B` reader (`device.js` → `'panelRequest'`).
        - The debounced `cycler.jumpTo`/`togglePaused`/`step` router (`host/panel-request.js`).

        The firmware half is now also built (see the consolidated-firmware item below).
    - **Per-key audio-reactive RGB, HOST builders**: `research/al80-per-key-audio-reactive-SPARC.md`. These are `buildLiveLeds`/`buildLiveFrame`/`buildLiveStop` in `src/protocol.js` of al80-studio (new opcode `0x49`/`0x4A`), with device-free tests (`test/protocol.test.mjs`). The firmware `0x49` handler is now also built (see the consolidated-firmware item below). This phase also solved the old ambiguous question about the MCU part and the flash cap (see the TL;DR line above and `research/al80-buildout-discoveries.md`).
    - **Consolidated firmware: view-switch + hotkey + per-key keycodes**: `research/al80-firmware-view-switch-keycodes-SPARC.md` (+ hotkey + per-key SPARCs). This is ONE custom-QMK build (`firmware/al80-keyboard-src/`, artifact `AL80_CUSTOM_QMK_v28_keycodes.bin`). It adds the first `process_record_kb` to this build (the build had none before). The build has these parts:

        - View keys `CUSTOM(22-24)` send the host-free `PK_GO` announce over USART3.
        - `PANEL_*` keys `CUSTOM(25-29)` send that announce plus a `raw_hid_send` `0x4B` to the host cycler.
        - The `0x49` per-key LED stream handler, `g_live_rgb[]`, the indicators paint, and the idle timeout.

        **It compiles clean, +452 B → 1,976 B of the 56 KB flash free. It is NOT flashed yet.** The on-device verify procedure is `research/al80-lcd-morning-playbook.md`. The device-free wire-bytes test is green (`firmware/test/firmware-wire.test.mjs`). The test checks that the announce bytes == the SPARC A4 table == live `protocol.js buildView`, that `al80_crc16` == `ga`, and the `0x4B`/`0x49` framing.
    - **Panel auto-cycle, the real always-on host**: `research/al80-lcd-panel-auto-cycle-SPARC.md`. `host/cycle-run.mjs` + `host/cycle.js` now own the one Device. They do these tasks, with no browser tab:

        - Rotate now-playing/weather/clock, with a dwell time for each panel.
        - Remove idle or stale panels from the rotation.
        - Jump to now-playing when the track changes.
        - Preempt to an alert card through the existing `127.0.0.1:7333` intake.

        The device-free tests are green (`host/test/cycle.test.mjs`, 7/7). Panels (`host/panels/*.js`) use a small `poll/available/render` interface. A future dashboard idea (Pomodoro, meeting countdown, wedding countdown) can join if you add one file to `CYCLE_PANELS`. **Two tasks are still open: the on-device rotation/banding confirm, and the autostart unification (repointing `run-nowplaying.vbs`).** See `research/al80-buildout-discoveries.md`.

## 🎛️ Cheap firmware wins

| Option | Flash | Value | Where |
|---|---|---|---|
| **Screen power-off key**: toggle the C9 enable pin to blank the LCD. This is the "sleep" that the KB said did not exist (it is a GPIO, not an opcode). | ~100 B | high | `al80.c:347` |
| **RGB layer indicator**: tint a row for each active layer with `rgb_matrix_indicators_advanced_kb()`. | ~300 B | high | KB §D6 |
| **RGB off on host sleep**: `RGB_MATRIX_SLEEP` is not set. | ~50 B | med | `config.h` |
| ~~**Host-free view-switch keys**: keycodes that send `PK_GO_HOME` / `PK_TOGGLE_PIC` / `PK_GO_GIF`.~~ **✅ BUILT** (consolidated firmware, +452 B for all three keycode features; flash pending). | ~200 B | med | `mk25047.c:1412` |
| **Caps Word**: standard QMK, not enabled. | ~400 B | med | — |

## 📟 Native module features to probe first

Send each command and watch the device *before* you use flash on these features. The display module possibly draws them already (not confirmed on the AL80). Source: b75Pro `mk25047/uart_mod.h:26-59`, `keyboard_screen.c:217-390`.

- **`PK_LIGHT_MODE` (0x08)**: a lighting icon/name on the homepage.
- **`PK_SWITCH_TIME`**: a real 12/24-hour toggle. It would retire the full host-side "12-hour hack."
- **`PK_LETTER_SHOW` / `PK_LETTER_OFF`**: the module draws the last typed letter in a large size. This has no pixel/framebuffer cost.

## 🖼️ Zero-firmware-flash (host-side app)

- **Startup boot animation** (mode-0 GIF): a vendor button that we did not expose.
- **Live status cards on the LCD**: weather ✅ and now-playing ✅ ship today on the always-on host (`cycle-run.mjs`, see "Shipped since this survey" above). The next calendar event, the wedding countdown (the bot already exists), and a Pomodoro ring are not built. Each one only needs a new `panels/*.js` file that uses `poll/available/render`, and a slot in `CYCLE_PANELS`. The host dependency is done (`research/al80-lcd-panel-auto-cycle-SPARC.md`, which supersedes the original `al80-always-on-host-SPARC.md` plan).

## 🔦 Side bar as a status meter

The bar is **3 LEDs that are already in the matrix at indices 76–78** (driver 1 / CS pin C8). They have the keylight flag, so they show the same color as the keys today. Override those three LEDs in `rgb_matrix_indicators_advanced_kb()` (~150 B, RAM ~3 B). Then they can show a battery / caps / layer / notification meter. A bar-color command can copy the existing palette protocol (0x43-0x45).

## 🚫 Not worth it (given the 56 KB ceiling)

- **Bluetooth / 2.4G on custom**: high cost. Our own RE (§D5) shows that wireless gives *less* control. The radio is a separate coprocessor that accepts only 3 inbound commands.
- **Autocorrect**: the dictionary blob is too large when you must remove features to fit.
- **Hardware RTC port**: medium flash, and it needs the LSE/backup domain. The 60s host re-sync already makes drift unimportant.
- **More framebuffer RGB effects**: each effect uses exactly the flash that you try to get back.

## ⭐ Top 3

The per-layer encoder shipped (v1.3.0). These are the next options with the best value for each byte:

1. **Screen power-off key**: ~100 B. It uses the C9 enable that `al80.c` already has. It also closes an item that the KB incorrectly said was impossible (it is a GPIO, not an opcode).
2. **Side bar as a status meter**: the independent bar colour already shipped (v1.2.0). The remaining step is to drive those three LEDs from the battery / caps / layer state (~150 B).
3. **Probe the undocumented PK opcodes**: a 30-minute send-and-watch test, not a build. It has the highest upside in the survey at almost zero cost. It tells you which native features are real before you use flash.
