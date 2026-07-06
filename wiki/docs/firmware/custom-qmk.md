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

Landing in **v1.3.0**: instant caps/num-lock LCD icons via a `led_update_kb` hook (a lag regression is being fixed first).

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
| `v24_locks` / `v25_locks` | instant caps/num-lock LCD icons (`led_update_kb`) — landing as **v1.3.0** |

The dev bins above fold into the semver releases: **v1.0.0** = keys+Vial+LCD+battery+18 effects,
**v1.1.0** = reactive, **v1.2.0** = independent LED bar (latest), **v1.3.0** = encoder + lock icons (coming).

!!! danger "Nothing here reflashes silently"
    All custom bins are experimental. Flashing replaces the ripple firmware. See
    [Safety / do-not-touch](../reference/safety.md).
