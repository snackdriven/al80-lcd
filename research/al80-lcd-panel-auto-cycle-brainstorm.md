# AL80 LCD Panel Auto-Cycle — Design Brainstorm

**Date:** 2026-07-10 · **Status:** brainstorm (not built) · **Feature:** auto-rotate the LCD through now-playing → weather → clock (main page) on a timer.

## What the code actually does today (the ground truth this rests on)

There are **two independent transport stacks**, and they don't meet:

**Stack A — the daemon (always-on, alerts).** `host/daemon.js` drives `host/transport-hid.js` (`HidTransport`). That transport is thin: `send(packets)` writes 64-byte reports and *counts* echoes for a liveness watchdog, but it does **no per-block ACK matching, no settle sleeps, no view switching, and no picture-ring management**. The daemon renders `clockApp` (a *bitmap* clock from `host/apps/clock.js` → `renderClock`), diffs it (`lib/diff.js`), and pushes region updates to the **picture page** via `buildImageTransfer`/`buildImageRegion`. Its own header (daemon.js:3-4) admits it deliberately skips the view switch because the visual path "needs the byte-swap banding fix first" — so today it's a pipeline/scheduler validator, not the pretty path. It owns the `Scheduler` (`lib/scheduler.js`) and the alert intake (`control/local-hook.js`, `127.0.0.1:7333/alert`).

**Stack B — the run-loops (the proven visual path).** `host/nowplaying-run.mjs` and `host/weather-run.mjs` are **two separate node processes**, each doing `new Device()` + `dev.open()` against `host/device.js`. `Device` is the rich one: ACK-gated sends (`_send({gate:true})` waits for each 0x41 block's echo, matching op + full offset, 4 retries — device.js:142-177), the settle sleeps the commit protocol needs (300 ms after the 0x40 announce, 30 ms after the `PK_ADD_PIC` setup — device.js:170-172), `sendCard(frame,{replacePrevious})` for ring hygiene, `deletePicture()`, `goHome()`, `sendClock()`, `setRGB()`, and `reopen()` with backoff.

**Single-opener is real and enforced.** `Device.open()` (device.js:70-72) throws "AL80 device busy (single-opener)" when another process holds the `0xFF60/0x61` interface. `weather-run.mjs`:15-17 spells it out: run weather **or** now-playing, never both. So you literally cannot run the two `.mjs` files together — this isn't a nicety, it's the OS handle.

**Which page each panel targets:**
- now-playing → **picture page**. `Device.sendFrame` → `buildImageTransfer` → `announce(0x10)` + `buildImageSetup` (the `A5 5A 0C` `PK_ADD_PIC` commit) + 548 data + `finish`. The commit *both* stores and displays the card. Critically (device.js:186-191 + protocol.js:142-148) you must **not** send `buildView(VIEW.PICTURE)` afterward — that's `PK_TOGGLE_PIC` (0x0d), which advances to the *next* slot and flips past your card.
- weather → **picture page**, identical mechanism.
- clock/home → **home page**. The run-loops "rest" here via `goHome()` (`buildView(VIEW.HOMEPAGE)` = 0x0b) and set the time with native `sendClock()` (`clockFromDate` → `buildClock`, protocol.js:176-203). Note this is a *different* clock than the daemon's `renderClock` bitmap.
- alerts → picture page, as a rendered `makeAlertApp` frame.

**Ring hygiene, exactly.** `PK_ADD_PIC` always commits to a *new* slot (there is no overwrite-in-place opcode — device.js:205-215). So every push grows the 16-slot ring and eventually wraps the user's saved pictures. The fix both run-loops use: before adding the next card, `deletePicture()` (0x0e with no index → deletes *the displayed slot*), then add. Net ring growth = zero. The `committed` flag gates it (`replacePrevious: committed`), and it's set false on the first push and after any reconnect, because after a reconnect you can't assume your card is still the displayed slot and `PK_DEL_PIC` hits whatever *is* (device.js:214, nowplaying-run.mjs:145).

**Data cadences and failure modes:** Spotify polls every 5 s, re-pushes every 15 s to advance the progress bar, and after 5 min paused it falls back to home (nowplaying-run.mjs:23-25). Nothing playing (204/null) → `deletePicture` + `goHome`. Weather polls every **10 min** (weather-run.mjs:26), only re-pushes when the reading key changes, and on fetch failure the host loop just logs and keeps the last card (the browser version substitutes `getWeatherMock`).

**Scheduler model:** `Scheduler` is a pure base-app + preempting-alert-stack (scheduler.js). `active()` returns the top alert or the base; `onAlert` dedups by source, sticky stays until `ack()`, transient expires on `update(now)`. It knows nothing about pages, views, or the ring — the daemon calls `active().render(now)` and pushes the bytes. App shape is `{id, fps, render(now)->frame}`, which clock/alert fit directly and now-playing/weather fit through `makeNowPlayingApp(getState)` / `makeWeatherApp(getState)` wrappers.

**Browser side:** `nowPlayingCtl` and `weatherCtl` (src/ui.js) are self-arming, tab-scoped, and **mutually exclusive by construction**: `startNP()` calls `weatherCtl.stop()` + `stopClockSync()`; `startWx()` calls `nowPlayingCtl.stop()` + `stopClockSync()`; clock-sync stops both. `setNowShowing` tracks the one view, and the `npLive` guard keeps the live owner's label from being clobbered. This is the "one screen, one owner" rule made literal — but it only runs while the tab is open.

The kicker: `host/apps/weather-DESIGN.md` already names this exact feature — "a timed rotation" of weather and now-playing — as deferred "scheduler concern... future work." This brainstorm is that work.

## Recommended architecture: a new unified host cycler on `device.js`

**Pick option (a): a new always-on host runner that owns one `Device` handle and rotates panels.** Reject (b) folding into `daemon.js`, reject (c) browser-first.

Why (a) over (b): the daemon's `transport-hid.js` is missing *every* primitive a visible cycler needs — ACK-gating (or you get banding), the commit settle sleeps (or the frame lands uncommitted), `deletePicture`/`goHome`/`sendCard` (ring + view), and `reopen`. All of that already exists, proven on-device, in `device.js`. Reconciling into the daemon means either porting all of `device.js` into `transport-hid.js` (rewriting the hard part) or teaching the daemon to hold a `Device` — at which point `transport-hid.js` is dead weight. The daemon's genuinely *worth keeping* piece is `scheduler.js` (the alert-preemption model) and `local-hook.js` (the intake). Those are portable: they're pure, and the cycler can hold a `Scheduler` and start a `startLocalHook(scheduler)` exactly like the daemon does.

Why (a) over (c): the browser cycle dies when the tab closes. This feature's whole appeal is set-and-forget ambient rotation, which is the host's job (the "now-playing survives on its own so the browser tab isn't the runtime" commit, abc3aea, already committed to this direction). Build the host cycler as the real home; a browser cycle mode is a nice phase-3 bonus but not where the logic should live.

So: **`host/cycle-run.mjs`** — one process, one `Device`, a rotation loop, background data pollers, and a `Scheduler` for alert preemption.

### Shape

```
host/
  cycle-run.mjs         NEW: owns Device, runs the rotation loop + alert intake
  panels/               NEW: refactor the two run-loops into shared "panel" modules
    nowplaying.js         poll()->state, render()->frame, page:'picture', available()
    weather.js            poll()->state, render()->frame, page:'picture', available()
    clock.js              show() -> sendClock+goHome, page:'home', always available()
  device.js             REUSE as-is (add nothing, or one tiny showCard helper)
  lib/scheduler.js      REUSE for the alert stack
  control/local-hook.js REUSE for /alert intake
  apps/nowplaying.js    REUSE render() untouched
  apps/weather.js       REUSE render() untouched
```

A "panel" is the honest generalization of what `nowplaying-run.mjs` and `weather-run.mjs` already are, minus the device-open boilerplate and their private `main()` loops:

```js
// panels/weather.js  (sketch — data poll decoupled from display)
export function makeWeatherPanel(env) {
  let state = null, lastFetchOk = 0;
  return {
    id: 'weather',
    page: 'picture',
    dwellMs: 20_000,
    async poll() {                    // called on weather's OWN cadence (10 min), not the dwell timer
      try { state = await getWeatherFromEnv(env); lastFetchOk = Date.now(); }
      catch (e) { /* keep last state; log */ }
    },
    available() { return state != null; },     // skip if we've never gotten a reading
    stale() { return Date.now() - lastFetchOk > 40*60*1000; },
    render() { return renderWeather(state); }, // apps/weather.js render(), untouched
  };
}
```

**Key decoupling: data polling runs on each panel's native cadence, independent of the display dwell timer.** Spotify keeps polling every 5 s and weather every 10 min *regardless of what's on screen*. The rotation timer only decides *which cached frame to display*. This solves the "off-screen progress bar" problem for free: while now-playing is off-screen its poll keeps running, so when it comes back on-screen the cached `state.progress` is current, not frozen at the value from three panels ago.

## The rotation engine: a small state machine, not `scheduler.js`

`scheduler.js` is the wrong tool for the *rotation* (it models preemption, one base app, no page/ring concept) but the right tool for *alerts on top of* the rotation. So: a purpose-built cycler drives the device; it consults a `Scheduler` only to ask "is an alert preempting right now?"

```js
// cycle-run.mjs (sketch)
const dev = new Device();
const scheduler = new Scheduler(null);              // base unused; we only use the alert stack
startLocalHook(scheduler);                           // /alert intake, same as daemon

const panels = [nowplaying, weather, clock];         // configurable order
let idx = 0;
let committed = false;                                // is OUR card the displayed picture slot?
let preempting = null;                               // the alert card we last drew, if any

// independent data pumps — NOT tied to the dwell timer
setInterval(() => nowplaying.poll(), 5_000);
setInterval(() => weather.poll(), 10*60*1000);
nowplaying.poll(); weather.poll();

async function showPanel(p) {
  if (p.page === 'home') {                            // clock: pull our card, rest on home
    if (committed) { await dev.deletePicture(); committed = false; }
    await dev.sendClock(); await dev.goHome();
  } else {                                            // picture panel: delete-before-add if we own the slot
    await dev.sendCard(p.render(), { replacePrevious: committed });
    committed = true;
  }
}

function nextAvailableIndex(from) {                   // skip unavailable / stale panels
  for (let n = 1; n <= panels.length; n++) {
    const p = panels[(from + n) % panels.length];
    if (p.available() && !p.stale?.()) return (from + n) % panels.length;
  }
  return from;                                        // nothing else available — hold
}

async function loop() {
  for (;;) {
    scheduler.update(Date.now());
    const alert = scheduler.active();                 // null base => no alert
    if (alert) {                                      // ALERT PREEMPTION
      await dev.sendCard(alert.render(new Date()), { replacePrevious: committed });
      committed = true; preempting = alert;
      await sleep(500); continue;                     // hold on the alert; re-check often
    }
    if (preempting) { preempting = null; await showPanel(panels[idx]); } // resume rotation

    const p = panels[idx];
    if (p.available() && !p.stale?.()) await showPanel(p);
    else idx = nextAvailableIndex(idx);               // current panel died — move on now

    await dwell(panels[idx].dwellMs);                 // sleep, but wake early if an alert POSTs
    idx = nextAvailableIndex(idx);
  }
}
```

Wrap the whole body in try/catch with `dev.reopen()` on a dropped handle, and reset `committed = false` after any reopen — this is the exact recovery the run-loops already do (nowplaying-run.mjs:143-148). Reuse `device.js`'s own `reopen`.

## Smart rules (the interesting part) — context-aware, not dumb round-robin

A pure round-robin is fine as the MVP but feels dumb fast. Proposed defaults:

1. **Drop now-playing from the rotation when nothing's playing.** now-playing's `available()` returns false when the Spotify poll yields null/204. So when music stops, the cycle naturally becomes weather ↔ clock. When a track starts, now-playing rejoins. Reuses the exact idle detection in nowplaying-run.mjs:157-167.
2. **Give now-playing priority/longer dwell while playing.** Longer dwell (now-playing 30 s vs weather/clock 15 s), and/or "sticky while active": on a **track change**, jump to now-playing immediately (interrupt the dwell) and reset its dwell — new song starts, screen shows it right then. The 5 s poll sets a `wantsFocus` flag on track change; `dwell()` wakes on it.
3. **Skip stale/failed panels.** weather `stale()` = last successful fetch > 40 min → skip rather than show a stale temperature. Never-arrived data → skip. If everything's unavailable, hold on the clock (always available — local time, no data source).
4. **Configurable via env** (matches the project's env-config habit): `CYCLE_PANELS=nowplaying,weather,clock`, `CYCLE_DWELL_MS=15000` + per-panel `CYCLE_DWELL_NOWPLAYING=30000`, `CYCLE_NP_FOCUS_ON_CHANGE=1`, `CYCLE_MODE=smart|roundrobin`.

Sensible default: `[nowplaying(30s, focus-on-change), weather(15s), clock(15s)]`, smart mode, now-playing auto-dropped when idle.

## Transitions, ring, and view management — the exact sequences

The invariant is one boolean: **`committed` = "our card is the currently-displayed picture slot."**

| From → To | Sequence | `committed` after |
|---|---|---|
| picture → picture (np→wx, wx→np, either→alert) | `sendCard(frame, {replacePrevious: true})` | `true` |
| home(clock) → picture | `sendCard(frame, {replacePrevious: false})` | `true` |
| picture → home(clock) | `deletePicture()` → `sendClock()` → `goHome()` | `false` |
| first push after start | `sendCard(frame, {replacePrevious: false})` | per page |
| after reopen() | force `committed = false` | reset |

**Cost budgeting for dwell.** A picture→picture swap is delete (2 control packets) + 60 ms settle + a full gated frame (300 ms announce settle + 30 ms setup + 549 ACK-gated blocks) ≈ 1-1.5 s of transition. picture→home is cheap. So **don't set dwell below ~8-10 s** or you spend a meaningful fraction of the cycle mid-transition and churn the module. 15-30 s keeps overhead under ~10%.

**Off-screen now-playing progress bar:** solved by the decoupled poll — the bar is re-rendered from fresh cached state when now-playing next takes the screen; no wasted writes while off-screen.

**Alert coexistence:** alerts are picture-page cards too, so they slot into the same `committed` accounting. Preemption = `sendCard(alert, {replacePrevious: committed})`, freeze the dwell, poll `scheduler.update()` often. On expiry/ack, resume by re-showing the current rotation panel. Sticky error alerts hold the screen until `/ack`. Reuses `scheduler.js` + `local-hook.js` unchanged.

## Reuse vs refactor — honest accounting

**Reuse untouched:** `device.js` (every primitive is there), `apps/nowplaying.js` `render()`, `apps/weather.js` `render()`, `apps/clock.js`, `lib/spotify.js`, `lib/weather.js`, `lib/art.js`, `lib/scheduler.js`, `control/local-hook.js`.

**Refactor (the real work):** extract the *loop bodies* of the two `.mjs` runners into `panels/nowplaying.js` and `panels/weather.js`. Today those files interleave (1) device open/reopen, (2) data poll + state-change keys + art cache, (3) display push + ring hygiene. The cycler owns (1) and (3); the panels keep (2) as `poll()`/`available()`/`render()`. ~70% of each `.mjs` is reusable as-is (token/refresh, art cache, `progressOf`, `readingKey`, idle detection) — it just moves behind a panel interface. The `.mjs` runners can stay as thin single-panel entry points.

**Rewrite/new:** `cycle-run.mjs` (loop + transition state machine + env config), maybe a 5-line `dev.showPanel()` helper.

Don't touch `transport-hid.js` or `daemon.js` — leave the daemon as-is, or later retire it once the cycler subsumes alert intake. No need to reconcile the two transports; build on the better one.

## Host vs browser
**Host is the home for this** — the no-tab, always-on, set-and-forget path (the point of an ambient rotation, and the direction abc3aea committed to). The browser controllers are tab-scoped and mutually exclusive by design; bending them into a cycler fights ui.js's "one tab section = one owner" model. A **browser cycle mode is worth it later as a preview/demo** (phase-3, sequencing the existing `nowPlayingCtl`/`weatherCtl`/clock-sync on a timer) but can never be the always-on runtime.

## Risks and unknowns
- **Transition banding / uncommitted frames** under aggressive dwell → floor the dwell, reuse `device.js` gating exactly.
- **`PK_DEL_PIC` hits "the displayed slot," unreadable** — the whole `committed` scheme is a write-only-device workaround; after any desync, `committed=false` and accept one extra ring slot rather than a wrong delete (run-loop philosophy).
- **Alert-during-transition race** — make each `showPanel`/preempt an awaited critical section (a `sending` mutex).
- **Clock panel = native home vs bitmap** — recommend native `sendClock`+`goHome` (cheap, matches rest state); but pushing `renderClock` as a picture card instead would make everything a picture card (`committed` always true, no home dance) — simpler state machine, loses the native home clock's zero-cost view. Prototype both.
- **Spotify token rotation** (PKCE rotates per use) must keep working — panel keeps the exact `accessToken()` logic; don't run two pollers against one refresh token.

## Phased plan
- **Phase 0 — refactor (no behavior change).** Extract `panels/nowplaying.js` + `panels/weather.js`; keep the `.mjs` files working as thin launchers. Ship alone.
- **Phase 1 — MVP dumb cycler.** `cycle-run.mjs`: one Device, fixed dwell, transition state machine, decoupled data pumps, reopen recovery. Round-robin, skip-if-unavailable. No alerts yet.
- **Phase 2 — smart rules + alerts.** Drop-when-idle, per-panel dwell, focus-on-track-change, stale skipping, env config. Fold in `Scheduler` + `startLocalHook`.
- **Phase 3 — polish + Studio UI.** Transition tuning, optional RGB-sync-per-panel, a Studio "Cycle" tab (config + in-browser preview). Retire `daemon.js`/`transport-hid.js` if subsumed.

**The single most important finding:** `device.js` already contains every primitive a cycler needs, and the two run-loops are 70% a shared "panel" waiting to be extracted. The build is mostly a refactor plus a ~150-line loop, not new protocol work.
