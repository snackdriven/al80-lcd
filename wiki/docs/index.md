# YUNZII AL80: Reverse-Engineering Wiki

Self-contained reference for the YUNZII AL80 mechanical keyboard's color LCD panel and
its custom-firmware ecosystem, enough to resume the project cold, by a human or an AI.

This wiki reorganizes the single-file `AL80_KNOWLEDGE_BASE.md` (still the canonical source at the
repo root) into browsable sections. The keyboard's HID + `PK_*` display protocol is fully
decoded: the 12-hour clock hack, still-image and GIF streaming, the picture DISPLAY/commit
sequence (`PK_ADD_PIC`), the confirmed pixel format (RGB565 big-endian, **row-major**) and
resolution (96×160), plus custom-QMK and hardware RE.

!!! tip "TL;DR"

    - The HID + `PK_*` display protocol is **fully decoded**: clock, still images, GIFs, and the picture display/commit sequence.
    - Panel is **96×160 portrait, RGB565 big-endian, row-major** — column-major renders sideways.
    - Canonical source is still the single-file `AL80_KNOWLEDGE_BASE.md` at the repo root; this wiki reorganizes it.

!!! tip "Read the newest ground truth first"
    The **[Display commit (PK_*)](protocol/display-commit.md)** page is the 2026-07-04 unlock —
    how to actually *show* a picture (`PK_ADD_PIC` + two mandatory settles + **no** trailing view
    switch). It retires two earlier theories: the panel is **row-major** (column-major renders
    sideways), and the red/blue banding was **dropped bytes from unpaced blasting** (fix =
    ACK-gate each block), not a per-scanline parity slip or a byte-swap.

## 📖 What this is

The AL80's LCD is driven by a separate smart display module: the STM32F103 keyboard MCU doesn't
render pixels; it forwards the host's HID stream over USART3. Everything here was derived
from live HID captures of the vendor web app, a Thumb-2 disassembly of two official firmware bins,
and the sibling b75Pro QMK source. The companion browser app that drives all of this lives in
the sibling `al80-studio` repo (a WebHID control panel; no build step).

## 🔧 Start here

<div class="grid cards" markdown>

- :material-protocol: **[Protocol reference](protocol/index.md)**

    HID framing, checksums/CRC, time/date, still images, GIFs, the `PK_*` display commit, chunking
    and pacing, and the full byte-map.

- :material-chip: **[Firmware](firmware/stock-and-disassembly.md)**

    Stock "ripple" firmware, the custom vial-QMK build, VIA keymap on stock, homepage widgets.

- :material-memory: **[Hardware](hardware/index.md)**

    Device identity, the 96×160 panel, the aw20216s LED bar, wireless/battery, pin map (LCD enable
    = **C9**).

- :material-book-open-variant: **[How-to guides](how-to/render-a-frame.md)**

    Render a custom 96×160 frame, the 12-hour clock + tooling, live Spotify now-playing.

</div>

## ⚠️ Context & constraints

- Keyboard: **YUNZII AL80** with a small color **LCD panel**.
- Stock firmware in use: **Ripple Lighting Firmware** (YUNZII official v1.21). Historically kept
  intact, all keymap work done via **VIA** (usevia.app), no recompile. A **custom vial-QMK** build
  now also exists (see [Custom QMK](firmware/custom-qmk.md)).
- The vendor controls the LCD via a WebHID web app at `https://yunzii-game.com/#/screen`. The
  keyboard must be **wired** for both VIA and the vendor app.
- Only **one process** can hold the `0xFF60` HID interface at a time. Close the vendor tab/VIA
  before running any host script.
- AL80 is not in the mainline QMK repo. A partial community source exists at
  `github.com/ArgentStonecutter/keyboards` (`yunzii/al80`), minus the ripple effect.

## 🔌 Device identity

| Field | Value |
|---|---|
| Product name | AL80 Keyboard |
| Vendor ID / Product ID | **0x28E9** (10473) / **0x30AF** (12463) |
| LCD HID interface | usagePage **0xFF60**, usage **0x61** (raw / VIA) |
| Report ID / size | **0** (unnumbered) / **64** data bytes (in and out) |
| Display | **96 × 160 px** portrait, RGB565 big-endian, row-major |

The AL80 exposes 4 HID interfaces; only `0xFF60/0x61` drives the LCD and accepts the
`0x40/0x41/0x42` screen commands. It's the same interface VIA uses (VIA opcodes sit in the
`0x01–0x15` range; the LCD ops sit above them), which is why only one process can hold it. The full
device-identity and interface breakdown is on the [Hardware](hardware/index.md) page.
