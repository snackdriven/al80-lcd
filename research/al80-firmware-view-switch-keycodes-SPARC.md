# SPARC — AL80 host-free LCD view-switch keycodes (`process_record_kb`)

**Date:** 2026-07-10 · **Feature:** give the AL80 custom QMK firmware a `process_record_kb` + three host-free view-switch keycodes (HOME/clock, PICTURE, GIF) that switch the LCD on-device over USART3, no PC. **Status:** design, verified against source. **Foundation for** `al80-hotkey-panel-switch-SPARC.md` — this owns that doc's "Layer 1" (the local view switch + the `process_record` it needs); the hotkey SPARC adds `raw_hid_send` (the host signal) on top of the same `process_record_kb` + `al80_screen_view` helper defined here.

**Why it's needed (verified):** the custom firmware has **no `process_record` of any kind** (grep: only comments `al80.c:426`, `keymap.c:11`). The keymap author drove RGB via `encoder_update_user` + the `rgb_matrix_*` API (`keymap.c:6-40`) and never added a keycode handler. So the stock vendor's view-switch customs `CUSTOM(22/23/24)`=`0x7E16/17/18` (`wiki/docs/firmware/via-keymap.md:28-30`) **do nothing** on this build. Roadmap lists it unbuilt: "Host-free view-switch keys … ~200 B, ref `mk25047.c:1412`" (`roadmap.md:23`). The user runs the latest custom firmware, so on-device view switching doesn't exist until this ships.

---

## S — Specification

### Goal
Press a key → the LCD switches view (clock/home, picture, GIF) instantly, on the keyboard, no host. The vendor's `Scr_Home`/`Scr_Pic`/`Scr_Gif` behavior (`mk25047.c:1410-1440`) ported to the AL80 custom firmware, which lacks the `process_record_kb` those cases live in.

### Functional
- **FR1** Add `process_record_kb` to `al80.c` (none exists) — 3 custom keycodes, press-edge.
- **FR2** `AL80_KC_VIEW_HOME`/`_PICTURE`/`_GIF` valued to the VIA/Studio numbering `CUSTOM(22)=0x7E16`/`(23)=0x7E17`/`(24)=0x7E18`.
- **FR3** On press, emit the PK_GO view announce over USART3 (SD3): `0x0B` home, `0x0D` picture, `0x0F` gif — same bytes `protocol.js buildView(type)` sends host-relayed (`:207-213`).
- **FR4** Emission is **deferred through a flag** (mirror `locks_dirty`, `al80.c:134,159-163,442-445`): `process_record_kb` sets a `view_request`; a housekeeping pass flushes it when `!g_screen_busy`, so a view announce never interleaves with an in-flight image passthrough or the RGB SPI stream.
- **FR5** The keycodes are consumed (`return false`) — no HID keystroke.
- **FR6** Ship them on the Fn layer (layer 1) at Fn+9/8/0, mirroring stock, as fresh-board defaults; bindable to any key via Studio/Vial.
- **FR7** No host required (USART3 is independent of the USB raw-HID owner).

### Non-functional
- **NFR1** Reuse the USART3 discipline: the view helper mirrors `al80_battery_push` (`al80.c:89-98`) — `g_screen_busy=true` around `sdWrite(&SD3,…)`, short settle, clear.
- **NFR2** Never block the key path. `process_record_kb` sets one byte + returns — no `sdWrite`/`wait_us` in the handler (the v24 caps/num regression, `al80.c:127-133`, is the cautionary tale).
- **NFR3** Tiny flash — measure the delta against `__flash0_size__`/`.map`; headroom is real but finite (~2.9 KB after v20, `roadmap.md:7`).
- **NFR4** Host-mirrorable test — the per-keycode wire bytes are a pure 7-byte announce, unit-testable off-device vs `protocol.js buildView`.

### Scope / non-goals
In: `process_record_kb`; 3 view keycodes + enum; `al80_screen_view`/`al80_screen_send_view`; the `view_request` deferred flag + housekeeping consumption; keymap Fn+8/9/0 defaults; Studio preset (already present) + optional Vial labels. Out (hotkey SPARC): `raw_hid_send`, the keyboard→host `0x4B` signal, `cycler.jumpTo`, host reader. Out entirely: an on-device panel renderer; RGB-per-key feedback; global-hotkey daemons. Non-goal: random-access "show slot N" (no such opcode, R3).

### Constraints (verified)
| Constraint | Source |
|---|---|
| Custom fw has NO `process_record_kb`/`_user` — add from scratch | `al80.c:426` (comment); `keymap.c:11`; none `al80.c:348-461` |
| USART3 discipline: `g_screen_busy=true` around `sdWrite`, `wait_us(500)` | `al80_battery_push :89-98`; `al80_screen_send_u8 :80-85` |
| Deferred flag pattern in use (set in handler, consume in housekeeping when `!g_screen_busy`) | `locks_dirty :134,159-163,442-445` |
| Host-relayed view = only the announce (0x40 → `sdWrite` of `data[7..]`); the 0x42 finish just clears `g_screen_busy`, writes nothing to SD3 | `raw_hid_receive_kb :350-373` |
| Wire = `announce(type,0,0)+finish()`; `VIEW.HOMEPAGE=0x0b/PICTURE=0x0d/GIF=0x0f` | `protocol.js:207-213` |
| `0x0D` PK_TOGGLE_PIC **advances the ring** — not a neutral "show picture page" | `KB:112-127,993-998`; `protocol.js:234-241` (`buildNextPicture`==`buildView(PICTURE)`) |
| `CUSTOM(n)`↔`0x7E00+n`; `QK_KB_0==0x7E00` | `keymap.js:545,614` |
| Stock: `CUSTOM(22)=0x7E16` HOME/Fn+9, `(23)=0x7E17` PICTURE/Fn+8, `(24)=0x7E18` GIF/Fn+0 | `via-keymap.md:28-30`; `KB:196-198` |
| Studio already binds these (`PRESETS['LCD view']` + `LCD_VIEW_BINDINGS` Fn+8/9/0) | `keymap.js:85-89,175-193` |
| Flash headroom ~2.9 KB after v20 | `roadmap.md:7` |
| Fn layer = layer 1 (`MO(1)`); layer-1 number row all `_______` today | `keymap.c:49,53` |

---

## P — Pseudocode
```c
process_record_kb(keycode, record):            // NEW in al80.c
  switch (keycode):
    case AL80_KC_VIEW_HOME:    if (record->event.pressed) view_request=VIEW_HOME; return false; // 0x0B, consume
    case AL80_KC_VIEW_PICTURE: if (record->event.pressed) view_request=VIEW_PIC;  return false; // 0x0D (advances ring — R3)
    case AL80_KC_VIEW_GIF:     if (record->event.pressed) view_request=VIEW_GIF;  return false; // 0x0F
    default: return process_record_user(keycode, record);
  // held custom keycodes are NOT re-invoked -> one fire per press, no repeat storm

housekeeping_task_kb():                         // EXISTING al80.c:437 — add one check
  if (!g_screen_busy):
    if (view_request){ uint8_t v=view_request; view_request=0; al80_screen_view(v); }  // deferred flush, mirrors locks_dirty :442
    ... existing locks_dirty / boot-init / battery unchanged ...

al80_screen_view(view):                         // mirror al80_battery_push :89-98
  g_screen_busy=true; al80_screen_send_view(view); wait_us(500); g_screen_busy=false; screen_busy_wd=0;

al80_screen_send_view(type):                    // mirror al80_screen_send_u8 :80-85, but len byte 0x00 (no data)
  crc = al80_crc16([type,0x00,0x00], 3);        // reuse existing CRC16-MODBUS :70
  pkt = {0xA5,0x5A, type, 0x00,0x00, crc>>8, crc};  sdWrite(&SD3, pkt, 7);   // 7 bytes, not 8
```
Latency: keypress → handler (sub-ms, sets a byte) → next housekeeping (~1 ms) → 7-byte announce @921600 (~80 µs). Effectively instant, never contends with an image transfer (flush is `!g_screen_busy`-gated).

---

## A — Architecture

### A1. Keycode enum (values pinned to VIA/Studio numbering)
In `al80.h` (currently only the palette, `:8-24`). Anchor at `QK_KB_0` so values land on `CUSTOM(22/23/24)`; the 0-21 gap preserves alignment with factory customs Studio references (`keymap.js:93-106`):
```c
enum al80_keycodes {
  AL80_KC_VIEW_HOME = QK_KB_0 + 22,   // 0x7E16 CUSTOM(22) PK_GO_HOME 0x0B
  AL80_KC_VIEW_PICTURE,               // 0x7E17 CUSTOM(23) PK_TOGGLE_PIC 0x0D
  AL80_KC_VIEW_GIF,                   // 0x7E18 CUSTOM(24) PK_GO_GIF 0x0F
};
```
The hotkey SPARC extends THIS enum with `CUSTOM(25..29)` — that's the seam.

### A2. `process_record_kb` — port of `mk25047.c:1410-1440`
The vendor sets `SET_FLAG(kb_screen.flag, PK_GO_*)` (`:1416-1417`) consumed by a screen task (`keyboard_screen.c:333-340` → `uart_mod_pack(…,PK_GO_HOME,…)`). The AL80 has no `kb_screen` but has the same idea in `locks_dirty` (`al80.c:159-163` set, `:442-445` consume). Port: replace `SET_FLAG` with `view_request=VIEW_*`; replace the vendor's `uart_mod_pack` with `al80_screen_view` in `housekeeping_task_kb`. Press-edge, `return false`, `default:` → weak `process_record_user`.

### A3. `al80_screen_view` + `al80_screen_send_view`
`al80_screen_send_u8` (`:80-85`) sends a **status** packet `A5 5A type 00 01 crcHi crcLo <val>` (len byte 0x01, one data byte). A **view announce** has ZERO data → len byte 0x00, no trailing value → **7-byte** packet, not 8. That one-byte difference is why a dedicated helper beats overloading. Wrap it in `g_screen_busy` discipline like `al80_battery_push`. Reuse `al80_crc16` (`:70-77`, CRC16-MODBUS, == `protocol.js ga`).

### A4. Exact wire bytes per keycode (ready to assert)
CRC16-MODBUS over `[type,0,0]`, big-endian hi/lo:
| Keycode | View | type | CRC | USART3 bytes (7) |
|---|---|---|---|---|
| VIEW_HOME | HOMEPAGE/clock | 0x0B | 0x0200 | `A5 5A 0B 00 00 02 00` |
| VIEW_PICTURE | PICTURE | 0x0D | 0x03E0 | `A5 5A 0D 00 00 03 E0` |
| VIEW_GIF | GIF | 0x0F | 0xC341 | `A5 5A 0F 00 00 C3 41` |
These equal the payload half of `buildView(type)` (`:207-213`) — the same bytes the host relays via `raw_hid_receive_kb` (which `sdWrite`s only `data[7..]`, `al80.c:359`). The `finish()` (0x42) maps host-side to `g_screen_busy=false` (`:370-372`), writes nothing to SD3 — so `al80_screen_view` sends the announce only and manages `g_screen_busy` itself.

### A5. Deferred flag placement
`view_request` = `static volatile uint8_t` next to `locks_dirty` (`:134`). Multiple presses coalesce to the last (single byte). Consume at the top of the `!g_screen_busy` block in `housekeeping_task_kb` (`:441`), beside the `locks_dirty` flush — same context/gate/task. (`matrix_scan_kb :430` runs more often but doesn't hold the co-located `!g_screen_busy` logic; keep deferred USART3 work in housekeeping.)

### A6. Keymap placement + the shadowing caveat
Layer 1 number row is all `_______` (`keymap.c:53`). Set Fn+8=PICTURE, Fn+9=HOME, Fn+0=GIF (mirror stock + `LCD_VIEW_BINDINGS` `keymap.js:175-179`). **⚠ Dynamic-keymap shadowing:** `keymap.c` defaults only apply on a FRESH EEPROM. VIA/Vial store the live keymap in emulated EEPROM that **survives a reflash** (why `al80_apply_dynamic_keymap_fixups` exists, `al80.c:478-510`). A user already on custom fw won't get these defaults from a reflash — they must bind via Studio/Vial (A7). **Recommend keymap.c defaults for fresh boards + Studio binding for existing users; do NOT force-seed via fixups** (the fixups explicitly refuse to fight a later user remap, `:500-503`).

### A7. Studio / Vial binding — mostly already done
**Studio: zero code change.** `PRESETS['LCD view']` maps the labels to `CUSTOM(22/23/24)` (`keymap.js:85-89`), `applyLcdViewKeys` stamps Fn+8/9/0 (`:175-193`), `keycodeToNumber('CUSTOM(23)')`→0x7E17 round-trips (`:545,614`). Once the firmware consumes the keycodes, the existing Studio buttons work. **Vial: optional** `customKeycodes` array in `vial.json` for labels (they bind + fire unlabeled without it; Vial indexes from `QK_KB_0`, so labeling `CUSTOM(22-24)` needs a 25-entry array with 0-21 placeholders — low value, Phase 2).

### A8. Boundary with the hotkey SPARC (compose, don't duplicate)
| Owned here (Layer 1) | Added by hotkey SPARC (Layer 2) |
|---|---|
| `process_record_kb` + `default:` fallthrough | 5 more cases (`CUSTOM(25-29)`) |
| enum `CUSTOM(22-24)` | enum `CUSTOM(25-29)` |
| `al80_screen_view`/`_send_view` | CALLS `al80_screen_view` + adds `al80_panel_req` (`raw_hid_send` 0x4B) |
| `view_request` flag + housekeeping flush | reuses the flush |
| — | host `_onData` 0x4B reader + `cycler.jumpTo` |
The hotkey SPARC already assumes this ("wire 0x7E16-18 through the same helper", `hotkey-SPARC:139`).

---

## R — Refinement

### R1. Deferred flag vs direct sdWrite — **choose deferred**
Direct write in the handler has two failure modes, both solved elsewhere by deferral: (1) **byte-shearing** — a direct `sdWrite` while an image passthrough is mid-flight (`g_screen_busy`, `:366`) interleaves the 7 announce bytes into the image stream (exactly what `g_screen_busy` prevents, `:18-21`); (2) **typing stall** — a blocking `sdWrite`+`wait_us(500)` in the per-key handler repeats the v24 regression (`:127-133`). The vendor defers; the AL80 already ships this for lock LEDs. Reuse it. Cost: ~1 ms worst-case latency — imperceptible.

### R2. g_screen_busy interaction
`al80_screen_view` sets `g_screen_busy` for its own ~500 µs (like battery push), won't collide with the RGB SPI flush. The housekeeping flush only runs when `!g_screen_busy`, so it can't fire during a host image push. Watchdog (`:431`) clears a stall. No new race — slots into the same single-writer discipline as battery/locks/homepage-init.

### R3. Picture opcode — `PK_TOGGLE_PIC (0x0D)` is the only picture keycode, and it advances the ring
The KB is explicit (`KB:112-127`): 0x0D = "advance to the NEXT stored slot (NOT 'show this frame')", and **there is no random-access "show slot N" opcode** — pictures are slot-based + cyclic. Studio agrees: `buildNextPicture()` IS `buildView(PICTURE)` (`:234-241`). **Resolution: 0x0D is correct — it's exactly what the vendor ships for `Scr_Pic` (`mk25047.c:1427`).** From a non-picture view, press 1 switches TO the picture page (showing whatever slot the cursor lands on); subsequent presses cycle. Documented, expected. NB: the "never send 0x0D after a still-image upload" warning is a HOST-upload concern (it'd skip the just-committed frame), not a standalone view-key concern (advancing IS the point). HOME (0x0B) + GIF (0x0F) are unambiguous → Phase 1; PICTURE waits for an on-device confirm.

### R4. Flash budget — measure
Estimate: `process_record_kb` (~40 B) + 3 cases (~30 B) + `al80_screen_view`/`_send_view` (~70 B) + flag + housekeeping check (~15 B) ≈ **~150-200 B**, matching the roadmap ~200 B. Headroom ~2.9 KB (`roadmap.md:7`) → fits, but confirm empirically (`.map` delta + `__flash0_size__`). Levers if tight: `config.h` effect toggles `:87-122`, `keymaps/vial/rules.mk TAP_DANCE/COMBO/KEY_OVERRIDE=no`.

### R5. Reuse 0x7E16-18, don't mint fresh
Reusing the stock values means Studio's existing `PRESETS['LCD view']`/`LCD_VIEW_BINDINGS` light up with zero code change, the wiki stays accurate, and existing exported keymap JSON keeps working. No collision (nothing consumes 0x7E16-18 today). Minting fresh would orphan all that for no benefit.

---

## C — Completion

### C1. Phased plan
- **Phase 1 — `process_record_kb` + HOME + GIF (unambiguous pure switches).** Enum (`al80.h`), the handler with HOME (0x0B) + GIF (0x0F), `al80_screen_view`/`_send_view`, the flag + housekeeping flush. Bind Fn+9/Fn+0 in `keymap.c` layer 1. On-device: Fn+9→home, Fn+0→GIF; no typing/RGB regression; measure flash.
- **Phase 2 — PICTURE + verify ring-advance.** Add PICTURE (0x0D) + Fn+8. On-device: from home, one Fn+8 → picture page (a slot); repeat → cycle. Confirm the first press switches. Optional Vial labels.
- **(Handoff) Layer 2** = hotkey SPARC: same enum → `CUSTOM(25-29)`, same handler + 5 cases calling `al80_screen_view` + `raw_hid_send`.

### C2. Test plan
**Host-mirrorable (pure):** extract the announce builder as a pure fn; assert output == the A4 table per view and == payload half of `protocol.js buildView(type)[0].slice(7,14)`. CRC via `al80_crc16` == `protocol.js ga`.
**On-device smoke (the gate):** (1) flash Phase 1, Fn+9→home, Fn+0→GIF, instant. (2) regression: type a paragraph, spin the encoder, toggle caps/num, run an RGB effect — no stutter/dropped keys. (3) press a view key DURING a Studio image push (`g_screen_busy`) → image renders clean (no shear) + view switches after the transfer (proves the deferred gate). (4) Phase 2: Fn+8 from home → picture page; press again → next slot. (5) held key fires once. (6) no-host: close PC apps → view keys still switch.

### C3. Done criteria
Phase 1: Fn+9/Fn+0 switch home/GIF instantly; tests 1-3,5,6 green; flash delta within headroom. Phase 2: Fn+8 → picture + advances as designed; no keystroke leaks (verify with a text field focused). The helper + handler are shaped so the hotkey SPARC appends its 5 cases without touching this code.

### C4. Open questions / must-verify on-device
- **[verify]** the module accepts a PK_GO announce from the keyboard's OWN USART3 identically to a host-relayed one (almost certain — byte-identical wire, host path `sdWrite`s the same at `:359` — but never run end-to-end from a keypress).
- **[verify]** PICTURE first-press from a cold home view: does 0x0D switch TO the picture page on press 1?
- **[decide]** flush site: housekeeping (recommended) vs matrix_scan (marginally lower latency).
- **[note]** existing-board reality: users on custom fw get the keys via Studio binding, not the keymap.c default (shadowing, A6).

**Bottom line:** a faithful port of `mk25047.c:1410-1440` onto primitives this firmware already has — the vendor's `SET_FLAG(kb_screen.flag)`+screen-task maps 1:1 onto `locks_dirty`; `uart_mod_pack(PK_GO_*)` onto a 7-byte `al80_screen_view` mirroring `al80_battery_push`. The one genuinely new thing: this build has no `process_record` at all, so we add it — 3 cases, a helper, a flag, ~200 B. Two on-device verifies, then the hotkey SPARC extends the same enum + handler with its host signal.
