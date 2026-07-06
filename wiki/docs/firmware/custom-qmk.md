---
title: Custom QMK
status: in-progress
updated: 2026-07-06
scope: The custom vial-qmk build, the LCD-enable pin (C9 not B7), and the port-from-source plan
---

# Custom QMK

A custom vial-qmk build (aw20216s matrix, VialRGB per-key + live keymap/macros, a
user-recolorable `PALETTE_CYCLE` effect, LCD raw-HID pass-through). Bins live in `firmware/`
(`AL80_CUSTOM_QMK_*.bin`). On-device: keys + RGB work. The LCD path is portable from source.

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

!!! danger "Nothing here reflashes silently"
    All custom bins are experimental. Flashing replaces the ripple firmware. See
    [Safety / do-not-touch](../reference/safety.md).
