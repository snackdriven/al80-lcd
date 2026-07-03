# AL80 LCD — dreams & roadmap (2026-07-02)

Ideas for what to build on the AL80 LCD, grounded in the confirmed limits.

## The design brief (the limits, as constraints that shape good ideas)
- **96×160 portrait** panel, RGB565 — small, tall, phone-shaped. Favors vertical/single-focus
  content and pixel-art aesthetics; fights wide dashboards and dense text.
- **Live framebuffer, ~30–50fps** via flat region updates on the picture page (proven). This is
  the unlock: it's a *live display we can draw on*, not just a slideshow.
- **Three surfaces:** main page (96×64, shares space with the firmware clock), picture page
  (96×160, 16 slots, region-updatable), gif page (96×160, ≤160 frames, device loops at up to 60fps).
- **Inputs:** full keyboard + a **rotary knob** (rare and special for a screen controller).
- **Host-driven, browser-tethered:** content only runs while a tab is connected — unless we build
  an always-on host (see the SPARC plan). This is the biggest practical limit.
- **No hardware config** (brightness/rotation/clock-bg don't exist as commands). Design around it.
- **GIF inter-frame white-flash** is a firmware trait (limits smooth non-looping gif playback);
  the picture-page region path avoids it.

## Tier 1 — the real-time canvas (games + visualizers)
Portrait + knob + 30fps is made for these; region-update only what changes.
- **Tetris** — 96×160 ≈ a 10×20 well. The aspect ratio is a gift. Build this first among games.
- **Snake / Pong on the knob** — the knob as an analog controller is the differentiator.
- **Audio visualizer** — Web Audio FFT → bars/waveform reacting to what's playing.
- **Demoscene loops** — plasma, fire, starfield, boids, Conway's Life, the rotating ASCII donut.

## Tier 2 — custom clock faces (highest value-per-effort)
The firmware clock is fixed/ugly/un-styleable. Render our own, repaint just the digits/hands each
second: analog with sweeping hands, word clock ("IT IS HALF PAST TEN"), binary, flip-clock, a face
whose background is the current sky color. Un-gettable elsewhere; always useful; the perfect first
proof of the region-update loop.

## Tier 3 — the keyboard reacting to itself (most on-theme)
- Live **typing heatmap** (most-hit keys glow), **WPM meter** + burst screen-shake, **letter rain**.
- **Knob as a control surface** — scroll a menu / adjust volume / tune a value with feedback drawn
  on the keyboard's own screen. A closed physical loop.

## Tier 4 — ambient dashboard (needs the always-on host)
Now-playing album art (96×160 fits a cover), Pomodoro ring, weather, meeting countdown, build-status
badge (❌ on a webhook), scrolling ticker. Personal: the **wedding countdown** (bot already built) —
"N days until Kayla & Patrick" through 2026-03-21. All easy to render; the catch is they die when a
tab closes → the always-on host is what makes this tier real.

## Tier 5 — upload-once loops (device plays free, ≤160 frames)
Scrolling-text mantras, a loop library (campfire/rain/aquarium/lava lamp — lo-fi-keyboard energy),
a bouncing DVD logo, a tiny animated avatar of a pet or inside joke.

## Tier 6 — wild dreams (honest feasibility)
- **Two-person pager** — a message relayed through the seedbox appears on the keyboard. Very
  buildable with the existing bot infra; genuinely sweet.
- **Narrator/character bot gets a body** — the character-cast project lives on the panel as a little
  face with moods that reacts to activity. Screen becomes a companion, not a widget.
- **Video** — a few seconds of a clip on the gif page; real but low-fps (white-flash is the ceiling).
- **Webcam/monitor-crop mirror** — a few fps party trick.

## The architecture that ties it together
A **knob-navigable launcher / "LCD OS":** the screen shows a menu (Clock · Game · Visualizer ·
Dashboard · Gallery), the knob scrolls, a key selects, each mode is a plugin drawing to the same
region-update canvas. Once the shell exists, every idea above is just an app you drop in.

## Top 3 to chase first (after the morning byte-swap fix)
1. **Custom clock face** — un-gettable elsewhere, always on, proves the loop.
2. **Tetris on the knob** — the trophy; the portrait panel was born for it.
3. **The always-on local host** — unglamorous, but it's what turns half this list from a one-time
   demo into something you actually use. Planned in `al80-always-on-host-SPARC.md`.
