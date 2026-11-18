# YUNZII AL80: Reverse-Engineering Wiki

This wiki is a self-contained reference for the color LCD panel of the YUNZII AL80 mechanical
keyboard and for its custom-firmware ecosystem. A person or an AI can use it to start the project
again with no other context.

This wiki puts the single-file `AL80_KNOWLEDGE_BASE.md` into sections that are easy to browse. The
single file at the repo root is still the canonical source. The HID + `PK_*` display protocol of
the keyboard is fully decoded. The decoded items are:

- The 12-hour clock hack.
- Still-image and GIF streaming.
- The picture DISPLAY/commit sequence (`PK_ADD_PIC`).
- The confirmed pixel format (RGB565 big-endian, **row-major**) and resolution (96×160).
- Custom-QMK and hardware RE.

!!! tip "TL;DR"

    - The HID + `PK_*` display protocol is **fully decoded**: clock, still images, GIFs, and the picture display/commit sequence.
    - The panel is **96×160 portrait, RGB565 big-endian, row-major**. Column-major data shows the image sideways.
    - The canonical source is still the single-file `AL80_KNOWLEDGE_BASE.md` at the repo root. This wiki puts its content into sections.

!!! tip "Read the newest ground truth first"
    The **[Display commit (PK_*)](protocol/display-commit.md)** page records the 2026-07-04 unlock.
    It tells how to *show* a picture: `PK_ADD_PIC`, two mandatory settles, and **no** trailing view
    switch. It retires two earlier theories:

    - The panel is **row-major**. Column-major data shows the image sideways.
    - The red/blue banding was **dropped bytes from unpaced blasting**. The fix is to ACK-gate each
      block. The cause was not a per-scanline parity slip or a byte-swap.

## 📖 What this is

A separate smart display module drives the LCD of the AL80. The STM32F103 keyboard MCU does not
render pixels. It forwards the HID stream from the host over USART3. All of the data in this wiki
comes from these sources:

- Live HID captures of the vendor web app.
- A Thumb-2 disassembly of two official firmware bins.
- The sibling b75Pro QMK source.

The companion browser app that drives all of this is in the sibling `al80-studio` repo. It is a
WebHID control panel and it has no build step.

## 🔧 Start here

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
- Stock firmware in use: **Ripple Lighting Firmware** (YUNZII official v1.21). In the past, this
  firmware stayed intact, and all keymap work used **VIA** (usevia.app) with no recompile. A
  **custom vial-QMK** build now also exists (see [Custom QMK](firmware/custom-qmk.md)).
- The vendor controls the LCD with a WebHID web app at `https://yunzii-game.com/#/screen`. The
  keyboard must be **wired** for VIA and for the vendor app.
- Only **one process** can hold the `0xFF60` HID interface at a time. Close the vendor tab and VIA
  before you run a host script.
- The AL80 is not in the mainline QMK repo. A partial community source is at
  `github.com/ArgentStonecutter/keyboards` (`yunzii/al80`). This source does not include the ripple
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
LCD ops are above that range. For this reason, only one process can hold the interface. The
[Hardware](hardware/index.md) page gives the full device-identity and interface data.
