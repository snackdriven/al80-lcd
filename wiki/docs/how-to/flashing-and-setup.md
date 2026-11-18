---
title: Flashing & setup
status: confirmed
type: how-to
scope: Flash the custom vial-qmk firmware with QMK Toolbox, drive it from al80-studio, and go back to stock
---

# Flashing & setup

Use this page to put the custom firmware on a YUNZII AL80 and control it.

!!! tip "TL;DR"

    - Download **QMK Toolbox** and the firmware **`.bin`** from Releases.
    - To enter the bootloader, **hold ESC and connect the USB cable**.
    - Flash the `.bin` in QMK Toolbox. Then control the screen/lighting from **al80-studio** in Chrome.
    - To undo all of it, flash the stock `RIPPLE.bin` back with the same procedure.

The page starts from zero, so you don't need any QMK experience.

## ⚠️ Before you start

- This procedure replaces the stock firmware with a custom **vial-qmk** build. It is reversible (the stock `.bin` is in the release assets). But you flash at your own risk.
- You keep all keys, the LCD, the RGB, and the side bar. You also get these features:
    - Vial keymapping.
    - VialRGB (including reactive effects).
    - An independently-coloured side bar.
    - A **working per-layer knob** (volume / RGB brightness / RGB hue / media by layer).
    - Instant caps/num-lock LCD icons.
    - Battery telemetry.
    - Full LCD control from the browser.
- The bootloader is sticky. **ESC + plug** always gets you back to a flashable state. Thus a bad flash is not a brick.

## 📦 What you need

- A **YUNZII AL80** keyboard and its USB cable.
- **QMK Toolbox**: [github.com/qmk/qmk_toolbox/releases](https://github.com/qmk/qmk_toolbox/releases) (Windows or macOS).
- The firmware **`.bin`** from this project's Releases page. Get the latest (currently **v1.3.0**).
- **Chrome** (or any Chromium browser) for the control app. [WebHID](../reference/glossary.md) needs it.
- *(Optional)* **Vial**: [vial.rocks](https://vial.rocks). Use it to remap keys and RGB.

## 🔌 Step 1 — Enter the bootloader (DFU)

1. Disconnect the USB cable from the keyboard.
2. Push and **hold the ESC key** (top-left). While you hold ESC, **connect the USB cable**.
3. Release ESC.

    The keyboard is now in **stm32duino [DFU](../reference/glossary.md)** mode. The lights and the LCD are off. This is normal.

*(Windows only: if QMK Toolbox does not see a DFU device, install the WinUSB driver for it with [Zadig](https://zadig.akeo.ie/). In Zadig, select the "STM32 BOOTLOADER" device and install WinUSB.)*

## ⚡ Step 2 — Flash it

1. Open **QMK Toolbox**.
2. In QMK Toolbox, select **Open**.
3. Select the firmware `.bin`.
4. Keep the microcontroller setting on auto. (The microcontroller is an STM32F103.)
5. Select **Flash**.

    QMK Toolbox erases and then writes the flash.

6. Wait for **"Flash complete."**
7. Disconnect the USB cable.
8. Connect the USB cable again normally.

    The lights and the LCD come back on. The keyboard now has the custom firmware.

## 🖥️ Step 3 — Drive the screen + lighting

You control the keyboard from **al80-studio**, a browser app (no install).

!!! warning "Only one app can hold the keyboard at a time"
    Close the YUNZII web app and VIA before you connect al80-studio.

1. Close the YUNZII web app and VIA. **Only one app can hold the keyboard at a time.**
2. Open al80-studio in Chrome.
3. Select **Connect**.
4. Select the AL80.
5. To push a clock, a still image, or a GIF to the screen, use the **LCD** tab.
6. To pick an RGB effect, colour, brightness, and speed, use the **Lighting** tab.

    This tab speaks VialRGB, the custom firmware's lighting system.

## ⌨️ Step 4 (optional) — Remap keys

Use Vial for the keymap, layers, macros, and per-key RGB:

1. Open **[vial.rocks](https://vial.rocks)** in Chrome.
2. Connect the keyboard.

Changes are live, so you don't need to reflash.

## ↩️ Recovery — back to stock

To get the original firmware back, do these steps:

1. Enter the bootloader with the same procedure (**ESC + plug**).
2. Flash the stock **`RIPPLE.bin`** (in the release assets), or use the official YUNZII updater.

The steps are the same. Only the `.bin` is different.

## 🧩 Good to know

- **Chip:** STM32F103x8, with 56 KB app flash and 20 KB RAM. That's not much space, so the firmware features are picked carefully.
- **Known-good fallback:** v1.0.0. If a newer version misbehaves, flash v1.0.0 again. It's the stable baseline for the other versions.
- **The screen is a separate smart module.** The keyboard forwards your images to it over an internal serial link. That's why the LCD keeps working on custom firmware.
