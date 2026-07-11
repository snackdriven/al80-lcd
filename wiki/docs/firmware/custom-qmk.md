---
title: Custom QMK
status: in-progress
updated: 2026-07-06
scope: The custom vial-qmk build, the LCD-enable pin (C9 not B7), and the port-from-source plan
---

# Custom QMK

A custom vial-qmk build (aw20216s matrix, VialRGB per-key + live keymap/macros, a
user-recolorable `PALETTE_CYCLE` effect, LCD raw-HID pass-through). Bins live in `firmware/`
(`AL80_CUSTOM_QMK_*.bin`); clean semver releases are on the al80-lcd Releases page (v1.0.0 →
current). The LCD path is portable from source.

## ✅ What works on-device now

Confirmed on the physical AL80, not just source:

- **Keys + Vial** — live keymap, layers, macros, no reflashing.
- **VialRGB per-key lighting** — 18 matrix effects incl. **reactive/splash** effects that light on keypress.
- **Independent side LED bar** — matrix LEDs 76–78, opcodes 0x46/47/48. Own colour + brightness, driven separately from the keys.
- **Per-layer rotary encoder** — L0 volume, L1 RGB brightness, L2 RGB hue, L3 media. Built as a hardcoded `encoder_update_user`, **not** `ENCODER_MAP`: the encoder isn't in this board's Vial/VIA layout, so `ENCODER_MAP` was invisible and never fired.
- **Battery telemetry** — ADC1 ch9 (PB1) ratiometric vs internal Vref, median-of-10, piecewise-linear %.
- **LCD** — clean still images + clock + GIF over the raw-HID pass-through (C9-high enable).
- **Instant caps/num-lock LCD icons** — pushed on state change via a gated `led_update_kb` hook, no more 30s lag. Shipped in v1.3.0.

v1.3.0 also switched to eager debounce (`DEBOUNCE_TYPE = sym_eager_pk`) for snappier keys — that's what finally killed the mushy knob-press "mute lag."

!!! success "LCD-on-custom is portable from source — no logic analyzer (2026-07-04)"
    Reading the AL80 factory stub + b75Pro sibling source shows the LCD/screen path can be ported
    into custom QMK **from source alone**. The earlier "B7 is the deciding pin / needs a
    logic-analyzer capture" conclusion is **wrong**.

## 🔌 The LCD enable is C9, not B7

- The LCD/screen enable is `C9`, driven HIGH. Receipt: the AL80 factory stub
  `research/mk856-src/repo/yunzii/al80/unpacked/mk856src/mk856.c:20-31` runs, in
  `keyboard_post_init_kb`, `setPinOutput(C9); writePinHigh(C9)` alongside
  `setPinOutput(B7); writePinLow(B7)` and `setPinInput(B9)`. So the factory drives B7 low, C9
  high, B9 input. `common.h:83` names the pin `LCD_SWITCH C9`.
- B7 is the aw20216s LED-driver EN only (`config.h:42-43` DRIVER_1_EN / DRIVER_2_EN), not a
  screen line. The v1–v6 custom builds fixated on B7 and never drove C9, which is the real
  reason the panel stayed dark.
- The fix: drive C9 high + forward the raw-HID `0x40/0x41/0x42` stream to USART3 (PC10 TX /
  PC11 RX) at **460800 8N1** (the AL80's RIPPLE.bin baud). The b75Pro sibling source
  (`mk25047.c:170` `{ .speed = 921600 }`) is a different board — treat a bare 921600 in a
  screen context as b75Pro-specific, a fallback only if a 460800 flash renders blank.
- B9 = LCD plug-detect INPUT, not LED data.

The one residual (whether the physical AL80 rev uses C9-high or the b75Pro's B3-active-low enable —
both are in source) is resolved by *flashing and watching the screen*, not by probing. Full plan:
`research/custom-qmk-lcd-port-plan.md`.

## ⚠️ Build gotchas logged

- `RAW_EPSIZE` must be **64** (QMK default 32 breaks 64-byte raw-HID).
- Vial length-guards reject non-32 lengths; relax to `<`.
- An SWJ/AFIO ordering bug stole 4 matrix columns, fixed with one atomic `AFIO->MAPR` write.
- Image shear on custom = UART TX jitter from `rgb_matrix`/Vial preempting the serial TX
  interrupt. Fix = gate `aw20216s_flush()` on a `g_screen_busy` flag + per-bank pacing on the host.
  See [Stock firmware & disassembly → image shear](stock-and-disassembly.md).
- Battery telemetry is recoverable on custom (so it's not lost by going custom): **ADC1 ch9 =
  PB1**, ratiometric vs internal Vref (ch17), `mv = adc*1764/vref`, median-of-10, piecewise-linear
  %. Source: b75Pro `smart_ble.c` / `battery.c` / `adc.c`. See [Hardware](../hardware/index.md).

## 📜 Firmware version history (in `firmware/`)

| Bin | What changed |
|---|---|
| `AL80_CUSTOM_QMK_GREEN.bin` (v1) … v6 | keys + RGB; fixated on B7, LCD dark |
| v7–v13 | LCD forwarding experiments, byteswap trials |
| `v14_rgbpause` | **image-shear fix** — gate aw20216s flush on `g_screen_busy` (confirmed clean) |
| `v15_battery` | battery push |
| `v16_homepage` | homepage widget init batch on boot (see [Homepage widgets](homepage-widgets.md)) |
| `v17_battfix` | battery gauge fix |
| `v18_rgbfx` / `v19_rgbfx2` | RGB matrix effects → **18 total** (Digital Rain, Pixel Rain, …). v19 was the last dev known-good. |
| `v20_reactive` | reactive/splash effects (dropped unused tap-dance/combos/key-overrides to fit) |
| `v21_ledbar` | **independent side LED bar** colour control (0x46/47/48) |
| `v23_encoder` | **per-layer rotary encoder** (hardcoded `encoder_update_user`) |
| `v24_locks` / `v25_locks` | instant caps/num-lock LCD icons (`led_update_kb`) + eager debounce (`sym_eager_pk`) — shipped as **v1.3.0** |
| `v28_keycodes` | **`process_record_kb` added** (this build shipped none): host-free view-switch keys `CUSTOM(22-24)`, hotkey `PANEL_*` `CUSTOM(25-29)` (`raw_hid_send` `0x4B`), and the per-key `0x49` live-LED handler + `g_live_rgb[]` + indicators paint + idle timeout. **Compiled, +452 B → 1,976 B free; NOT yet flashed** (morning at-desk verify). |

The dev bins above fold into the semver releases: **v1.0.0** = keys+Vial+LCD+battery+18 effects,
**v1.1.0** = reactive, **v1.2.0** = independent LED bar, **v1.3.0** = encoder + lock icons + eager debounce.
`v28_keycodes` (the consolidated view-switch + hotkey + per-key build) is compiled and flash-measured but
un-flashed, so it is not yet cut as a semver release — that happens after the on-device verify.

## 🎧 Per-key audio-reactive RGB — HOST builders only (not yet a firmware bin)

`research/al80-per-key-audio-reactive-SPARC.md` designs a live per-key VU/spectrum field over the
82-LED matrix, streamed save-less from the browser over a new opcode `0x49` (`AP_LIVE_LEDS`) + an
optional `0x4A` (`AP_LIVE_CTRL`, stop-now). The host half — al80-studio's `src/protocol.js`
`buildLiveLeds`/`buildLiveFrame`/`buildLiveStop` — is device-free tested. The **firmware `0x49`
handler is now built too** in `v28_keycodes` (`g_live_rgb[82*3]`, the `rgb_matrix_indicators_advanced_kb`
paint loop with the `AL80_LIVE_MAX_VAL` cap, the `matrix_scan_kb` idle timeout) — compiled and
flash-measured, not yet flashed. The optional `0x4A` stop opcode stays host-only (the firmware idle
timeout alone restores the prior effect); `0x4A` still no-ops on-device, harmlessly.

**Flash-budget question resolved from the linked `.elf`, not from a header comment:** `config.h`'s
top comment says "STM32F103xB (128 KB)", but nothing in `rules.mk` or `keyboard.json` overrides
`MCU_LDSCRIPT`, so the STM32F1xx default in `mcu_selection.mk` (`MCU_LDSCRIPT ?= STM32F103x8`)
is what actually links — the **64 KB flash tier**, not 128 KB. After the stm32duino bootloader's
8 KB carve-out, the usable `flash0` region is 56 KB (`__flash0_size__` = `0xE000`, confirmed by
`nm` on `.build/yunzii_al80_vial.elf`); the last build (through v1.3.0/`v25_locks`) links
54,916 B of that, leaving **≈2.37 KB free** (`__flash0_free__`→`__flash0_end__`). The ~200-400 B
`0x49` handler fits, but margin is thin — see `AL80_KNOWLEDGE_BASE.md` §9b and
`research/al80-buildout-discoveries.md` for the full derivation.

!!! danger "Nothing here reflashes silently"
    All custom bins are experimental. Flashing replaces the ripple firmware. See
    [Safety / do-not-touch](../reference/safety.md).
