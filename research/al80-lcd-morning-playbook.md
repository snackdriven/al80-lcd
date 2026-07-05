# AL80 LCD — morning playbook (2026-07-05 overnight)

**Where we are:** the custom firmware drives the LCD. Enable (C9/A8) ✅, baud (921600) ✅,
color = RGB565 endianness (module wants little-endian). We have a **proven-working** setup and
an **in-progress clean** one. This doc: what to flash/test in the morning, in order.

## The proven-working setup (if you just want it working)

- Firmware: **v9** (`AL80_CUSTOM_QMK_v9_baud921k.bin`) — or v10/v11, doesn't matter for this path.
- al80-studio: **little-endian** pixel packing. This is currently an *uncommitted local edit* in
  `src/protocol.js` (`rgb565BE` outputs low-byte-first). Your local copy has it.
- Result already seen on-device: **solid red renders red, images true-color, widgets render.**

That's a working colored screen. The rest of this doc is about making it *clean* (so al80-studio
stays universal / the live site works / no local hack).

## The clean fix we're chasing: byte-swap in the firmware

Goal: keep al80-studio big-endian (universal, works on stock + the live site) and let the custom
firmware swap the two pixel bytes. Then no host hack.

- **v10** put an *in-place* swap in `al80.c`'s `raw_hid_receive_kb` → it silently no-op'd
  (colors identical to no-swap). Root cause under investigation overnight.
- **v11** (`AL80_CUSTOM_QMK_v11_byteswap2.bin`) swaps into a *separate* buffer and forwards that —
  rules out any in-place-aliasing weirdness across `sdWrite`.

### Morning test order

1. **Flash v11** (`AL80_CUSTOM_QMK_v11_byteswap2.bin`) — ESC+plug → QMK Toolbox.
2. In al80-studio, make sure it's the **normal big-endian** build (I reverted the local LE edit
   for this test path — if colors are wrong, check `src/protocol.js:88` is back to `(v>>8)` first).
3. Reconnect, send a **solid red** to the main page.
   - **Red** → the firmware swap works. Done: al80-studio stays universal, no hacks. Commit al80.c
     + note it in the keyboard defn.
   - **Still blue** → the pixels genuinely don't pass through that handler (see the research note
     appended below for where they actually go / the next patch site). Fall back to the host-side
     option immediately below so you have a working screen regardless.

## Guaranteed fallback (host-side), if the firmware swap can't be made to work

Re-apply the little-endian flip in al80-studio and keep v9/v10/v11 — it's proven. To make it
clean rather than a raw hack, the plan is a small persisted **pixel-order toggle** (BE default for
stock, LE for the custom firmware) so the live site stays correct for others. That's ~30 min of
al80-studio work; noted for a fresh session unless the firmware swap lands first.

## Known-minor / deferred

- **Bottom strip** on the main-page image = the clock/status region the image doesn't cover. Benign.
- **WebHID drops** after transfers on the custom firmware (stale `data-connected`). Recover:
  Disconnect → Connect → pick AL80. Firmware USB-stability thing; not chased yet.
- **al80-studio lighting** doesn't control the custom firmware's RGB (VialRGB ≠ VIA RGB-matrix).
  Use Vial (vial.rocks) for colors.

## Bins (in Downloads + al80-lcd/firmware/)

- `AL80_CUSTOM_QMK_v9_baud921k.bin` — 921600, no swap. Works with host-LE.
- `AL80_CUSTOM_QMK_v10_byteswap.bin` — in-place swap (no-op'd).
- `AL80_CUSTOM_QMK_v11_byteswap2.bin` — separate-buffer swap. **Test this first.**
- Rollback to stock any time: `YUNZII_AL80_RIPPLE.bin`.

Build: `PATH=~/opt/arm/bin:~/.local/bin:$PATH; cd ~/qmkwork/vial-qmk; qmk compile -kb yunzii/al80 -km vial`

---
## Root-cause investigation (overnight)

Confirmed so far (static analysis + disassembly):
- **NOT truncation.** `config.h:42 RAW_EPSIZE 64` → the endpoint is 64, so `length`==64 and
  `data_len`==56 (full block, not clamped to 25).
- **The dispatch path is correct.** `quantum/via.c` `raw_hid_receive` (~line 211) passes the LIVE
  `data` pointer to `raw_hid_receive_kb` for unhandled command ids; `al80.c`'s handler is the only
  `sdWrite(&SD3,…)` forwarder in the tree (grep-confirmed). So the swap *should* reach the forward.
- **NOT optimized out.** v11's `lcd_tx` swap buffer is allocated in .bss (0x200037f8) and referenced
  in the disassembly — the swap code is in the binary.
- So the v10 in-place no-op is genuinely odd. **v11 tests the "in-place aliasing across sdWrite"
  theory** by swapping into `lcd_tx` and forwarding that. If v11 fixes it → aliasing was it. If v11
  ALSO no-ops → the report content reaching the handler isn't what we think (a data/dispatch issue,
  not the swap code) and the next move is to instrument (temporarily force a solid color in the
  firmware forward and see if the module shows it, isolating host-vs-firmware).
- Lead noted for the WebHID-drop flakiness: `RAW_EPSIZE 64` vs `VIAL_RAW_EPSIZE 32` (vial.h)
  mismatch — Vial's page math assumes 32 while the endpoint is 64.

### ⭐ SOLVED (2026-07-05 morning): the module reads BIG-ENDIAN — remove the swap

Clean on-device isolation settled it:
- An instrumented build forcing `[E0,07]` into the pixel path → screen **RED** (0xE007 big-endian).
- v11's swap (host-BE → `[00,F8]`) → screen **BLUE** (0x00F8 big-endian).
Both fit big-endian only. al80-studio already sends big-endian, so the module wants the bytes as-is.
The swap was the wrong turn; the early "host-LE = red" reading was confounded (stale-hex flash trap
the research agent found + the then-unfixed banding mis-coloring the gradient).

**THE FIX: `AL80_CUSTOM_QMK_v13_noswap.bin`** — plain `sdWrite(&SD3, &data[7], data_len)`, no swap.

### Do this (supersedes the v11 order above)

1. Flash **`AL80_CUSTOM_QMK_v13_noswap.bin`** (the `.bin`, not a stale `.hex`).
2. al80-studio big-endian (already reverted; `src/protocol.js:88` = `(v>>8)` first).
3. Reconnect, send solid red → **expect RED**. Then a gradient/photo → expect clean color (no swap =
   nothing to corrupt; if the gradient is ALSO clean, the earlier "banding" was just the mis-color).
4. If red → done. al80-studio stays universal, no host hacks, nothing to commit on the host side.
   The keyboard source (with the no-swap forward) is backed up in `firmware/al80-keyboard-src/`.

Flash-provenance note (research agent): `qmk flash` / dfu-util use the `.bin`; QMK Toolbox pointed at
a `.hex` can grab a 2-day-stale one. We stage the fresh `.bin`, and the green-force test proved fresh
code runs — so provenance is fine for our flow, just don't hand-pick an old `.hex`.
