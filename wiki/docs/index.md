---
title: "YUNZII AL80: Reverse-Engineering Wiki"
status: index
type: overview
scope: Home page. What the wiki covers, where to start for each reader goal, and the device basics
---

# YUNZII AL80: Reverse-Engineering Wiki

Use this wiki to drive the color LCD on the YUNZII AL80 keyboard yourself, and to find the page you need for that.

!!! tip "TL;DR"

    - The HID + `PK_*` display protocol is **fully decoded**: clock, still images, GIFs, and the picture display/commit sequence.
    - The panel is **96×160 portrait, RGB565 big-endian, row-major**. Column-major data shows the image sideways.
    - The canonical source is still the single-file `AL80_KNOWLEDGE_BASE.md` at the repo root. This wiki puts its content into sections.

!!! tip "Read the newest ground truth first"
    The **[Display commit (PK_*)](protocol/display-commit.md)** page records the 2026-07-04 unlock.
    It shows how to actually *show* a picture: `PK_ADD_PIC`, two mandatory
    [settles](reference/glossary.md), and **no** trailing view switch. It retires two earlier
    theories:

    - The panel is **row-major**. Column-major data shows the image sideways.
    - The red/blue banding was **dropped bytes from unpaced [blasting](reference/glossary.md)**.
      The fix is to [ACK-gate](reference/glossary.md) each block. The cause wasn't a per-scanline
      parity slip or a byte-swap.

## 🧭 Where to start

Pick the goal that matches yours.

**You're new and want to try it** (tutorial):

- Put your own picture on the LCD in about 10 minutes, with no flashing: [Your first custom frame](tutorials/first-custom-frame.md).

**You want to do something** (how-to guides):

- Flash firmware or put the keyboard in bootloader mode: [Flashing & setup](how-to/flashing-and-setup.md).
- Build and send a picture yourself, without the app: [Render a custom frame](how-to/render-a-frame.md).
- Run the 12-hour clock: [Tooling & the 12-hour clock](how-to/tooling-and-clock.md).
- Show what Spotify is playing: [Now-playing](how-to/now-playing.md).

**You want to look something up** (reference):

- Constants, IDs and the frame layout in one table: [Quick reference](reference/quick-reference.md).
- Every command and byte offset: [Full byte-map reference](protocol/full-reference.md).
- A term you don't know: [Glossary](reference/glossary.md).
- What you must never send: [Safety / do-not-touch](reference/safety.md). Read it before you send anything.

**You want to understand why** (background):

- Why pictures banded and how a picture really gets shown: [Display commit](protocol/display-commit.md).
- What's worth building next, and what it costs in flash: [Roadmap](roadmap.md).
- How the project got here, including retired theories: [History / Changelog](history/changelog.md).

## 📖 What this is

This wiki covers the color LCD panel of the YUNZII AL80 mechanical keyboard and the custom
firmware built around it. It's meant to stand on its own: a person or an AI can restart the
project from it with no other context.

The wiki splits the single file `AL80_KNOWLEDGE_BASE.md` into sections that are easier to browse.
That file, at the repo root, is still the canonical source.

The keyboard's HID + `PK_*` display protocol is fully decoded. That covers:

- The 12-hour clock hack.
- Still-image and GIF streaming.
- The picture display/commit sequence (`PK_ADD_PIC`).
- The confirmed pixel format (RGB565 big-endian, **row-major**) and resolution (96×160).
- Custom QMK firmware and hardware reverse engineering (RE).

A separate smart display module drives the AL80's LCD. The STM32F103 keyboard MCU
(microcontroller) doesn't draw pixels. It just forwards the HID stream from the host over USART3.
Everything in this wiki comes from these sources:

- Live HID captures of the vendor web app.
- A Thumb-2 disassembly of two official firmware bins.
- The sibling b75Pro QMK source.

The companion browser app that drives all of this lives in the sibling `al80-studio` repo. It's a
WebHID control panel with no build step.

## 🔧 Browse by section

<div class="grid cards" markdown>

- :material-protocol: **[Protocol reference](protocol/index.md)**

    HID framing, checksums/CRC, time/date, still images, GIFs, the `PK_*` display commit, chunking
    and pacing, and the full byte-map.

- :material-chip: **[Firmware](firmware/stock-and-disassembly.md)**

    Stock "ripple" firmware, the custom vial-QMK build, VIA keymap on stock, and homepage widgets.

- :material-memory: **[Hardware](hardware/index.md)**

    Device identity, the 96×160 panel, the aw20216s LED bar, wireless/battery, and the pin map (LCD
    enable = **C9**).

- :material-book-open-variant: **[How-to guides](how-to/render-a-frame.md)**

    Render a custom 96×160 frame. Use the 12-hour clock and its tooling. Show live Spotify
    now-playing data.

</div>

## ⚠️ Context & constraints

- Keyboard: **YUNZII AL80** with a small color **LCD panel**.
- Stock firmware in use: **Ripple Lighting Firmware** (YUNZII official v1.21). In the past,
  this firmware stayed intact, and all keymap work used **VIA** (usevia.app) with no recompile. A
  **custom vial-QMK** build now also exists (see [Custom QMK](firmware/custom-qmk.md)).
- The vendor controls the LCD with a WebHID web app at `https://yunzii-game.com/#/screen`. The
  keyboard must be **wired** for VIA and for the vendor app.
- Only **one process** can hold the `0xFF60` HID interface at a time. Close the vendor tab and VIA
  before you run a host script.
- The AL80 isn't in the mainline QMK repo. A partial community source is at
  `github.com/ArgentStonecutter/keyboards` (`yunzii/al80`). It doesn't include the ripple
  effect.

## 🔌 Device identity

| Field | Value |
|---|---|
| Product name | AL80 Keyboard |
| Vendor ID / Product ID | **0x28E9** (10473) / **0x30AF** (12463) |
| LCD HID interface | usagePage **0xFF60**, usage **0x61** (raw / VIA) |
| Report ID / size | **0** (unnumbered) / **64** data bytes (in and out) |
| Display | **96 × 160 px** portrait, RGB565 big-endian, row-major |

The AL80 has 4 HID interfaces. Only `0xFF60/0x61` drives the LCD and accepts the `0x40/0x41/0x42`
screen commands. VIA uses the same interface. The VIA opcodes are in the `0x01–0x15` range, and the
LCD ops are above that range. For this reason, only one process can hold the interface. See
[Hardware](hardware/index.md) for the full device identity and interface data.
