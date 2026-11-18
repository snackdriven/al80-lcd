---
title: Hardware
status: confirmed
type: reference
scope: Device identity, HID interfaces, the panel, the aw20216s LED bar, wireless, battery, pin map
---

# Hardware

Use this page to look up the AL80's device IDs, HID interfaces, display panel, LEDs, radio,
battery and pins.

!!! tip "TL;DR"

    - **VID 0x28E9 / PID 0x30AF**. The LCD is only on raw-HID interface **0xFF60 / 0x61**.
    - The panel is **96 × 160 RGB565 big-endian, row-major** (30,720 bytes/frame).
    - The side bar is **aw20216s** (not WS2812). **Wireless can't control** the LCD or RGB.

## 📖 Device identity

| Field | Value |
|---|---|
| Product name | AL80 Keyboard |
| Vendor ID (VID) | **0x28E9** (10473) |
| Product ID (PID) | **0x30AF** (12463) |
| LCD interface | usagePage **0xFF60**, usage **0x61** (raw / VIA) |
| Report ID | **0** (unnumbered) |
| Report size | **64 bytes**, both input and output |
| MCU | STM32F103 (keyboard); the LCD is a separate smart display module |

### The 4 HID interfaces

Only `0xFF60/0x61` drives the LCD and accepts the screen-control commands.

- **0xFF60 / 0x61**: raw / VIA. LCD + keymap. Only one process can open it at a time.
- **0xFF31 / 0x74**: vendor, input-only. Status/version/config are probably on this interface.
- **0x0001 / 0x06**: boot keyboard.
- **0x0001 / 0x02 + 0x80** and **0x000C / 0x01**: composite: mouse / system / consumer.

[WebHID](../reference/glossary.md) strips the report ID. OS-level [HID](../reference/glossary.md)
libs (hidapi/node-hid) must prepend a `0x00` report-ID byte, so each write is 65 bytes (1 + 64).

## 📟 The display panel

- Resolution: **96 × 160 px**, portrait. (This value corrects a mis-stated 112×137. See
  [Still images](../protocol/still-images.md).)
- Color: **[RGB565](../reference/glossary.md)**, big-endian, 2 bytes/px.
- Layout: **row-major**, top-left origin (column-major renders sideways).
- Full frame = 96 × 160 = 15,360 px = **30,720 bytes**.
- The panel is a separate smart display module. The keyboard drives it over USART3 (460800 8N1,
  TX PC10 / RX PC11). The module runs the [PK_* protocol](../protocol/display-commit.md). The MCU
  only forwards bytes.

## 🎨 LED side-bar — aw20216s, not WS2812

!!! warning "Correction — the side bar is NOT a WS2812 strip"
    It is **3 more aw20216s LEDs on the same SPI1 bus as the keys** (A5/A6/A7, CS B6/C8, EN B7).
    A *separate* QMK `rgblight` effect engine (the rainbow) drives these LEDs. This engine runs
    at the same time as `rgb_matrix`. That is why the keys can go solid while the bar stays rainbow:
    two software engines, one LED chip. **B9 = LCD plug-detect INPUT, not LED data.**

So freeing the bar for its own effects is a **software job**, not a hardware mod. To do it on custom
QMK:

1. Add the 3 LEDs to `g_aw20216s_leds`.
2. Raise the count 84 → 87.
3. Give the 3 LEDs their own effect.

On [ripple](../reference/glossary.md), the job is a binary patch to the `rgblight` engine. Still
unknown: the exact CS/SW channels for the 3 bar LEDs.

## 📡 Wireless / radio subsystem

The BLE/2.4G radio is a **separate "SmartBLE" UART coprocessor** (vendor i-chip.cn, BLE adv name
"YUNZII AL80 BT"). It talks to the STM32 over **USART1** (base **0x40013800**, 460800 8N1, PA9 TX /
PA10 RX, `0x55 <len> <payload>` framing). The STM32 accepts **only 3 inbound commands** from the
radio (`55 03 <cmd> <mode> <data>`):

- Connection status.
- Host lock-LED (caps/num).
- Suspend (`0xAA`) / resume (`0xBB`).

!!! note "Wireless can't control the LCD or RGB"
    **Nothing wireless touches RGB, LCD, or config.** All screen/RGB/config control goes through USB
    raw-HID (`0xFF60`) only. Wireless mode gives you strictly *fewer* commands. The exact radio chip
    is unconfirmed (we can only see it through its UART). Don't mix up the two UARTs:
    **USART3 @ 0x40004800 = LCD**; **USART1 @ 0x40013800 = radio**.

## 🔋 Battery telemetry

- **ADC1 ch9 = PB1**, ratiometric against the internal Vref (ch17): `mv = adc*1764/vref`.
- Sampling: **median-of-10** (drop min/max, average the middle 8), 10-bit, piecewise-linear %
  (**3200 mV empty … 4150 mV full**).
- Source: sibling b75Pro `smart_ble.c` / `battery.c` / `adc.c` (the strings match the AL80 binary).
- **Recoverable on custom QMK**. You don't lose it when you switch to custom firmware.
- `getDongleAndKeyboardStatus (0x55)` exposes **no battery %**, only a sleep bit.

## 🔌 Pin map (quick)

| Signal | Pin(s) | Notes |
|---|---|---|
| **LCD enable** | **C9** (driven HIGH) | `common.h:83 LCD_SWITCH C9`. **Not** B7. |
| LCD UART (USART3) | PC10 TX / PC11 RX | 460800 8N1 |
| aw20216s LED data | SPI1 A5 / A6 / A7 | keys + bar, one chip |
| aw20216s CS / EN | CS B6, C8 · EN **B7** | B7 = LED-driver EN only |
| LCD plug-detect | B9 | input |
| Radio UART (USART1) | PA9 TX / PA10 RX | 460800 8N1, SmartBLE coprocessor |
| Battery ADC | PB1 (ADC1 ch9) + Vref ch17 | |
| Encoder | C6 / C7 | 1 encoder |
| Matrix | 6 × 15 = 90 positions | |
