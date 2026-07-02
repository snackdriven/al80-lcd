# Partial-update experiment — results log

Run 2026-07-01 on the real device (all sends accepted, no single-opener error).

## Objective (measured, no observation needed)

**Full-frame send is Windows-timer-bound, not device-bound.**

| Inter-packet gap | 550-packet full frame | fps |
|------------------|-----------------------|-----|
| 5 ms | 8,555 ms | 0.12 |
| 2 ms | 8,513 ms | 0.12 |
| 1 ms | 8,541 ms | 0.12 |
| **0 ms** | **551 ms** | **1.81** |

Any nonzero `setTimeout` gap costs ~15.6 ms (Windows timer resolution), so 550 sleeps ≈ 8.5 s.
At gap=0 it's ~1 ms/packet — the real HID write throughput. **Send frames with no inter-packet
sleep** (or a sub-ms busy-wait / `setImmediate`) for ~2 fps full frames.

Implication for a partial update (if the wrapper honors it): a clock's seconds ≈ 10–40 blocks
= ~10–40 ms at gap=0. That's the difference between a static panel and a live one.

## Pending (needs eyes on the LCD)

Not yet observed — was away from the keyboard:

1. **`wrapped` outcome** (`full ff0000` then `wrapped 00ff00 180 120`): does the panel show
   (a) red + green band [dirty-rect works], (b) mostly black + green band [announce clears],
   or (c) no change [unsupported]? This decides whether live widgets are possible.
2. **`bare` outcome** (`bare 00ff00 …` with no announce/finish): does a lone 0x41 stream update
   a region? (KB says a lone 0x41 did nothing — confirm/deny.)
3. **Does gap=0 render cleanly?** The 551 ms frame was accepted, but confirm it draws without
   tearing/drop before trusting gap=0 for real sends.

Re-run when back at the keyboard (browser tab closed):

    node experiments/partial-update-test.js full ff0000 --send
    node experiments/partial-update-test.js wrapped 00ff00 180 120 --send   # observe (1)
    node experiments/partial-update-test.js full ff0000 --send
    node experiments/partial-update-test.js bare 00ff00 180 120 --send      # observe (2)

The panel is currently left on the gap=0 timing test's blue frame.
