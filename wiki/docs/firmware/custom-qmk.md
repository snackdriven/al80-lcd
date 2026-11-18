---
title: Custom QMK
status: in-progress
updated: 2026-07-06
scope: The custom vial-qmk build, the LCD-enable pin (C9 not B7), and the port-from-source plan
---

# Custom QMK

This page is about a custom vial-qmk build. The build has these features:

- An aw20216s matrix.
- VialRGB per-key lighting, plus a live keymap and macros.
- A `PALETTE_CYCLE` effect. The user can change its colors.
- An LCD raw-HID pass-through.

The bins are in `firmware/` (`AL80_CUSTOM_QMK_*.bin`). Clean semver releases are on the al80-lcd
Releases page (v1.0.0 → current). The LCD path is portable from source.

## ✅ What works on-device now

These items are confirmed on the physical AL80, not only in source:

- **Keys + Vial**: a live keymap, layers, and macros. You do not need to reflash.
- **VialRGB per-key lighting**: 18 matrix effects. These include **reactive/splash** effects that light when you press a key.
- **Independent side LED bar**: matrix LEDs 76–78, opcodes 0x46/47/48. The bar has its own colour and brightness. The firmware controls the bar separately from the keys.
- **Per-layer rotary encoder**: L0 volume, L1 RGB brightness, L2 RGB hue, L3 media. It is built as a hardcoded `encoder_update_user`, **not** `ENCODER_MAP`. The encoder is not in the Vial/VIA layout of this board, so `ENCODER_MAP` was invisible and never fired.
- **Battery telemetry**: ADC1 ch9 (PB1), ratiometric against the internal Vref, median-of-10, piecewise-linear %.
- **LCD**: clean still images, a clock, and GIFs over the raw-HID pass-through (C9-high enable).
- **Instant caps/num-lock LCD icons**: the firmware pushes the icons when the lock state changes, through a gated `led_update_kb` hook. The old 30 s lag is gone. These icons shipped in v1.3.0.

v1.3.0 also changed to eager debounce (`DEBOUNCE_TYPE = sym_eager_pk`) to make the keys respond
faster. That change finally removed the mushy "mute lag" on the knob press.

!!! success "LCD-on-custom is portable from source — no logic analyzer (2026-07-04)"
    The AL80 factory stub and the b75Pro sibling source show that you can port the LCD/screen
    path into custom QMK **from source alone**. The earlier conclusion, "B7 is the deciding pin /
    needs a logic-analyzer capture", is **wrong**.

## 🔌 The LCD enable is C9, not B7

- The LCD/screen enable is `C9`, driven HIGH. Evidence: in `keyboard_post_init_kb`, the AL80
  factory stub `research/mk856-src/repo/yunzii/al80/unpacked/mk856src/mk856.c:20-31` runs
  `setPinOutput(C9); writePinHigh(C9)`. It also runs `setPinOutput(B7); writePinLow(B7)` and
  `setPinInput(B9)`. Thus the factory firmware drives B7 low and C9 high, and sets B9 as an input.
  `common.h:83` names the pin `LCD_SWITCH C9`.
- B7 is only the aw20216s LED-driver EN (`config.h:42-43` DRIVER_1_EN / DRIVER_2_EN). It is not a
  screen line. The v1–v6 custom builds fixated on B7 and never drove C9. That is the real reason
  that the panel stayed dark.
- The fix is to drive C9 high and forward the raw-HID `0x40/0x41/0x42` stream to USART3 (PC10 TX /
  PC11 RX) at **460800 8N1**. 460800 is the RIPPLE.bin baud of the AL80. The b75Pro sibling source
  (`mk25047.c:170` `{ .speed = 921600 }`) is for a different board. If you see a bare 921600 in a
  screen context, treat it as specific to the b75Pro. Use it as a fallback only if a 460800 flash
  renders blank.
- B9 is the LCD plug-detect INPUT. It is not LED data.

One residual question remains: does the physical AL80 revision use the C9-high enable or the
B3-active-low enable of the b75Pro? Both enables are in source. The method to resolve this question
is to *flash the firmware and watch the screen*, not to probe. The full plan is in
`research/custom-qmk-lcd-port-plan.md`.

## ⚠️ Build gotchas logged

- `RAW_EPSIZE` must be **64**. The QMK default of 32 breaks 64-byte raw-HID.
- The Vial length-guards reject lengths that are not 32. Relax the guards to `<`.
- An SWJ/AFIO ordering bug stole 4 matrix columns. One atomic `AFIO->MAPR` write fixed it.
- On custom firmware, image shear is UART TX jitter. The jitter occurs because `rgb_matrix`/Vial
  preempt the serial TX interrupt. The fix is to gate `aw20216s_flush()` on a `g_screen_busy` flag
  and to use per-bank pacing on the host.
  Refer to [Stock firmware & disassembly → image shear](stock-and-disassembly.md).
- Battery telemetry is recoverable on custom firmware, so you do not lose it when you change to
  custom firmware. The method: **ADC1 ch9 = PB1**, ratiometric against the internal Vref (ch17),
  `mv = adc*1764/vref`, median-of-10, piecewise-linear %. The source is b75Pro `smart_ble.c` /
  `battery.c` / `adc.c`. Refer to [Hardware](../hardware/index.md).

## 📜 Firmware version history (in `firmware/`)

| Bin | What changed |
|---|---|
| `AL80_CUSTOM_QMK_GREEN.bin` (v1) … v6 | Keys + RGB. These builds fixated on B7, and the LCD stayed dark. |
| v7–v13 | LCD forwarding experiments, byteswap trials |
| `v14_rgbpause` | **Image-shear fix**: gate the aw20216s flush on `g_screen_busy` (confirmed clean) |
| `v15_battery` | Battery push |
| `v16_homepage` | Homepage widget init batch at boot (refer to [Homepage widgets](homepage-widgets.md)) |
| `v17_battfix` | Battery gauge fix |
| `v18_rgbfx` / `v19_rgbfx2` | RGB matrix effects → **18 total** (Digital Rain, Pixel Rain, …). v19 was the last dev known-good. |
| `v20_reactive` | Reactive/splash effects (unused tap-dance/combos/key-overrides were removed to make the build fit) |
| `v21_ledbar` | **Independent side LED bar** colour control (0x46/47/48) |
| `v23_encoder` | **Per-layer rotary encoder** (hardcoded `encoder_update_user`) |
| `v24_locks` / `v25_locks` | Instant caps/num-lock LCD icons (`led_update_kb`) + eager debounce (`sym_eager_pk`). Shipped as **v1.3.0**. |
| `v28_keycodes` | **`process_record_kb` added** (this build shipped none before): host-free view-switch keys `CUSTOM(22-24)`, hotkey `PANEL_*` `CUSTOM(25-29)` (`raw_hid_send` `0x4B`), and the per-key `0x49` live-LED handler + `g_live_rgb[]` + indicators paint + idle timeout. **Compiled, +452 B → 1,976 B free; NOT flashed yet** (morning at-desk verify). |

The dev bins above fold into the semver releases as follows:

- **v1.0.0** = keys+Vial+LCD+battery+18 effects.
- **v1.1.0** = reactive.
- **v1.2.0** = independent LED bar.
- **v1.3.0** = encoder + lock icons + eager debounce.

`v28_keycodes` (the consolidated view-switch + hotkey + per-key build) is compiled and
flash-measured, but it is not flashed. Thus it is not cut as a semver release yet. The release
comes after the on-device verification.

## 🎧 Per-key audio-reactive RGB — HOST builders only (not yet a firmware bin)

`research/al80-per-key-audio-reactive-SPARC.md` gives the design for a live per-key VU/spectrum
field over the 82-LED matrix. The browser streams the field save-less over a new opcode `0x49`
(`AP_LIVE_LEDS`). The design also has an optional `0x4A` (`AP_LIVE_CTRL`, stop-now). The host half
is `buildLiveLeds`/`buildLiveFrame`/`buildLiveStop` in the al80-studio `src/protocol.js`. The host
half has device-free tests.

The **firmware `0x49` handler is now built too**, in `v28_keycodes`. It has these parts:

- `g_live_rgb[82*3]`.
- The `rgb_matrix_indicators_advanced_kb` paint loop with the `AL80_LIVE_MAX_VAL` cap.
- The `matrix_scan_kb` idle timeout.

The handler is compiled and flash-measured, but it is not flashed yet. The optional `0x4A` stop
opcode stays host-only. The firmware idle timeout alone restores the prior effect. On the device,
`0x4A` still does nothing, and this causes no harm.

**The linked `.elf` resolved the flash-budget question, not a header comment.** The top comment in
`config.h` says "STM32F103xB (128 KB)". But nothing in `rules.mk` or `keyboard.json` overrides
`MCU_LDSCRIPT`. Thus the STM32F1xx default in `mcu_selection.mk` (`MCU_LDSCRIPT ?= STM32F103x8`)
is what actually links. That default is the **64 KB flash tier**, not 128 KB. The stm32duino
bootloader takes an 8 KB carve-out. After that, the usable `flash0` region is 56 KB
(`__flash0_size__` = `0xE000`, confirmed by `nm` on `.build/yunzii_al80_vial.elf`).

The last build (through v1.3.0/`v25_locks`) links 54,916 B of that region. This leaves
**≈2.37 KB free** (`__flash0_free__`→`__flash0_end__`). The ~200-400 B `0x49` handler fits, but
the margin is thin. For the full derivation, refer to `AL80_KNOWLEDGE_BASE.md` §9b and
`research/al80-buildout-discoveries.md`.

!!! danger "Nothing here reflashes silently"
    All custom bins are experimental. When you flash a custom bin, it replaces the ripple firmware.
    Refer to [Safety / do-not-touch](../reference/safety.md).
