---
title: Homepage widgets
status: in-progress
type: reference
updated: 2026-07-06
scope: The homepage gauge protocol, boot handshake, and the v16 port
---

# Homepage widgets

Use this page to look up how the firmware feeds the homepage gauges: the boot handshake, the v16
port, and the battery read.

The display module draws the homepage gauges (connection, OS, caps/num/win lock, battery). The
keyboard feeds the gauges with 1-byte [`PK_*`](../reference/glossary.md) status packets. This page
covers the firmware side. The packet format is on [Display commit (PK_*)](../protocol/display-commit.md).

## 🔧 Boot handshake

[b75Pro](../reference/glossary.md) `keyboard_screen.c` runs a `screen_boot_step` state machine. At
boot, it pings `PK_CONN_TYPE` while the screen powers on. Then it pushes the full widget batch to
set up (init) the homepage.

!!! warning "Battery is part of the batch"
    The battery gauge is init'd **as part of that batch**. A lone `PK_BATT_QUANTITY` possibly has
    no widget to fill. This is why the gauge went empty on custom firmware after the first image
    push. The module kept the stock widget state until the push cleared it, and the passthrough
    never re-inits.

## ⚙️ The port (v16)

`AL80_CUSTOM_QMK_v16_homepage.bin` ports this handshake. `al80_homepage_init()` sends these
packets:

| Packet | When |
|---|---|
| The full batch | At boot, 4× over ~6 s |
| The full batch | Every 30 s (self-heal) |
| The battery | Every 10 s |

It **replaces** v15's lone-battery push. It's **untested** on-device. `VREF_CAL=1489` (12-bit) can
be calibrated. The charge status is hardcoded 0.

## 🔋 Battery read

| Item | Value |
|---|---|
| Input | ADC1 ch9 (**PB1**) + the internal Vref ch17 |
| Formula | `mv = adc*1764/vref` |
| Piecewise thresholds | 3200 mV (empty) … 4150 mV (full) |
| Sampling | median-of-10 (drop min/max, average the middle 8), 10-bit, piecewise-linear % |
| Source | b75Pro `smart_ble.c` / `battery.c` / `adc.c` (the strings match the AL80 binary) |

See [Hardware](../hardware/index.md).
