---
title: Homepage widgets
status: in-progress
updated: 2026-07-06
scope: The homepage gauge protocol, boot handshake, and the v16 port
---

# Homepage widgets

The display module draws the homepage gauges (connection, OS, caps/num/win lock, battery). The
keyboard feeds the gauges with 1-byte `PK_*` status packets. This page is about the firmware side.
The packet format is on [Display commit (PK_*)](../protocol/display-commit.md).

## 🔧 Boot handshake

b75Pro `keyboard_screen.c` runs a `screen_boot_step` state machine. At boot, it pings
`PK_CONN_TYPE` while the screen powers on. Then it pushes the full widget batch to init the
homepage.

!!! warning "Battery is part of the batch"
    The battery gauge is init'd **as part of that batch**. A lone `PK_BATT_QUANTITY` possibly has
    no widget to fill. This is why the gauge went empty on custom firmware after the first image
    push. The module kept the stock widget state until the push cleared it, and the passthrough
    never re-inits.

## ⚙️ The port (v16)

`AL80_CUSTOM_QMK_v16_homepage.bin` ports this handshake. `al80_homepage_init()` sends these
packets:

- The batch at boot (4× over ~6 s).
- The batch every 30 s (self-heal).
- The battery every 10 s.

It REPLACES the lone-battery push of v15. It is UNTESTED on-device. `VREF_CAL=1489` (12-bit) is
calibratable. The charge status is hardcoded 0.

## 🔋 Battery read

The battery read uses ADC1 ch9 (**PB1**) + the internal Vref ch17, with `mv = adc*1764/vref`. The
piecewise thresholds are 3200 mV (empty) … 4150 mV (full). The sampling is median-of-10 (drop
min/max, average the middle 8), 10-bit, piecewise-linear %. The source is b75Pro `smart_ble.c` /
`battery.c` / `adc.c` (the strings match the AL80 binary). Refer to [Hardware](../hardware/index.md).
