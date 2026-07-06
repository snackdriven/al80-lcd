---
title: Homepage widgets
status: in-progress
updated: 2026-07-06
scope: The homepage gauge protocol, boot handshake, and the v16 port
---

# Homepage widgets

The homepage gauges (connection, OS, caps/num/win lock, **battery**) are drawn by the display
module but **fed by the keyboard** as 1-byte `PK_*` status packets. This page is the firmware side;
the packet format lives on [Display commit (PK_*)](../protocol/display-commit.md).

## Boot handshake

b75Pro `keyboard_screen.c` runs a `screen_boot_step` state machine: on boot it pings `PK_CONN_TYPE`
while the screen powers up, then pushes the **whole widget batch** to init the homepage.

!!! warning "Battery is part of the batch"
    The battery gauge is init'd **as part of that batch** — a lone `PK_BATT_QUANTITY` may have no
    widget to fill. This is why the gauge went empty on custom after the first image push: the
    module kept stock's widget state until the push cleared it, and the passthrough never re-inits.

## The port (v16)

**`AL80_CUSTOM_QMK_v16_homepage.bin`** ports this: `al80_homepage_init()` sends the batch on boot
(4× over ~6 s) + every 30 s (self-heal) + battery every 10 s. It REPLACES v15's lone-battery push.
UNTESTED on-device. `VREF_CAL=1489` (12-bit) is calibratable; charge-status is hardcoded 0.

## Battery read

ADC1 ch9 (**PB1**) + internal Vref ch17, `mv = adc*1764/vref`, piecewise thresholds 3200 mV (empty)
… 4150 mV (full). Median-of-10 sampling (drop min/max, average the middle 8), 10-bit,
piecewise-linear %. Source: b75Pro `smart_ble.c` / `battery.c` / `adc.c` (strings match the AL80
binary). See [Hardware](../hardware/index.md).
