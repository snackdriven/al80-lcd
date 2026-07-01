# AL80 LCD

Reverse-engineering the YUNZII AL80's LCD panel over raw HID, plus the tooling that came out of it. The headline result: a **12-hour clock** on the LCD without reflashing (the stock ripple-lighting firmware stays in place).

## What's here

| Path | What it is |
|------|-----------|
| [`AL80_KNOWLEDGE_BASE.md`](AL80_KNOWLEDGE_BASE.md) | The full write-up (**v2**): device identity, HID protocol, the 12hr hack, **confirmed display specs + image-stream format**, a custom-frame render recipe, open questions, and safety warnings. Start here. |
| [`AL80_KNOWLEDGE_BASE_v1.md`](AL80_KNOWLEDGE_BASE_v1.md) | Superseded v1, kept for a few granular capture samples and per-interface details v2 compressed out. |
| [`tooling/`](tooling/) | Runnable clock-sync scripts (Node + Python), launchers, and a no-install browser-console version. |
| [`research/`](research/) | Raw material: annotated + raw HID captures, device descriptors, unique-packet table, the site's JS bundle, and the `image_capture/` test pattern used to confirm the display resolution. |
| [`firmware/`](firmware/) | Reference copy of the ripple-lighting firmware this project is built around. Do not reflash casually. |
| [`lcd-images/`](lcd-images/) | Backup of the GIFs currently loaded on the LCD panel. |
| [`keymap/`](keymap/) | VIA/QMK keymap export (the layout from the knowledge base, §8). |
| [`apps/`](apps/) | Version-pinned vendor tools: YUNZII's LCD screen app and QMK Toolbox. |

## The short version

The AL80 exposes 4 HID interfaces; only `usagePage 0xFF60 / usage 0x61` (the VIA/raw interface) drives the LCD. Screen operations are a 3-packet sequence over 64-byte reports (report ID 0):

```
h     = (hour24 % 12) || 12
cksum = (0x41 + 0x03 + h + minute + second) & 0xFF

announce  40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1
time      41 00 00 03 <cksum> 00 00 <h> <minute> <second>
finish    42 00 00 38 7A
```

The LCD displays the raw hour value it's given, so sending `1–12` instead of `0–23` yields a 12-hour clock. There's no AM/PM indicator, and the keyboard free-runs its own clock from the last value set, so the scripts re-sync every ~60s to fight drift.

VID `0x28E9` / PID `0x30AF`. Keyboard must be wired. Only one process can hold the `0xFF60` interface at a time, so close the yunzii-game.com tab before running a script.

**Display (confirmed):** 112×137 px, portrait, **RGB565 big-endian**, row-major from top-left — 30,688 bytes per full frame. The web app resamples any uploaded image down to native res, so render custom graphics directly at 112×137. Full render recipe in the knowledge base, §12.

## Quick start

Node:
```
cd tooling
npm install node-hid
node al80_clock.js --once   # test; LCD should update
node al80_clock.js          # 60s re-sync loop
```

Python:
```
cd tooling
pip install hidapi
python al80_clock.py --once
python al80_clock.py
```

See [`tooling/README.md`](tooling/README.md) for launchers and auto-start-at-login.

## Status

- **Done & shipped:** 12hr clock sync (confirmed working), full tooling.
- **Confirmed (v2):** display resolution (112×137) and pixel format (RGB565 BE), image-stream packet structure, and that the `0xFF60` LCD interface only accepts `0x40`/`0x41`/`0x42` (NAKs everything else). The "live info panel" idea is now fully feasible — format and resolution are known.
- **Open:** the `0x40` announce checksum formula, the presumed CRC16 at byte[12,13], the exact width/height/length encoding in the image announce/setup header, and GIF frame framing/timing. Details in the knowledge base, §9.

## Links

Everything you need to work on this keyboard, in one place:

| Link | What it's for |
|------|---------------|
| [usevia.app](https://usevia.app/) | VIA configurator — the only way keymap changes are made here (load `keymap/AL80_QMK__V0106_20251219.json`). No firmware recompile. |
| [yunzii.com/pages/software](https://www.yunzii.com/pages/software) | YUNZII's downloads: firmware (incl. the ripple build in `firmware/`) and the LCD screen app (`apps/`). |
| [yunzii-game.com/#/screen](https://yunzii-game.com/#/screen) | The WebHID LCD screen app — uploads images/GIFs to the panel. Its JS bundle is captured in `research/site_assets/`. Close this tab before running the clock scripts (one opener of the `0xFF60` interface at a time). |
| [docs.qmk.fm](https://docs.qmk.fm) | QMK reference — keycodes, layers, `LT()`/macros used in the keymap. |

## Safety

Commands `0xB0–0xB7` are bootloader / firmware-upgrade (DFU). **Don't touch them** — they can brick the device or wipe the ripple firmware, which is the whole reason for the HID-script approach. Stick to `0x40`/`0x41`/`0x42`.

## Note on `research/site_assets/`

Those files are YUNZII's own web-app assets (from yunzii-game.com), kept here only as reference for decoding the packet builders. They're not my work and carry their original copyright.
