# Flashing & setup

!!! tip "TL;DR"

    - Download **QMK Toolbox** + the firmware **`.bin`** from Releases.
    - Enter the bootloader: **hold ESC, plug in USB**.
    - Flash the `.bin` in QMK Toolbox, then drive the screen/lighting from **al80-studio** in Chrome.
    - To undo it all: flash the stock `RIPPLE.bin` back the same way.

A from-scratch walkthrough for putting the custom firmware on a YUNZII AL80 and driving it. No prior QMK experience assumed.

## ⚠️ Before you start

- This replaces the stock firmware with a custom **vial-qmk** build. It's reversible (stock `.bin` is in the release assets), but you're flashing at your own risk.
- You keep: all keys, the LCD, the RGB, and the side bar. You gain: Vial keymapping, VialRGB, and full LCD control from the browser.
- The bootloader is sticky — **ESC + plug** always gets you back to a flashable state, so a bad flash isn't a brick.

## 📦 What you need

- A **YUNZII AL80** keyboard + its USB cable.
- **QMK Toolbox** — [github.com/qmk/qmk_toolbox/releases](https://github.com/qmk/qmk_toolbox/releases) (Windows or macOS).
- The firmware **`.bin`** — from this project's Releases page (grab the latest, currently **v1.0.0**).
- **Chrome** (or any Chromium browser) for the control app — WebHID needs it.
- *(Optional)* **Vial** — [vial.rocks](https://vial.rocks) — for remapping keys and RGB.

## 🔌 Step 1 — Enter the bootloader (DFU)

1. Unplug the keyboard.
2. **Hold the ESC key** (top-left) and, while holding, **plug in the USB cable**.
3. Let go. The board is now in **stm32duino DFU** mode — no lights, no LCD, that's normal.

*(Windows only: if QMK Toolbox doesn't see a DFU device, install the WinUSB driver for it with [Zadig](https://zadig.akeo.ie/) — pick the "STM32 BOOTLOADER" device, install WinUSB.)*

## ⚡ Step 2 — Flash it

1. Open **QMK Toolbox**.
2. Click **Open**, choose the firmware `.bin`.
3. Leave the microcontroller on auto (it's an STM32F103).
4. Click **Flash**. You'll see it erase + write; wait for **"Flash complete."**
5. Unplug and replug normally. Lights and the LCD come back — you're on the custom firmware.

## 🖥️ Step 3 — Drive the screen + lighting

The keyboard is controlled from **al80-studio**, a browser app (no install):

1. Open al80-studio in Chrome. Close the YUNZII web app and VIA first — **only one app can hold the keyboard at a time**.
2. Click **Connect** and pick the AL80.
3. **LCD tab** — push a clock, a still image, or a GIF to the screen.
4. **Lighting tab** — pick an RGB effect, colour, brightness, speed (this speaks VialRGB, the custom firmware's lighting).

## ⌨️ Step 4 (optional) — Remap keys

For keymap, layers, macros, and per-key RGB, open **[vial.rocks](https://vial.rocks)** in Chrome and connect. Changes are live — no reflashing.

## ↩️ Recovery — back to stock

Want the original firmware back? Enter the bootloader the same way (**ESC + plug**) and flash the stock **`RIPPLE.bin`** (in the release assets), or use YUNZII's official updater. Same steps, different `.bin`.

## 🧩 Good to know

- **Chip:** STM32F103x8 — 56 KB app flash, 20 KB RAM. It's tight, which is why firmware features are picked carefully.
- **Known-good build:** v1.0.0. If a newer version misbehaves, reflash this one.
- **The screen is a separate smart module** — the keyboard forwards your images to it over an internal serial link. That's why the LCD keeps working on custom firmware.
