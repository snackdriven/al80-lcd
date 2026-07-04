# Cracking the AL80 LCD on custom QMK — logic-analyzer plan

The screen forwarding on custom QMK is code-correct (USART3 460800 8N1, PC10/PC11 remap, the b75Pro-style forward all verified) but the display module never wakes. Every remaining question is electrical — "what's actually on the wire" — which static analysis can't answer. This is the bounded plan to settle it with a cheap tool.

## What to buy (~$8–15)
- **8-channel USB logic analyzer, 24 MHz, FX2 / CY7C68013A-based.** Search "USB logic analyzer 24MHz 8 channel" on Amazon/AliExpress — many identical clones, ~$8–13, often labeled "Saleae/sigrok compatible." 24 MHz is plenty for a 460800-baud UART (needs ~5 MHz).
- Dupont probe wires (usually included) + optionally a bit of thin wire to tack onto test points.
- **Free software: PulseView (sigrok).** It has a built-in **UART protocol decoder** that turns the captured line into the actual bytes.

## What to probe (the USART3 link to the display module)
Best probe point = the **display-module connector** (the ribbon/header between the keyboard PCB and the screen board) — the UART data line arriving at the module is far easier to reach than the fine-pitch MCU pins. Channels, priority order:
- **CH0 = USART3 TX** — the remapped **PC10** (or the module connector's data-in pin). The main event.
- **CH1 = PB10** — the *default* USART3 TX. If data comes out here instead of PC10, the AFIO remap didn't take at runtime → the real bug.
- **CH2 = B7** — the shared aw-EN / suspected screen-reset line. Watch how ripple toggles it vs custom.
- CH3 = **A8**, CH4 = **C9**, CH5 = **B9** — the other module control rails.
- **GND** — the analyzer ground to the keyboard ground (essential; without it, garbage).

You won't need all six — the data line + a reset line + ground are the priority.

## The capture (ripple vs custom, then diff)
1. Open the case, tack the probes on, connect ground.
2. **On RIPPLE:** upload a solid-color still (al80-studio, or lab.html **F**). Capture. In PulseView add a UART decoder at **460800 8N1** on the data channel → you'll see the real byte stream (`A5 5A …`), which line carries it, the exact baud, and whether B7/a reset line pulses before or during the send.
3. **On CUSTOM (v6/v7):** same upload, same capture.
4. **Diff the two:**
   - Same channel? (Ripple on PC10 but custom on PB10 = remap didn't take → fix.)
   - Same bytes, baud, inter-byte/inter-block timing?
   - Does ripple toggle a reset/enable line (B7 or another) that custom doesn't, or in a different order/width?

## What it settles
The diff shows exactly why the module wakes on ripple and not on custom → a targeted firmware fix (right pin, right reset sequence, right pacing). One session with real data, versus the blind-reflash wall we hit.

## The honest barrier
This needs opening the keyboard and probing small pins / test points (possibly tacking on thin wires). The tool is cheap; the *skill* — fine probing/soldering — is the real ask. If the module connects via a header or ribbon, that's the friendly probe point and keeps you off the MCU pins.

## Context
Full custom-QMK state + all prior findings: `2026-07-03-overnight-custom-qmk-summary.md`, `al80-qmk-hardware-params.md`. The forwarding-code verification + why B7 is the suspect: the v5/v6 subagent traces. Bins in `firmware/` (v6 = current best custom, RGB + keys; RIPPLE.bin = screen + wireless).
</content>
