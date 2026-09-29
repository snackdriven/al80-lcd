---
title: Porting Bluetooth / 2.4G onto the custom AL80 firmware
status: plan
updated: 2026-09-29
scope: What it takes to get the SmartBLE radio working on custom vial-qmk without giving up v29's LCD/RGB/encoder work
---

# Wireless on custom firmware — the port

`wiki/docs/roadmap.md` files this under **🚫 Not worth it**, on two grounds: no flash budget, and "going wireless is strictly less control surface." The second is a preference. **The first is now known to be false**, and the protocol is no longer a black box.

## What changed

### 1. The chip is 128 KB, not 64 KB

`MCU_LDSCRIPT` is set nowhere in `rules.mk` or `keyboard.json`, so QMK falls back to the STM32F1xx default — the **x8** tier, 64 KB — giving 56 KB of app flash after the bootloader's 8 KB. That's where "≈2.37 KB free" comes from.

But `config.h:4` already says **STM32F103xB**, and the hardware agrees: a DFU read on 2026-09-29 pulled **122,880 bytes** from `0x08002000` to `0x08020000` without error. Stock firmware is 66,780 B, which also doesn't fit the 56 KB tier.

Setting `MCU_LDSCRIPT = STM32F103xB` moves the ceiling from 56 KB to 120 KB. The flash objection disappears.

### 2. The full radio protocol is in hand

`research/mk856-src/.../smart_kb16/smart_ble.c` (b75Pro sibling, same SmartBLE module) has the complete driver — both directions, not just the three inbound commands recorded in KB §D5.

## Memory map (measured, from the dump)

```
0x08002000 - 0x0800F840   v29 firmware              55,360 B
0x0800F840 - 0x080124DC   DEAD stock firmware tail  ~9 KB   (resolved 2026-09-29)
0x080124DC - 0x0801E000   free                      ~43 KB
0x0801E000 - 0x08020000   emulated EEPROM, ~2.4 KB  << QMK settings; do not overwrite
```

**The ~9 KB above the firmware is not live data — it's leftover stock firmware.** Compared byte-for-byte against `YUNZII_AL80_RIPPLE.bin` at the same offset: **9,422 of 9,436 bytes identical (99.85%)**, versus 4% for V0119 and 6% for SIGNALRGB V0122. The custom image (55 KB) is smaller than the stock one (66 KB), so flashing only erased the pages it needed and the tail of the old RIPPLE image survived. The 14 differing bytes are a small runtime-written delta.

So nothing needs preserving there. Usable code space is `0x08002000` → `0x0801E000` = **112 KB**, with only the top 8 KB reserved for EEPROM.

## The protocol

### Outbound (STM32 → radio), from `smart_ble.c`

All commands are preceded by **60 × `0x00`** wake bytes, then a settle delay.

| Call | Wire bytes | Delay |
|---|---|---|
| `WIRELESS_PAIR(mode)` | `55 03 00 <mode> 01`, sent twice 10 ms apart | 350 ms after wake |
| `WIRELESS_START(mode)` | `55 14 00 <mode> <ble_name…> 00`, twice | 350 ms after wake |
| `WIRELESS_STOP()` | `55 02 00 00` | 100 ms after wake |
| `sc_ble_battary(lvl)` | `55 02 09 <level>` | — |

`mode`: 1 = BT1, 2 = BT2, 3 = BT3, 4 = 2.4G. `0` = USB.

`ble_name` is the advertised name — b75Pro uses `"YUNZII B75PROMAX"`; the AL80 advertises **`"YUNZII AL80 BT"`** per KB §D5, so that string is already known.

### HID reports (STM32 → radio)

| Report | Framing |
|---|---|
| 6KRO keyboard | `55 09 01 <KEYBOARD_REPORT_SIZE bytes>` |
| NKRO | `55 15 <21 bytes>` |

**Throughput ceiling:** the reference driver waits **8 ms between reports on BLE**, 2 ms on 2.4G. That's ~125 Hz wireless vs 1000 Hz wired. Non-negotiable in this design — it's the module's pacing, not a tunable.

### Inbound (radio → STM32)

Already documented in KB §D5 — `55 03 <cmd> <mode> <data>`, three commands: connection status, host lock-LED, suspend `0xAA` / resume `0xBB`.

## Architecture

The reference implementation is a **QMK host driver swap**, which is the standard wireless pattern:

```c
static host_driver_t ap2_ble_driver = {
    ap2_ble_leds, ap2_ble_keyboard, ap2_send_nkro, ap2_ble_mouse, ap2_ble_extra
};
/* going wireless */  last_host_driver = host_get_driver();
                      host_set_driver(&ap2_ble_driver);
/* back to USB   */   host_set_driver(last_host_driver);
```

### UART allocation — the one structural question

The AL80 custom firmware already drives **USART3** for the LCD, using **raw ChibiOS** (`sdStart(&SD3, &lcd_serial_config)` / `sdWrite`), not QMK's single-instance `uart.h` wrapper. That's fortunate: the radio sits on **USART1** (PA9 TX / PA10 RX, 460800 8N1, no remap needed), so it's a second `SerialDriver` instance — `SD1` — following the identical pattern.

Required:

- `mcuconf.h`: add `#define STM32_SERIAL_USE_USART1 TRUE` alongside the existing USART3 line
- `al80.c`: `sdStart(&SD1, &ble_serial_config)` in `keyboard_post_init_kb`
- Keep the existing `g_screen_busy` discipline in mind — USART3 TX is interrupt-driven and already sensitive to preemption (the v14 image-shear fix). Adding a second interrupt-driven UART is a **new preemption source on the same priority landscape**; LCD shear is the regression to watch for.

## Plan

### Phase 1 — clear the flash question

- [ ] Identify the ~9 KB region at `0x0800F840`–`0x08013000` (Vial dynamic keymap? LCD cache?)
- [ ] Set `MCU_LDSCRIPT = STM32F103xB` in `rules.mk`
- [ ] Explicitly pin the emulated EEPROM location so growth can't collide with it
- [ ] Build v29 unchanged on the xB tier, flash, confirm keymap + LCD + saved settings all survive
- [ ] Re-dump and diff the data regions against the 2026-09-29 dump

**Pass condition:** same firmware, bigger ceiling, nothing lost. Do not proceed until this is boring.

### Phase 2 — UART bring-up, no HID

- [ ] `STM32_SERIAL_USE_USART1`, start `SD1` at 460800 8N1
- [ ] Send the wake sequence + `WIRELESS_PAIR(1)` from a scratch keycode
- [ ] Confirm the module advertises as `YUNZII AL80 BT` from a phone or `bluetoothctl`
- [ ] Watch the LCD for shear during radio traffic

**Pass condition:** the radio advertises on command. Nothing types yet — that's fine, this is the "is the coprocessor alive and listening" gate.

### Phase 3 — inbound parser

- [ ] `SD1` RX handler for `55 03 <cmd> <mode> <data>`
- [ ] Wire connection status to a `wireless_connected` flag
- [ ] Handle suspend `0xAA` / resume `0xBB`
- [ ] Feed lock-LED state into the existing `led_update_kb` path

### Phase 4 — host driver

- [ ] Implement `ap2_ble_keyboard` / `ap2_send_nkro` / `leds` / `mouse` / `extra`
- [ ] `host_set_driver()` swap on mode change, with `last_host_driver` restore
- [ ] Honour the 8 ms BLE / 2 ms 2.4G pacing
- [ ] Persist last mode in the existing KB datablock (there's already an `eeconfig_last_wireless_mode` field in the reference struct)

**Pass condition:** typing works over BT1 and survives a sleep/wake cycle.

### Phase 5 — keycodes + battery

- [ ] `CUSTOM()` keycodes for BT1/BT2/BT3/2.4G/USB, matching stock's `CUSTOM(1-4)` + `KC_USB` so muscle memory carries over
- [ ] Feed the existing ADC1 ch9 battery telemetry into `sc_ble_battary`
- [ ] Confirm the LCD battery gauge still reads correctly on both power paths

## Risks

- **The 9 KB mystery region.** Highest-value unknown. Getting this wrong costs keymaps or saved images, silently.
- **LCD shear.** USART3 TX already needed `g_screen_busy` gating to survive `rgb_matrix`/Vial preemption. A second interrupt-driven UART is exactly the kind of thing that reintroduces it.
- **Licence.** `smart_ble.c` is **Apache-2.0** (Copyright 2023 Jacky); QMK/vial-qmk is **GPL-2.0**. Apache-2.0 is *not* GPL-2.0 compatible. Personal use is unaffected, but **publishing a derived binary or the ported source in this public repo is a real problem.** Either implement from the protocol description rather than the code, or keep the result private. Worth deciding before writing the file, not after.
- **Bootloader write window.** The DFU alt=2 descriptor covers `0x08002000` to end-of-flash and read the full 120 KB, so it should accept a larger image — but this is inferred from a read, not proven by a write.
- **125 Hz ceiling.** If the AL80 is the daily driver, wireless is a real downgrade in polling rate. Worth knowing before doing the work rather than after.

## Fallback

Every phase is reversible. `AL80_CUSTOM_QMK_v29_panel-hostonly.bin` is committed, and [`backup-20260929`](https://github.com/snackdriven/al80-lcd/releases/tag/backup-20260929) restores firmware **and** EEPROM. ESC + plug always reaches DFU.

## Sources

- `research/mk856-src/repo/yunzii/b75Pro/keyboards/smart_kb16/smart_ble.{c,h}` — the reference driver
- `AL80_KNOWLEDGE_BASE.md` §D5 — inbound commands, UART parameters, BLE advertised name
- Flash dump 2026-09-29 — memory map, 128 KB confirmation
- `firmware/al80-keyboard-src/al80.c` — existing SD3 pattern to mirror
