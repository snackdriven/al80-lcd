# AL80 overnight run — custom QMK + editable presets (2026-07-03)

Goal Kayla set: recolor the preset effects (rainbow → 1-2 chosen colors), **keep the LCD**, and "work through all you can overnight, down to building a custom QMK." Done — a custom firmware compiled GREEN. Nothing was flashed.

## TL;DR
- **Use today, no flash, screen intact:** an interactive **multi-color palette/preset editor** and a **now-playing screen render** are built + deployed to al80-studio (commit `a96b2bf`). Palettes = 2-6 editable color stops, cycle/breathe/strobe, saved presets (Sunset/Ocean/Forest/Ember). Global (whole-board).
- **The firmware fork resolved in your favor:** the LCD is a **USART3 pass-through** (self-parsing display module, 460800 baud, PC10/PC11) — *not* SPI/DMA — so a custom build can **keep the screen**. The vendor's own sibling board (b75Pro) ships QMK source proving per-key RGB + screen coexist.
- **A custom vial-qmk firmware COMPILED** (`firmware/AL80_CUSTOM_QMK_GREEN.bin`, 47 KB of ~120 KB) with 3 of 4 layers: the aw20216s matrix (real extracted LED map + pins), a **user-recolorable custom effect** (`PALETTE_CYCLE`, editable palette — your actual want), the **LCD pass-through**, and VialRGB (per-key + live keymap + macros). The WS2812 side bar is deferred (its data pin needs a scope/PCB trace).
- **Not on-device verified.** It compiles with reverse-engineered values; it has NOT been flashed or run. On-device verification (LED positions, banding, the B7/B9 hardware questions) is the next real step, and it's yours to trigger.

## Part 1 — what you can use right now (no flash, screen stays)
- **Palette editor** (al80-studio → Lighting → Palettes): pick 2-6 colors, choose Cycle/Breathe/Strobe, set speed, save named presets. Global board color cycles your palette. Save-less (no EEPROM wear).
- **Now-playing** (host daemon, `host/apps/nowplaying.js`): renders Spotify to the 96×160 LCD — album-art tile + title/artist + progress bar. 4 preview PNGs in `host/apps/`. Placeholder art for now (real art needs a decode step); drops into the daemon's render loop. Gated on the picture-page banding fix.

## Part 2 — the firmware story
- **V0122 (SignalRGB) ruled out for per-key:** its added opcode `0x81` just floods ONE global color — not per-key. No gain over ripple. (Trace confirmed.)
- **LCD transport = USART3, keepable:** the 30,720-byte frame streams over USART3 (460800 8N1, PC10/PC11), the display module self-parses. Porting it to QMK is `sdWrite(&SD3, &report[7], len)` on the 0x40/41/42 commands — small.
- **All hardware params extracted** (from RIPPLE.bin, in `al80-qmk-hardware-params.md`): the 84/82-entry aw20216s LED register map, SPI1 A5/A6/A7, CS B6/C8, EN B7, the USART3 config. Only the WS2812 bar pin resisted static analysis (candidate B9, unverified).

## Part 3 — the custom firmware
In `AL80_CUSTOM_QMK_GREEN.bin`. Contains: aw20216s matrix, VialRGB (per-key direct + live keymap + macros), a recolorable `PALETTE_CYCLE` effect (swap the `AL80_PALETTE` array to recolor), and the LCD raw-HID pass-through.

**Flash plan (when you're ready — reversible):** hold **ESC + plug USB** → stm32duino DFU → `dfu-util -a 0 -s 0x08002000:leave -D AL80_CUSTOM_QMK_GREEN.bin` (or QMK Toolbox). Never write below 0x08002000 (bootloader). Rollback = flash `YUNZII_AL80_RIPPLE.bin` the same way (your proven path).

**Honest caveats (must verify on-device before trusting):**
1. Not flashed/run — compiles ≠ works.
2. LED positions came from disassembly + a macro-order swap — needs a per-key VialRGB walk to confirm each index lights the right key (watch the wiring quirks at array idx 56/58/73).
3. **B7 conflict:** it's both the aw20216s EN pin and an LCD control line the stock FW drives low — can't both be satisfied on one pin; may be a params mislabel. Could affect the LCD.
4. LCD ACK is simplified (always 0x55; the busy/backpressure semaphore is deferred).
5. Banding byte-swap still needs on-device confirm.
6. Side bar not wired (B9 unverified).

## Part 4 — the roadmap (ranked "what's next")
Screen features are reachable **now, no firmware risk** (LCD protocol works on ripple); key/knob features beyond global color are the custom-QMK path.
1. **Now-playing on the screen** (finish real-art decode + wire the Spotify poll) — biggest bang, both halves exist.
2. **Knob-cycled widget screen** — clock / next-event / wedding-countdown / now-playing, flipped by the encoder.
3. **Recolored presets on-device** (custom QMK) — the spatial version of the palette editor; effects read your editable palette via Vial/al80-studio.
4. **Notification cards + gentle event pulses** (Claude-needs-you, CI, hypercare) — pairs with the daemon notifier foundation.
5. **The side bar as a status meter** (once B9 confirmed) — battery / CI / unread level.
6. **Ambient computer** — the daemon ties Spotify + ntfy webhooks + Claude + calendar + seedbox to screen + lights + knob.

## Part 5 — decisions for you
- **Flash the custom firmware to test it?** It's reversible; the payoff is confirming the recolorable effects + per-key + LCD actually run. Or stay on ripple and use the software palette editor + now-playing (no flash).
- **Which roadmap item first** when you're back — I'd start with finishing now-playing.

Artifacts: `al80-qmk-hardware-params.md` (extracted values), `firmware/AL80_CUSTOM_QMK_GREEN.bin`, `~/qmkwork/vial-qmk/keyboards/yunzii/al80/` (source, uncommitted), `host/apps/nowplaying-preview-*.png`, al80-studio commits `0bc55ec` (effects) + `a96b2bf` (palette + now-playing).
