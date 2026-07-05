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

_(A dedicated research agent was still finalizing the definitive root cause at wrap; its verdict
appends below when done.)_
