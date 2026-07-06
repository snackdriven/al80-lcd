# Roadmap — options we haven't built

!!! tip "TL;DR"

    - Two whole feature classes cost the firmware **zero flash**: host-side app work, and 1-byte `PK_*` status packets over the USART3 link that's already wired.
    - The b75Pro enum has display opcodes we've never sent — `PK_LIGHT_MODE` (0x08), a native 12/24-hour toggle, and a big-typed-letter mode drawn by the module.
    - Flash is the wall: **56 KB app**, and after the v20 reactive build there's **~2.9 KB left**. Cheap wins rank first.

Mined 2026-07-06 from the b75Pro sibling source, `RIPPLE.bin`, and this KB. Every item cites where it came from, so it's checkable, not invented.

!!! success "Shipped since this survey"
    - **Per-layer encoder** — done and confirmed on-device (v1.3.0). L0 volume, L1 RGB brightness, L2 RGB hue, L3 media. Built as a hardcoded `encoder_update_user`, not `ENCODER_MAP` — the encoder isn't in this board's Vial/VIA layout, so `ENCODER_MAP` was invisible.
    - **Independent side LED bar** — shipped in v1.2.0 (opcodes 0x46/47/48). The status-meter idea below is the next step on top of it.
    - **Instant caps/num-lock LCD icons** — in progress via a `led_update_kb` hook, landing in **v1.3.0** once a lag regression is fixed.

## 🎛️ Cheap firmware wins

| Option | Flash | Value | Where |
|---|---|---|---|
| **Screen power-off key** — toggle the C9 enable pin to blank the LCD. This is the "sleep" the KB said didn't exist (it's a GPIO, not an opcode). | ~100 B | high | `al80.c:347` |
| **RGB layer indicator** — tint a row per active layer via `rgb_matrix_indicators_advanced_kb()`. | ~300 B | high | KB §D6 |
| **RGB off on host sleep** — `RGB_MATRIX_SLEEP` isn't set. | ~50 B | med | `config.h` |
| **Host-free view-switch keys** — keycodes that emit `PK_GO_HOME` / `PK_TOGGLE_PIC` / `PK_GO_GIF`. | ~200 B | med | `mk25047.c:1412` |
| **Caps Word** — standard QMK, not enabled. | ~400 B | med | — |

## 📟 Native module features to probe first

Send-and-watch on-device *before* spending flash — the display module may already draw these (unconfirmed on the AL80). Source: b75Pro `mk25047/uart_mod.h:26-59`, `keyboard_screen.c:217-390`.

- **`PK_LIGHT_MODE` (0x08)** — a lighting icon/name on the homepage.
- **`PK_SWITCH_TIME`** — a real 12/24-hour toggle. Would retire the whole host-side "12-hour hack."
- **`PK_LETTER_SHOW` / `PK_LETTER_OFF`** — the letter you just typed, drawn large by the module. No pixel/framebuffer cost.

## 🖼️ Zero-firmware-flash (host-side app)

- **Startup boot animation** (mode-0 GIF) — a vendor button we never exposed.
- **Live status cards on the LCD** — weather, next calendar event, the wedding countdown (bot already exists), a Pomodoro ring. All ride the solved picture pipeline. Real dependency: the always-on host, so it survives a closed browser tab (`research/al80-always-on-host-SPARC.md`).

## 🔦 Side bar as a status meter

The bar is **3 LEDs already in the matrix at indices 76–78** (driver 1 / CS pin C8), flagged keylight — which is why they match the keys today. Override those three in `rgb_matrix_indicators_advanced_kb()` (~150 B, RAM ~3 B) to drive a battery / caps / layer / notification meter, with a bar-color command mirroring the existing palette protocol (0x43-0x45).

## 🚫 Not worth it (given the 56 KB ceiling)

- **Bluetooth / 2.4G on custom** — expensive, and going wireless is *less* control per our own RE (§D5). The radio is a separate coprocessor taking only 3 inbound commands.
- **Autocorrect** — the dictionary blob is too big when you're cutting features to fit.
- **Hardware RTC port** — medium flash and needs the LSE/backup domain; the 60s host re-sync already makes drift moot.
- **More framebuffer RGB effects** — each one is exactly the flash you're reclaiming.

## ⭐ Top 3

Per-layer encoder shipped (v1.3.0), so the next-best value-per-byte:

1. **Screen power-off key** — ~100 B, reuses the C9 enable already in `al80.c`, and closes something the KB wrongly concluded was impossible (it's a GPIO, not an opcode).
2. **Side bar as a status meter** — the independent bar colour is already shipped (v1.2.0); the remaining step is driving those three LEDs off battery / caps / layer state (~150 B).
3. **Probe the undocumented PK opcodes** — a 30-minute send-and-watch, not a build. Highest upside in the survey at near-zero cost; tells you which native features are real before you spend flash.
