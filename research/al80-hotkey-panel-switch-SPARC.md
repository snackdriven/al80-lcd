# SPARC — AL80 Hotkey → LCD Panel

**Date:** 2026-07-10 · **Feature:** bind a physical AL80 key so pressing it makes the LCD show a specific *live, host-driven* panel (now-playing / weather / clock), plus optional `CYCLE_TOGGLE` / `PANEL_NEXT`. **Status:** design, verified against source. **Extends** `al80-lcd-panel-auto-cycle-SPARC.md` — the cycler already owns "show panel X" (`showPanel`/`idx`), so a hotkey is a thin driver of it, not a new subsystem.

**⚠ Read-first correction:** the on-device view switch (0x7E16/17/18) "works today, pure keymap" is true on the **stock vendor firmware** only. It is **NOT** true on the current custom QMK build in `qmkwork/vial-qmk/keyboards/yunzii/al80/`: `al80.c` has **no `process_record_kb`/`process_record_user` at all** (grep: the only `process_record` hit is a comment in `keymap.c:11`; the only `raw_hid_send` hit is a comment at `al80.c:426`). The 0x7E16-18 handlers lived in the vendor's `process_record`, which this firmware dropped. So on the custom build, binding `CUSTOM(22/23/24)` today does **nothing** — the keycode falls through VIA's dispatch and no PK_GO_* is emitted. This reshapes the phasing (C1). Flagged **[CORRECTION]**.

---

## S — Specification

### Goal (two layers)
- **Layer 1 — on-device VIEW switch.** Keyboard emits a PK_GO_* view command over USART3. Instant, no PC. But a view is home/picture/gif — can't distinguish now-playing from weather (both are host-committed picture-page content). Gives instant feedback + a graceful no-host fallback.
- **Layer 2 — host-driven PANEL switch (the real feature).** The keypress tells the HOST which live panel to render+refresh (`cycler.jumpTo('nowplaying')`). The keyboard can't fetch Spotify/weather, so it signals the host, which owns the single LCD handle.
Do BOTH in one keypress: fire the local view switch for instant feedback + send a host signal so the live panel refreshes.

### Functional
- **FR1** New firmware keycodes `PANEL_NOWPLAYING`/`PANEL_WEATHER`/`PANEL_CLOCK` in the AL80 custom range, handled in `process_record_kb`.
- **FR2** On press: (a) optionally emit the instant local view switch over USART3 (PICTURE for np/wx, HOME for clock), and (b) send a keyboard→host raw-HID report `[PANEL_REQ, panelId]`.
- **FR3** The host reader dispatches inbound `PANEL_REQ` → `cycler.jumpTo(panelId)`: set idx, refresh source, repaint, reset dwell.
- **FR4** Optional `CYCLE_TOGGLE` (pause/resume rotation) + `PANEL_NEXT` (advance one), same path, distinct ids.
- **FR5** Bind path: Studio Keymap tab writes the 16-bit keycode via `buildKeymapSet` (works today for any `CUSTOM(n)`); Vial needs the keycodes in its list for named picker entries.
- **FR6** Graceful degradation: no host → layer 1 still fires (view switch), no live refresh. Nothing holding the interface → same.
- **FR7** A held key must not spam switches (press-edge + debounce).

### Non-functional
- **NFR1** Reuse existing channels — no new HID interface/transport. Keyboard→host rides the same `raw_hid_send` path the ACK echoes use (`device.js:83` `_onData` reads every inputreport). Host→keyboard keymap write reuses `buildKeymapSet` (`protocol.js:520`).
- **NFR2** No keystroke pollution — the panel signal is a custom raw-HID report, not a keycode the OS/focused app sees.
- **NFR3** Distinct opcode — keyboard→host `PANEL_REQ = 0x4B` (above host→keyboard customs 0x43-0x48 used; 0x49/0x4A/0x4B free); can never collide with a 0x40/41/42 LCD echo (ACK matcher keys on byte[0]=0x41, `device.js:106`).
- **NFR4** Tiny flash — one `process_record_kb`, a small switch, one 64-byte buffer + `raw_hid_send`. Measure against `__flash0_size__`/`nm`, don't build-until-overflow.
- **NFR5** Device-free testable — feed a synthetic 0x4B inbound report → assert `jumpTo`; firmware buffer builder → pure unit.

### Scope / non-goals
In: firmware keycodes + `process_record_kb` + local view helper + `raw_hid_send`; host inbound reader + `cycler.jumpTo`; Studio presets; Vial keycode list; degradation + debounce. Out: OS global-hotkey daemons (fallback A); RGB-per-key feedback (Phase 3); a full on-device panel renderer (firmware only switches views + passes host frames). Depends on the auto-cycle SPARC's `cycle.js` core; if unbuilt, `jumpTo` degrades to a single-panel repaint.

### Constraints (verified)
| Constraint | Source |
|---|---|
| Custom firmware has **no** `process_record` — must be added | `al80.c` (only comment `keymap.c:11`); no handler `al80.c:348-427` |
| `raw_hid_receive_kb` opcodes in use: 0x40/41/42 LCD, 0x43/44/45 palette, 0x46/47/48 bar. Free: 0x49, 0x4A, **0x4B** | `al80.c:348-425`, `config.h:45-79` |
| `raw_hid_send` lands on the interface device.js opens (0xFF60/0x61) — proven, it's the ACK echo path | `al80.c:426`; `device.js:53-58,83-93` |
| Host reads every inbound report; consumes ACK matches, drops the rest | `device.js:83-93,106` |
| VIA `CUSTOM(n)` ↔ 0x7E00+n; Studio binds arbitrary customs | `keymap.js:545,614`; `ui.js:3036-3046` |
| Single-opener — `Device.open()` throws "device busy" | `device.js:65-73` |
| RAW_EPSIZE 64 | `config.h:42` |

---

## P — Pseudocode
```
KEYPRESS (firmware process_record_kb, press edge only):
  case AL80_KC_PANEL_NOWPLAYING:
    if (pressed){ al80_screen_view(0x0d /*PICTURE*/); al80_panel_req(0x00); }
    return false;                            // consume — no HID keystroke (NFR2)
  // PANEL_WEATHER -> 0x0d + 0x01 ; PANEL_CLOCK -> 0x0b(HOME) + 0x02
  // CYCLE_TOGGLE -> al80_panel_req(0xF0) (no local view) ; PANEL_NEXT -> (0xF1)

al80_panel_req(id):                          // ~10 lines, mirrors al80_screen_send_u8 (al80.c:80-85)
  uint8_t buf[RAW_EPSIZE]={0}; buf[0]=0x4B; buf[1]=id; raw_hid_send(buf,RAW_EPSIZE);

al80_screen_view(view):                      // layer 1; emits the same PK_GO the host sends (buildView)
  g_screen_busy=true; <sdWrite SD3: announce(view,0,0)+finish()>; g_screen_busy=false; // 0x0b home/0x0d pic/0x0f gif

HOST (device.js._onData, additive after the ACK-match block :88-92):
  if (buf[0]===0x4B){ this.emit('panelRequest', buf[1]); return; }   // 2 lines; Device is EventEmitter (:29)

CYCLER (cycle-run.mjs + cycle.js):
  dev.on('panelRequest', id => {
    if (now-lastReq < PANEL_REQ_DEBOUNCE_MS) return; lastReq=now       // host debounce (FR7)
    if (id===0xF0){ cyc.togglePaused(); return }
    if (id===0xF1){ cyc.step(now); return }
    cyc.jumpTo(PANEL_BY_ID[id], now) })
  jumpTo(panelId, now):                       // ~12 lines against the auto-cycle FSM
    i=panels.findIndex(p=>p.id===panelId); if(i<0) return
    if(!available(panels[i])) return          // np requested but nothing playing -> no-op, hold
    paused=true; idx=i; await panels[i].poll?.(); await showPanel(panels[idx]); dwellUntil=now+panels[idx].dwellMs
```
Latency: keypress → `process_record` (sub-ms) → `raw_hid_send` next USB frame (~1ms) → `_onData` → `jumpTo`. Local view switch is **instant**; live picture repaint is ~1-1.5s (delete + 60ms + ACK-gated 549-block frame) — the view switch covers the gap.

---

## A — Architecture

### A1. Firmware keycodes (mirror the 0x7E16-18 template the custom build must reintroduce)
Pick customs ABOVE the stock-used range (stock stops at CUSTOM(24)=0x7E18):
```c
enum al80_keycodes {           // QK_KB_0 == 0x7E00 == CUSTOM(0)
  AL80_KC_PANEL_NOWPLAYING = QK_KB_0 + 25,  // 0x7E19 CUSTOM(25)
  AL80_KC_PANEL_WEATHER,                     // 0x7E1A CUSTOM(26)
  AL80_KC_PANEL_CLOCK,                       // 0x7E1B CUSTOM(27)
  AL80_KC_CYCLE_TOGGLE,                      // 0x7E1C CUSTOM(28)
  AL80_KC_PANEL_NEXT,                        // 0x7E1D CUSTOM(29)
};
```
`process_record_kb` is NEW in `al80.c` (no `process_record_user` in keymap.c either, so `_kb` is right — keyboard-level, ships in firmware, survives a keymap reset). Switch on the 5 keycodes; press-edge only (`record->event.pressed` — QMK doesn't re-invoke for held custom keycodes → no repeat storm); `return false` consumes; `default: return process_record_user(...)`. `al80_panel_req` mirrors `al80_screen_send_u8` (`al80.c:80-85`). `al80_screen_view` mirrors `al80_battery_push`'s USART3 discipline (`al80.c:89-98`): `g_screen_busy=true` around `sdWrite(&SD3,…)` so announce bytes don't interleave with RGB SPI. Bytes = the PK_GO announce the host sends as `buildView` (`protocol.js:207-213`).

### A2. Keyboard→host PANEL_REQ opcode
```
report[0]=0x4B AP_PANEL_REQ ; report[1]=panelId (0x00 np, 0x01 wx, 0x02 clock, 0xF0 toggle, 0xF1 next) ; [2..63]=0
```
Safe as an inbound opcode read by `_onData`: the ACK matcher requires byte[0]===0x41 (or specific control echoes), so 0x4B never false-resolves an in-flight picture ACK. 0x43-0x48 are host→keyboard requests (echoed replies); 0x4B is keyboard→host unsolicited. Same interface, disjoint opcode, disjoint trigger — the whole trick.

### A3. Host reader + jumpTo
Two-line change in `_onData` (after the ACK block): `if (buf[0]===0x4B){ this.emit('panelRequest', buf[1]); return; }`. `Device extends EventEmitter` already (`device.js:29`). `cycle-run.mjs` subscribes once after `dev.open()`; `cycle.js` gains `jumpTo`/`togglePaused`. `jumpTo` funnels through the existing `showPanel` (the auto-cycle SPARC's single I/O primitive) so ring hygiene/ACK-gating/reconnect are inherited — nothing new touches the wire. **`paused`-on-jump (design decision):** a manual jumpTo sets `paused=true` (you reached for a key to pin now-playing; don't let the dwell yank it in 15s). `CYCLE_TOGGLE` flips it back.

### A4. Layer-1-vs-layer-2 split + degradation
| Runtime holding 0xFF60/0x61 | Keypress result |
|---|---|
| `cycle-run.mjs` | Layer 1 view switch + layer 2 jumpTo → live refresh. Full feature. |
| single-panel runner | Layer 1 fires; layer 2 ignored or a minimal "refresh my panel" handler. |
| Studio browser tab | Layer 1 fires; layer 2 only if Studio adds a persistent `inputreport` listener (today `hid.js:280` is transient per-ACK). Phase 3. |
| Nothing | Layer 1 STILL works (USART3 independent of the USB raw-HID owner) — view switch, no fresh data. The degradation that matters, free. |

### A5. Studio + Vial binding
**Studio (works today, needs only a preset label):** `ui.js:3036-3046` turns `CUSTOM(n)` → 16-bit → `buildKeymapSet` (`protocol.js:520`); `CUSTOM(25)`↔0x7E19 round-trips (`keymap.js:545,614`). Only change: a `PRESETS['LCD panel']` block in `keymap.js` (mirror the existing `'LCD view'` `:85-89`) so buttons are named (Now playing=CUSTOM(25) … Next panel=CUSTOM(29)). Optional `applyLcdPanelKeys` helper like `applyLcdViewKeys` (`keymap.js:187`).
**Vial:** add the 5 keycodes to `keymaps/vial/vial.json` custom-keycodes (title/shortName/qmkid) for named picker entries. Without it they still bind (raw `CUSTOM(25)`), just unlabeled. Metadata only.

---

## R — Refinement

### R1. Signaling trade study
(A) normal/consumer keycode + host global-hotkey listener — **fallback only** (pollutes focused app, OS-specific hotkey registration, races); its one virtue = zero firmware, usable on any firmware while Phase 1 is unbuilt. (B) **custom raw-HID report up on keypress** — **recommend**: no pollution (`return false`), works only with the host on the channel it already reads, reuses the proven `raw_hid_send` path, disjoint opcode; costs a flash.

### R2. Single-opener reality
Only the process holding 0xFF60/0x61 sees `panelRequest` (others get "device busy"). Exactly one of {cycler, single-runner, Studio-tab} consumes it — never two. None open → layer 1 still fires. The design leans in: the keyboard always does something useful locally; the host is a bonus consumer, not a hard dependency.

### R3. Debounce / repeat / latency
Firmware press-edge only (held key fires once, no auto-repeat for customs). Host `PANEL_REQ_DEBOUNCE_MS` (~250ms) collapses double-taps/bounce (coalesce to last id). Local view switch instant; live picture repaint ~1-1.5s (the gated frame) — masked by the view switch.

### R4/R5/R6. Degradation / flash / risks
Degradation spelled out in A4 + the unavailable-panel no-op (mirrors the cycler skip). Flash: tens-to-low-hundreds of bytes; MEASURE against `__flash0_size__`/`.map` before committing (AL80 flash cap is real). Risks: **[CORRECTION]** "Phase 0 no firmware" fails on the custom build (no process_record) — fold 0x7E16-18 into Phase 1 (same `al80_screen_view` helper serves both); keyboard-sourced view-announce unverified end-to-end (5-min on-device check); `paused`-on-jump is a UX opinion (gate behind `CYCLE_JUMP_PAUSES=1`).

---

## C — Completion

### C1. Phased plan
- **Phase 0 — bind existing view-switch keys via Studio (STOCK firmware only).** Add `PRESETS['LCD panel']`-style entries. Zero firmware **iff on stock**. **[CORRECTION]** on the custom build this does nothing until Phase 1 — if on custom fw, skip to Phase 1.
- **Phase 1 — firmware `PANEL_*` + raw_hid_send + host reader.** Add `process_record_kb`, the 5 keycodes, `al80_panel_req` (0x4B), `al80_screen_view` (and on custom, wire 0x7E16-18 through the same helper). Add `_onData` 0x4B emit + `cycler.jumpTo` + subscription + host debounce. Add the Studio preset. This is the feature.
- **Phase 2 — CYCLE_TOGGLE/PANEL_NEXT + Vial picker entries.** `togglePaused`/`step` + `vial.json` labels.
- **Phase 3 (opt) — Studio-as-runtime + RGB feedback.** Persistent `inputreport` listener in `hid.js`; optional RGB pulse on switch.

### C2. Test plan (device-free where possible)
Host: (1) **inbound dispatch** — `_onData([0x4B,0x00,…])` → emits `panelRequest` 0x00; `[0x41,…]` echo → resolves an ACK and does NOT emit (no cross-talk). (2) **jumpTo** (RecordingDevice + fake panels) — `jumpTo('weather',t)` → idx→weather, ops `['deletePicture',{sendCard,replacePrevious:true}]`, `dwellUntil==t+dwellMs`, `paused==true`. (3) unavailable no-op. (4) debounce → one showPanel. (5) toggle/next. (6) no-cycler degradation (single-panel refresh, no blind-delete).
Firmware: (7) unit — `al80_panel_req(id)` fills buf[0]=0x4B, buf[1]=id, len RAW_EPSIZE (extract the buffer builder to a pure fn). (8) on-device smoke — each key switches the view instantly; with the cycler up the live panel repaints; with no host only the view switches; held key fires once.

### C3. Done criteria
Phase 1: `PANEL_NOWPLAYING` with the cycler up switches the view instantly + repaints now-playing within ~1.5s; no host → view still switches; host tests 1-3,6 green; flash headroom confirmed. Phase 2: toggle/next on-device; Vial named. No keystroke leaks (verify with a text field focused).

### C4. Open questions / must-verify
- **[verify]** Does the module accept a PK_GO view announce from the keyboard's OWN USART3 (`al80_screen_view`) the same as a host-relayed one? (Almost certainly — same wire.)
- **[verify]** `raw_hid_send` unsolicited (outside `raw_hid_receive_kb`) delivers cleanly against an in-flight image ACK stream on this via.c build. If it collides, gate `al80_panel_req` on `!g_screen_busy` (defer via a dirty flag like `locks_dirty` `al80.c:159-163,442-445`).
- **[decide]** manual jump pauses the cycle? (yes, behind an env flag). Vial ids: `QK_KB` (`CUSTOM(25+)`) vs `QK_USER` (0x7E40+) for a hard gap.

**Bottom line:** rides almost entirely on existing primitives — `_onData` already reads every inbound report (host reader = 2 lines); `showPanel`/`idx` already own "show panel X" (`jumpTo` = a dozen lines); `buildKeymapSet` already binds any `CUSTOM(n)` (Studio change = a preset label). The one real new work is **firmware**: this custom build has NO `process_record` at all, so Phase 1 adds it from scratch (5 keycodes, an `raw_hid_send` helper mirroring `al80_screen_send_u8`, a USART3 view helper mirroring `al80_battery_push`). Two hardware verifies: keyboard-sourced view announces, and unsolicited `raw_hid_send` vs the image ACK stream.
