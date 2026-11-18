# Flashing & setup

!!! tip "TL;DR"

    - Download **QMK Toolbox** and the firmware **`.bin`** from Releases.
    - To enter the bootloader, **hold ESC and connect the USB cable**.
    - Flash the `.bin` in QMK Toolbox. Then control the screen/lighting from **al80-studio** in Chrome.
    - To undo all of it, flash the stock `RIPPLE.bin` back with the same procedure.

This page tells you how to put the custom firmware on a YUNZII AL80 and how to control it. It
starts from zero. You do not need prior QMK experience.

## ⚠️ Before you start

- This procedure replaces the stock firmware with a custom **vial-qmk** build. It is reversible (the stock `.bin` is in the release assets). But you flash at your own risk.
- You keep all keys, the LCD, the RGB, and the side bar. You gain these features:
    - Vial keymapping.
    - VialRGB (incl. reactive effects).
    - An independently-coloured side bar.
    - A **working per-layer knob** (volume / RGB brightness / RGB hue / media by layer).
    - Instant caps/num-lock LCD icons.
    - Battery telemetry.
    - Full LCD control from the browser.
- The bootloader is sticky. **ESC + plug** always gets you back to a flashable state. Thus a bad flash is not a brick.

## 📦 What you need

- A **YUNZII AL80** keyboard and its USB cable.
- **QMK Toolbox**: [github.com/qmk/qmk_toolbox/releases](https://github.com/qmk/qmk_toolbox/releases) (Windows or macOS).
- The firmware **`.bin`** from the Releases page of this project. Get the latest (currently **v1.3.0**).
- **Chrome** (or any Chromium browser) for the control app. WebHID needs it.
- *(Optional)* **Vial**: [vial.rocks](https://vial.rocks). Use it to remap keys and RGB.

## 🔌 Step 1 — Enter the bootloader (DFU)

1. Disconnect the USB cable from the keyboard.
2. Push and **hold the ESC key** (top-left). While you hold ESC, **connect the USB cable**.
3. Release ESC. The keyboard is now in **stm32duino DFU** mode. The lights and the LCD are off. This is normal.

*(Windows only: if QMK Toolbox does not see a DFU device, install the WinUSB driver for it with [Zadig](https://zadig.akeo.ie/). In Zadig, select the "STM32 BOOTLOADER" device and install WinUSB.)*

## ⚡ Step 2 — Flash it

1. Open **QMK Toolbox**.
2. Click **Open**.
3. Select the firmware `.bin`.
4. Keep the microcontroller setting on auto. (The microcontroller is an STM32F103.)
5. Click **Flash**. QMK Toolbox erases and then writes the flash.
6. Wait for **"Flash complete."**
7. Disconnect the USB cable.
8. Connect the USB cable again normally. The lights and the LCD come back on. The keyboard now has the custom firmware.

## 🖥️ Step 3 — Drive the screen + lighting

You control the keyboard from **al80-studio**, a browser app (no install):

1. Close the YUNZII web app and VIA. **Only one app can hold the keyboard at a time.**
2. Open al80-studio in Chrome.
3. Click **Connect**.
4. Select the AL80.
5. To push a clock, a still image, or a GIF to the screen, use the **LCD tab**.
6. To select an RGB effect, colour, brightness, and speed, use the **Lighting tab**. This tab speaks VialRGB, the lighting of the custom firmware.

## ⌨️ Step 4 (optional) — Remap keys

Use Vial for the keymap, layers, macros, and per-key RGB:

1. Open **[vial.rocks](https://vial.rocks)** in Chrome.
2. Connect the keyboard.

Changes are live. You do not need to reflash.

## ↩️ Recovery — back to stock

To get the original firmware back, do these steps:

1. Enter the bootloader with the same procedure (**ESC + plug**).
2. Flash the stock **`RIPPLE.bin`** (in the release assets), or use the official YUNZII updater.

The steps are the same. Only the `.bin` is different.

## 🧩 Good to know

- **Chip:** STM32F103x8, with 56 KB app flash and 20 KB RAM. This space is tight, so the firmware features are picked carefully.
- **Known-good fallback:** v1.0.0. If a newer version misbehaves, flash v1.0.0 again. It is the stable baseline for the other versions.
- **The screen is a separate smart module.** The keyboard forwards your images to it over an internal serial link. That is why the LCD continues to work on custom firmware.
