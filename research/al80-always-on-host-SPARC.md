# AL80 Always-On Host — SPARC plan (2026-07-02)

A resident local process that owns the AL80 LCD's HID interface and drives it continuously with
pluggable content, independent of any browser tab. This is the enabler for the whole ambient tier
(clocks, dashboards, notifications) — the browser app only runs while a tab is connected.

---

## S — Specification

### Problem
The LCD is driven via WebHID in a browser tab. Content stops the moment the tab closes or
disconnects. Ambient uses need the display to update continuously, unattended, surviving reboots
and replugs. Only one process can hold the `0xFF60/0x61` interface at a time, so a naive daemon
would also lock the browser app out.

### Goal
A resident process on the machine where the AL80 is plugged in (**Windows 11** — the keyboard is
local; the seedbox can't reach USB) that:
- owns the HID interface and drives the LCD from pluggable "apps," and
- brokers access so the existing browser app still works (no single-opener conflict).

### Functional requirements
- **FR1** Find + open the AL80 raw-HID interface (VID `0x28E9`, PID `0x30AF`, usagePage `0xFF60`,
  usage `0x61`); write 64-byte reports (reportId 0); read input reports (ACK echoes, knob/keys).
- **FR2** Run a **default app (clock)** at login with no user action.
- **FR3** Pluggable **app model**; switch apps via config, the control API, and the **knob**.
- **FR4** **Region-update rendering** at each app's fps (diff vs last framebuffer); full-frame on
  app switch. Reuse `al80-studio/src/protocol.js` verbatim.
- **FR5** **Local control API** (WebSocket on `127.0.0.1`) so `al80-studio` and a CLI/tray can
  command the daemon — the daemon is the sole HID owner and a broker.
- **FR6** **Native system stats** (CPU/RAM/net) for dashboard apps — a native daemon can read these
  directly (the browser can't).
- **FR7** **Persist config**; support a **time schedule** (different app by time of day).
- **FR8** **Auto-reconnect** on replug; **graceful release** on shutdown/quit; **release/reacquire**
  so the browser can take direct control for latency-critical modes (games) and hand back.

### Non-functional
- **NFR1** Single source of protocol truth: import `protocol.js` unchanged (already pure ES module,
  17 unit tests). The banding byte-swap fix (once confirmed) lands in the shared frame→RGB565
  packer, so daemon + browser inherit it together.
- **NFR2** Low idle CPU: self-correcting timer, 56-byte-block-granular diffs, idle apps (clock)
  push ~1 update/sec; sleep when nothing changed.
- **NFR3** Never wedge the device: use the correct paths (flat still/region = unpaced; gif = the
  `sendGif` pacing). Back off if the device NAKs.
- **NFR4** Never emit bootloader opcodes `0xB0–0xB7`; never reflash.
- **NFR5** Windows-first, but node-hid runs on Mac/Linux too (the user has a Mac + WSL) — keep the
  transport the only platform-specific module.

### Non-goals (v1)
- No cloud sync, no multi-device.
- No games *in the daemon* — games want the browser's input latency and the user present; the
  daemon focuses on always-on ambient content and hands off to the browser for interactive modes.
- Not a SYSTEM Windows service initially — a **login-scoped** process (Task Scheduler / tray) is
  enough and avoids service-session USB-access headaches.

### Risks
- node-hid native install on Windows (prebuilt binaries exist; fallback needs build tools).
- Rendering in Node needs a canvas lib (`@napi-rs/canvas`, skia-based, prebuilt).
- Handoff correctness (daemon ↔ browser) is the trickiest logic — designed explicitly in R.

---

## P — Pseudocode

### Transport (node-hid)
```
open():
  path = HID.devices().find(d => d.vendorId==0x28E9 && d.productId==0x30AF
                                 && d.usagePage==0xFF60 && d.usage==0x61).path
  dev = new HID.HID(path)
  dev.on('data', onInputReport)   // ACK echoes (byte6==0x55) + knob/key reports
  dev.on('error', () => transition(SEARCHING))
write64(bytes):
  dev.write([0x00, ...pad(bytes, 64)])         // reportId 0 prepended (Windows)
send(packets):        for p in packets: write64(p)          // flat/still/region — no pacing
sendGif(packets):     replicate hid.sendGif pacing (30ms/bank, 3000ms frame0/every16th, 30ms setups)
close(): dev.close()
```

### App model + renderer
```
App = { id, fps, init(ctx), render(ctx, tMs) -> Uint8Array(30720), teardown() }

diff(prev, next):                      // -> full transfer or region updates
  changed = blocks (56B-aligned) where prev != next
  if !prev || changedArea > 60%:  return buildImageTransfer(next)     // full
  else:                           return buildImageRegion(next, changed)  // partial (PoC path)

buildImageRegion(frame, blocks):       // NEW small helper in protocol.js
  return [announce(0x10), imageSetup(), ...dataBlocksFor(blocks), finish()]
```

### Main loop (self-correcting)
```
loop:
  app = scheduler.active(now())        // config or time-based; knob can override
  next = app.render(ctx, now())
  packets = diff(fbPrev, next)
  transport.send(packets)              // or sendGif for gif apps
  fbPrev = next
  sleepUntil(lastTick + 1000/app.fps)  // skip if released or device SEARCHING
```

### Broker + input nav
```
ws.on(msg):
  switchApp(id) | setConfig(c) | uploadImage(frame) | status()
  release()   -> transport.close(); state=RELEASED           // browser takes over
  reacquire() -> transport.open();  state=RUNNING
onInputReport(data):
  if isKnobTurn(data): scheduler.cycleApp(dir)
  if isSelectKey(data): scheduler.commit()
```

### Reconnect state machine
```
SEARCHING --(device path appears)--> OPEN --(ok)--> RUNNING
RUNNING --(write error / 'error')--> close --> SEARCHING (poll ~1s)
RUNNING --(ws 'release')--> RELEASED --(ws 'reacquire' OR device-free poll)--> OPEN
on RUNNING entry: send a full frame (resync after any gap)
```

---

## A — Architecture

### Stack
- **Node.js LTS**, plain ESM (matches al80-studio; no build step).
- **node-hid** — native transport (write/read reports, device enumeration with usagePage).
- **@napi-rs/canvas** — Canvas2D rendering → `getImageData` → RGB565 packer (shared with browser).
- **ws** — localhost WebSocket control.
- **systeminformation** (or `node:os`) — CPU/RAM/net for dashboards.
- Autostart: **Task Scheduler** (At Log On, hidden, restart-on-fail) for v1; a **tray app**
  (`systray2` or a tiny Tauri/Electron shell) as the M4 UX upgrade.

### Modules
```
al80-host/
  daemon.js        wiring: loop + reconnect FSM + lifecycle + signal handling
  transport.js     node-hid wrapper (the only OS-specific file)
  protocol.js      -> imported/symlinked from al80-studio/src (single source)
  renderer.js      canvas->RGB565 packer, framebuffer diff, region builders
  scheduler.js     active app + time schedule + knob override
  control.js       ws server + input-report (knob/key) decoding
  apps/
    clock.js       default; custom faces
    dashboard.js   native system stats
    nowplaying.js  media API / album art
    notify.js      webhook -> badge
    gallery.js     16-slot photo cycler
  config.json      persisted state (active app, per-app settings, schedule)
```

### Data flow
```
[apps] render Uint8Array frame
   -> renderer.diff(prev,next) -> region/full packets (protocol.js)
   -> transport.send -> node-hid -> USB -> keyboard MCU -> LCD module
[knob/keys] -> node-hid inputreport -> control.decode -> scheduler
[al80-studio browser] -> ws://127.0.0.1 -> control -> scheduler/transport
[system] -> systeminformation -> dashboard app
```

### Coordination model (the single-opener answer)
**Broker-primary:** when the daemon is running it is the *sole* HID owner; `al80-studio` detects the
daemon (ws ping) and sends high-level ops instead of opening WebHID. No handoff needed for normal
use. For latency-critical browser modes (games, live drawing), the browser sends `release`, the
daemon closes the device, the browser opens WebHID directly, and on tab-close/disconnect the daemon
**auto-reacquires** when it polls the device free (belt-and-suspenders vs. the browser forgetting to
`reacquire`). If the daemon is absent, `al80-studio` uses WebHID directly (today's behavior) — so
the app degrades gracefully.

---

## R — Refinement

### Hard problems, resolved
1. **Handoff races** — daemon owns a `state` (RUNNING/RELEASED/SEARCHING); `release` is idempotent;
   auto-reacquire polls `HID.devices()` for the interface being openable again. Browser uses a
   `navigator.sendBeacon`/`unload` to fire `reacquire` on tab-close, with the poll as backup.
2. **Wedge avoidance** — respect the two paths: region/still = flat unpaced (safe, proven);
   gif = `sendGif` pacing. Never mix. If a write throws or ACKs stop (echo watchdog), drop to
   SEARCHING and full-resync rather than pushing into a wedged device.
3. **Reconnect** — FSM above; on reopen, always push a full frame first (region diffs assume the
   panel matches `fbPrev`, which is stale after a gap).
4. **Perf** — one reused canvas; diff at 56-byte-block granularity; per-app fps caps (clock 1fps,
   visualizer 30fps); when `diff` is empty, skip the send and sleep.
5. **Banding fix inheritance** — the RGB565 packer lives in `renderer.js` + the browser share the
   same swap-alternate-rows logic once the morning test names the parity. One fix, both hosts.
6. **Scheduling** — `config.schedule = [{from,to,app}]`; knob override sets a temporary active app
   until midnight or next explicit change.
7. **Security** — ws bound to `127.0.0.1` only; ops are display-only; no secrets on the wire.

### Testing
- `transport-mock.js` writes each frame to a timestamped PNG → develop apps with **no device**.
- Unit tests: `diff` correctness (region math), region builder byte-layout, RGB565 packer parity.
- **Soak test:** 24h run watching for memory growth, wedges, missed reconnects.
- Golden test: daemon clock frame == browser clock frame for the same timestamp (shared code).

---

## Caveats, unknowns & workarounds (pre-mortem)

Three de-riskers that change the risk profile:
- **The echo channel is a self-test.** The device ACKs every report (`byte6=0x55`), so we can
  auto-detect the correct report length (send 63 vs 64, see which echoes) and use echoes as a
  **health watchdog** — if they stop, back off before the device wedges.
- **Mock transport (frames→PNG)** quarantines the hardware unknowns: ~90% of the code (apps, diff,
  render) is built and tested with no device. (Done — see `al80-studio/host/`.)
- **Browser-kiosk is a full fallback.** If node-hid fights us, "always-on" can be an auto-started
  minimized Chrome tab running the existing app — reuses 100% of browser code, zero new transport.

Load-bearing unknowns, ranked, each with a workaround:
1. **Can node-hid open + write `0xFF60/0x61` on Windows?** Foundational. *Mitigation:* the M0 spike
   tests it in ~30 min, verified by the ACK echo. Fallback: browser-kiosk. (Decision gate.)
2. **Can a wedged device recover without a physical replug?** Genuine unknown (we always replugged).
   *Mitigation:* wedge-*avoidance* via the echo watchdog (never outrun ACKs); test `close()`+`open()`
   soft-reset in M0; worst case the daemon shows a static frame + asks for a replug instead of
   hammering a locked device.
3. **Knob/key nav needs input access = keylogger-adjacent** (the knob rides the keyboard HID
   interface the OS owns). *Correction:* drop from v1. Interactive modes run in the browser (keydown
   for free); the daemon is driven by the control API + schedule. Knob-nav is an opt-in M4 feature
   with the privacy caveat stated.
4. **The banding fix might not hold.** *Mitigation:* ambient content can target the **main page
   (96×64, renders solids correctly)** instead of the picture page; or use textured/dithered
   backgrounds so the artifact hides; make the swap parity a config value, not code.
5. **Single-opener coordination > one line.** *Phase it:* v1 uses a **lease** — al80-studio pings
   `localhost:7333` on Connect, the daemon releases + backs off, then auto-reacquires when it polls
   the device free (~10-line browser shim, not a rewrite). Third-party apps (VIA, yunzii-game.com)
   won't honor a lease → tray needs a manual "pause."
6. **Now-playing / webhooks need bridges.** Media via a shelled PowerShell/WinRT call or the Spotify
   Web API; external webhooks via the **seedbox as an outbound relay** (daemon holds an outbound WS
   to the seedbox) — which also gives phone→seedbox→keyboard remote control and is the two-person
   pager's exact shape.

Smaller: fonts can fail headless → **hand-rolled bitmap font** for MVP (done, zero canvas dep);
WebHID grants may not survive a replug (hurts kiosk, not node-hid — point for native); laptop
battery → adaptive fps; **reconnect must always push a full frame** (region diffs assume the panel
matches the last frame — stale after any gap).

**Revised recommendation:** don't pre-commit the architecture — let the M0 spike decide. node-hid
opens+writes cleanly in 30 min → go native. It fights → ship the browser-kiosk clock first. Either
way, the mock + apps (built now) mean app development never waits on hardware.

## Progress (2026-07-02)
- **M1 app layer started, device-free & validated:** `al80-studio/host/` — mock transport that
  reassembles real packets into a framebuffer (validates the builders), a 5×7 **bitmap-font clock**,
  a **region diff** (a one-second tick = 60 blocks vs 549 full, ~9× cheaper), zero-dep PNG preview.
  `node host/demo.js` renders + validates a clock sequence; `host/test/roundtrip.test.mjs` passes.
- Added `buildImageRegion(frame, start, end)` to `protocol.js` (the real-time partial-update path;
  17 protocol tests still green).
- **Pending:** the M0 node-hid spike (native transport) — the one thing that still needs the device.

## C — Completion

### Milestones
- **M0 — spike (½ day):** Node + node-hid opens `0xFF60/0x61`, pushes a clock via `protocol.js`,
  logs an ACK echo. Proves native transport end-to-end.
- **M1 — MVP daemon (core deliverable):** main loop + clock app + region diff + reconnect FSM +
  config + Task Scheduler autostart. Result: **an always-on custom clock** that survives reboot
  and replug.
- **M2 — broker:** ws control; `al80-studio` detects + routes through the daemon; release/reacquire.
  Single-opener solved.
- **M3 — apps:** dashboard (native stats), now-playing, notify webhook, gallery cycler; time
  schedule; knob navigation.
- **M4 — polish:** tray app (status/pause/switch/quit-to-free), single-exe packaging (`pkg`/SEA),
  mock transport + test suite, the knob-navigable **launcher / LCD OS** shell.

### Acceptance (MVP = M1+M2)
- After a reboot with **no browser open**, the LCD shows a live custom clock updating each second.
- Unplug/replug recovers within a few seconds (full resync, no wedge).
- Opening `al80-studio` can take over (release) and hand back (reacquire) without wedging the panel.
- Idle CPU negligible; 24h soak clean.

### First steps
1. `mkdir al80-host`, `npm init`, add `node-hid @napi-rs/canvas ws systeminformation`.
2. Symlink/copy `al80-studio/src/protocol.js`; add `buildImageRegion` there (used by browser too).
3. Build M0 spike; confirm ACK echo matches the WebHID findings (byte6=0x55).
4. Grow into M1; wire Task Scheduler; ship the always-on clock.

### Open decisions (pick during M1)
- Repo layout: `al80-host` as a sibling repo, or a `host/` package inside `al80-studio` (favor the
  latter to share `protocol.js` without a symlink).
- Tray tech: `systray2` (light) vs Tauri (nicer, heavier). Defer to M4.
