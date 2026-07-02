---
title: AL80 Studio — SPARC plan
status: plan (pre-implementation)
updated: 2026-07-02
target_repo: snackdriven/al80-studio (new, GitHub Pages, HTTPS)
references: AL80_KNOWLEDGE_BASE.md §5–§14, converter/, research/analyze_captures.py, research/via-protocol.md
---

# AL80 Studio — SPARC plan

A WebHID control panel for the YUNZII AL80 — our own replacement for yunzii-game.com, built on
the fully-decoded protocol. Client-side, Chrome/Edge, deployed to HTTPS Pages. v1 = clock +
image + GIF + view/clear + a shortcuts (keymap) tab.

The single most important design principle, learned this project: **where the capture and the
site source disagree, the capture wins.** The capture is ground truth for *this* keyboard's
firmware; the source shows the app's general implementation, which has several product paths.

---

## S — Specification

### Goal
Do everything yunzii-game.com does, minus the vendor site and plus what it withholds (12-hour
clock, arbitrary images/GIFs, scriptable), from a page you open with the keyboard plugged in.

### Users / stories
- Set a **12-hour** clock the vendor refuses to offer, and have it stay synced.
- Push **any image** to the LCD (fit, brightness/grayscale/dither baked in).
- Push a **GIF** at a chosen frame rate.
- **Switch views** (clock / picture / GIF) and **clear** picture/GIF.
- Build a keymap of **shortcuts** (LCD/lighting + app launchers + media/window/basics) and export
  VIA JSON to load in usevia.app.

### Functional requirements (per tab)
1. **Connect** — reconnect silently via `getDevices()`; else `requestDevice()` on click (VID
   0x28E9 / PID 0x30AF). Confirm the chosen HID device exposes the `0xFF60/0x61` collection.
   Show connected/disconnected; handle unplug events; a "release device" button.
2. **Clock** — pick time (default = now), 12/24hr toggle, date auto-derived; "Send once" +
   "Keep synced (60 s)". Uses time+date transactions ×3 (§5f). 12hr = `H=(h24%12)||12`.
3. **Image** — drag/drop or file-pick; live 112×137 canvas preview; fit = cover/contain/stretch;
   brightness/contrast/saturation/grayscale + optional Floyd–Steinberg dither; "Send to device".
   Uses the **capture-verified** still-image sequence (announce + 548 data + finish, §14b/§7).
4. **GIF** — drag/drop; decode frames (browser `ImageDecoder`); frame-rate slider 1–60 (default
   30); frame preview + count; "Send to device". **Marked experimental** (see Refinement).
5. **View** — Homepage / Picture / GIF buttons; Clear picture / Clear GIF (with confirm — destructive).
6. **Shortcuts** — preset library → assign to keys/layers → import/export VIA keymap JSON.

### Non-functional
- Chrome/Edge only (WebHID). Graceful "unsupported browser" message elsewhere.
- Zero build step: vanilla ES modules + CSS. No framework, no bundler.
- Pure protocol layer, unit-tested offline against real captures before any hardware.
- Deployed at `https://snackdriven.github.io/al80-studio/`.

### Non-goals (YAGNI)
- No keymap *flashing* (VIA does that; we only export JSON).
- No firmware update / DFU. The app must be structurally incapable of emitting `0xB0–0xB7`.
- No mobile, no accounts, no server, no non-AL80 devices.

### Hard constraints
- **Single-opener:** only one process may hold `0xFF60`. Close yunzii-game.com, VIA, and any
  node script first. Detect failure and say so.
- **Secure context:** WebHID needs HTTPS or localhost. Pages satisfies this.
- **Safety:** opcodes are limited to `0x40/0x41/0x42` (+ optional `0x55` status). Never DFU.

---

## P — Pseudocode (core, protocol layer — pure, no DOM/HID)

    // checksum & crc (verified, §5e/§5f)
    yne(bytes)   = sum(bytes) & 0xFFFF, returned little-endian [lo, hi]
    ga(bytes)    = CRC16-MODBUS(init 0xFFFF, poly 0xA001), returned big-endian [hi, lo]

    // one builder for every packet (§5f). offset defaults [0,0]; reqLen default 63.
    build(op, payload, offset=[0,0], reqLen=63):
      pkt = [op, offset[0], offset[1], (reqLen-7), 0,0,0, ...payload]   // len byte = reqLen-7
      [pkt[4], pkt[5]] = yne(pkt)                                       // checksum in place
      return padTo64(pkt)                                              // 64-byte report body

    // still image — the CAPTURE-VERIFIED path (announce + data + finish, no 0x0C length packet)
    buildImageTransfer(rgb565BE_bytes /*30,688*/):
      announce = build(0x40, [0xA5,0x5A,0x10,0,0x01,0xC5,0xB1,0x01])    // reuse known-good announce
      blocks = for k in 0..547:                                        // 548 × 56-byte blocks
        off = k*56 ; build(0x41, rgb565BE_bytes[off:off+56], le16(off))
      finish = [0x42,0,0,0x38,0x7A, ...pad]
      return [announce, ...blocks, finish]

    // clock/date (§5b/§5c/§5f), each sent 3×
    buildClock(date, is12hr):
      h = is12hr ? (date.h%12)||12 : date.h
      timeAnnounce = build40([0xA5,0x5A,0x09,0,0x03,0xC3,0xE1])
      timeData     = build(0x41, [h, date.m, date.s], _, 10)           // subcmd 3, payload H,M,S
      dateAnnounce = build40([0xA5,0x5A,0x0A,0,0x04,0x01,0x50])
      dateData     = build(0x41, [YY, dayOfWeek(1-7), month, day], _, 11) // payload YY,DOW,MM,DD
      return repeat3([timeAnnounce, timeData, finish, dateAnnounce, dateData, finish])

    // view switch / clear (§5f) — announce + finish, no data
    buildView(type /*11 home,13 pic,15 gif*/): announce(A5 5A type 0 0 crc crc) + finish
    buildClearPicture(): 16 × [announce(type 14) + finish]
    buildClearGif():     [announce(18,sub1)+finish, announce(19,sub2)+finish]

    // GIF (§14c) — EXPERIMENTAL, source-derived, subcmd 0x02/0x03 (see Refinement caveat)
    buildGifTransfer(frames /*each 30,688 B RGB565 BE*/, fps):
      start18 = build40([A5,5A,0x12,0,0x02, crc, mode, 0x00])
      start19 = build41([A5,5A,0x13,0,0x02, crc, mode, 0x00])
      for i, frame in frames:
        header = build41([A5,5A,0x10,0,0x03, crc, 0x02, mode, i])
        length = build41([A5,5A,0x11, lenHiLo(len), crc])             // big-endian W·H·2
        data   = chunk(frame)                                         // 1024→56-byte reports
      finish18 = build41([A5,5A,0x12,0,0x02, crc, mode, frames.length]) // COUNT in trailing byte
      finish19 = build41([A5,5A,0x13,0,0x02, crc, mode, fps])           // FPS in trailing byte
      return [start18,start19, ...perFrame, finish18, finish19, finish42]

    // image → RGB565 big-endian (browser: canvas; §14b)
    rgb565BE(imageData /*RGBA*/):
      for each pixel: v = ((R>>3)<<11)|((G>>2)<<5)|(B>>3); emit [v>>8 & 0xFF, v & 0xFF]

### HID transport (hid.js)
    send(logicalPackets, gapMs=0):
      for pkt in logicalPackets:
        device.sendReport(0, Uint8Array(pkt))    // reportId 0; pkt is the 64 data bytes
        if gapMs: await sleep(gapMs)              // NOTE: gap>0 costs ~15ms on Windows (§8)

---

## A — Architecture

### Modules (each one job, testable in isolation)
- **`src/protocol.js`** — pure: `yne`, `ga`, `build`, `buildImageTransfer`, `buildGifTransfer`,
  `buildClock`, `buildView`, `buildClear*`, `rgb565BE`. No DOM, no HID. **Node-unit-tested.**
- **`src/hid.js`** — WebHID only: `connect()`, `getDevice()`, `send(packets, gap)`, disconnect
  handling, single-opener error surfacing. The only file that touches `navigator.hid`.
- **`src/image.js`** — canvas resize/fit/bake → RGBA → hands to `protocol.rgb565BE`.
- **`src/gif.js`** — `ImageDecoder` → frames → canvas → RGBA arrays.
- **`src/keymap.js`** — preset library + VIA JSON import/export (round-trips `al80_keymap.json`).
- **`src/ui/*.js` + `index.html` + `styles.css`** — tabs, panels, wiring. ES modules, no build.

### Data flow (image example)
file → `image.js` (canvas 112×137, bake) → RGBA → `protocol.rgb565BE` → 30,688 B →
`protocol.buildImageTransfer` → 550 logical packets → `hid.send` → device.

### Deployment
New repo `snackdriven/al80-studio`; static files at root; GitHub Pages on `main`.
`https://snackdriven.github.io/al80-studio/`. No Actions needed (static).

### Test harness
- `test/protocol.test.mjs` (Node): round-trip the archived captures
  (`../al80-lcd/research/*capture*.json`) — assert offsets, `yne` checksums, `ga` CRCs, block
  counts, and red→`F8 00`. Reuse the logic proven in `converter/`. **Gate before on-device.**
- On-device checklist (user): connect → clock → still image → view switch → (GIF, experimental).

---

## R — Refinement (caveats, unknowns, risks — the part that matters)

### Unknowns to resolve on-device (blocking for the affected feature only)
1. **`sendReport` data length — 63 vs 64.** The node converter wrote 64 data bytes (+0x00 report
   id) and matched captures. The old `browser_console_snippet.js` used **63** bytes and reportedly
   worked. WebHID `sendReport(0, data)` should take the full 64-byte report body. **Plan:** send 64;
   if the device rejects/garbles, fall back to 63. First thing to confirm in the clock test (small,
   safe). This gates *everything*, so test it first with the clock.
2. **GIF wire path (the big one).** Source (§14c) emits GIF control subcmds **0x02/0x03**; our own
   capture showed **0x09/0x0A/0x07** with banked 1 KB windows. Two different code paths; we don't
   know which our firmware honors. **Plan:** GIF ships **experimental**, behind the proven
   still-image path. If the source path fails on-device, capture a real GIF upload and reconcile —
   we have the tooling. Do **not** let GIF risk hold up the solid v1 core.
3. **Still-image length packet.** Source (§14b) sends a `0x0C` length descriptor; our capture +
   converter did **not** (announce + data + finish only) and round-tripped perfectly. **Plan:**
   use the capture-verified sequence (no length packet). If a firmware rev needs it, it's one
   extra packet to add.

### Known caveats (design around them)
- **Single-opener.** The app holds `0xFF60`; VIA and yunzii-game can't run simultaneously. Mitigate:
  open on connect, expose "release," and detect `sendReport` failure → "close other openers" message.
- **Windows `setTimeout` floor (§8).** Any inter-packet gap ≥1 ms costs ~15.6 ms → a full frame at
  gap 1 ms = ~8.5 s; at gap 0 = ~0.55 s. **Send with no gap.** Show a progress bar (550 packets).
- **Chrome/Edge only.** Feature-detect `navigator.hid`; hard-stop with a clear message elsewhere.
- **Destructive commands.** Clear picture/GIF wipe device content — confirm dialog. Never build DFU
  opcodes; the builder whitelists `0x40/0x41/0x42` (+0x55).
- **Canvas resampling ≠ sharp.** Doesn't matter for correctness — any valid 112×137 RGB565 frame is
  accepted; only the byte format must be right (test: solid red = `F8 00` repeating).
- **Permission/gesture.** `requestDevice` needs a user click; `getDevices` gives silent reconnect
  after first grant. Handle both.
- **Partial-update ceiling (open, from converter/experiments).** Whether a sub-region can update
  without a full frame is still unverified on-device. v1 sends full frames; if partial works later,
  it's a perf win, not a v1 requirement.

### Risk table
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| GIF path wrong for our firmware | med | med | experimental flag; capture+reconcile; still-image is the core |
| sendReport 63/64 mismatch | low | high | test first with clock; fallback path |
| User has VIA/yunzii open | high | low | detect + clear message |
| Browser unsupported | med | low | feature-detect + message |
| Bricking | very low | very high | opcode whitelist; DFU impossible by construction |

---

## C — Completion (phased, each phase shippable/testable)

**Phase 0 — protocol core + offline tests.** `protocol.js` + `test/protocol.test.mjs` green against
captures (checksums, offsets, red→F800). No hardware. *DoD: 4288/4288-style parity with captures.*

**Phase 1 — Connect + Clock.** `hid.js`, Connect tab, Clock tab. **Resolves unknown #1** (63/64) with
the smallest safe transfer. *DoD: 12hr clock shows on the panel on-device.*

**Phase 2 — Image.** `image.js`, Image tab, full still-image send. *DoD: an arbitrary photo renders on
the LCD; solid-red test = correct color.*

**Phase 3 — View/Clear.** View tab. *DoD: switch views + clear work (with confirm).*

**Phase 4 — GIF (experimental).** `gif.js`, GIF tab, source-derived path. *DoD: a GIF animates, OR the
failure is captured and the discrepancy documented — either is an acceptable phase outcome.*

**Phase 5 — Shortcuts.** `keymap.js`, Shortcuts tab (LCD/lighting + app-launcher presets), VIA JSON
export round-tripping `al80_keymap.json`. *DoD: exported JSON loads cleanly in usevia.app.*

**Phase 6 — Deploy.** New repo, Pages on. *DoD: live at the HTTPS URL; a fresh machine can connect.*

**Definition of done (v1):** Phases 0–3 + 5–6 solid; Phase 4 shipped-or-documented. Offline tests in
CI-spirit; on-device checklist passed by you.

### On-device test checklist (you run, keyboard plugged in, VIA/yunzii closed)
1. Connect → device shows connected.
2. Clock → set 3:47, 12hr → panel reads 03:47. (Confirms sendReport length.)
3. Image → send a photo → renders; send solid red → reads pure red.
4. View → Homepage/Picture/GIF switch; Clear (confirm) works.
5. GIF → send a short GIF → animates (or report what it does; we reconcile).
