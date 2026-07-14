# SPARC — AL80 LCD Panel Auto-Cycle

**Date:** 2026-07-10 · **Feature:** an always-on host runner (`host/cycle-run.mjs`) that rotates the AL80 LCD through now-playing → weather → clock on a dwell timer, with smart inclusion rules + alert preemption. **Status:** design, verified against source. Supersedes `al80-lcd-panel-auto-cycle-brainstorm.md`. Corrections to the brainstorm are flagged **[CORRECTION]** — an implementer must not copy those parts blindly.

---

## S — Specification

### Goal
One host process owns the single LCD handle and rotates cached panel frames on a timer: now-playing while music plays, weather + clock otherwise, preempting to an alert card when one arrives. Set-and-forget, no browser tab. Generalizes the "now-playing survives on its own" direction (commit `abc3aea`) to N panels.

### Functional
- **FR1** Rotate an ordered, configurable panel set on a per-panel dwell. Default `[nowplaying, weather, clock]`.
- **FR2** Each panel polls its source on its OWN cadence, decoupled from the dwell (Spotify 5s, weather 10min). The dwell only chooses which cached frame to display.
- **FR3** Skip panels not available (no data) or stale (too old). If only the clock is available, hold on the clock.
- **FR4** Drop now-playing when nothing's playing (Spotify 204/null); rejoin on a new track.
- **FR5** On a track change, jump to now-playing immediately + reset its dwell (focus-on-change), gated by `CYCLE_NP_FOCUS_ON_CHANGE`.
- **FR6** Alerts to `127.0.0.1:7333/alert` preempt: draw the alert card, freeze the dwell, hold until transient TTL / sticky `/ack`, then resume.
- **FR7** Keep the 16-slot picture ring net-zero (delete-before-add) exactly as the run-loops do.
- **FR8** Recover a dropped USB handle via `Device.reopen()`, resetting the ring-ownership flag.
- **FR9** `CYCLE_MODE=roundrobin` disables smart rules (pure fixed rotation) for debug/demo.
- **FR10** The two existing `.mjs` runners keep working as single-panel launchers after the refactor (Phase 0 is behavior-preserving).

### Non-functional
- **NFR1 No banding** — every picture push goes through `Device._send({gate:true})` (ACK-gated + 300/30ms settles, `device.js:152-175`). No faster path.
- **NFR2 Transition overhead < ~10% of dwell** — a picture→picture swap ~1-1.5s (delete + 60ms + gated frame). Floor dwell at ~8s; default 15-30s.
- **NFR3 Single device owner** — all HID I/O confined to the rotation loop. Data pumps + the alert HTTP handler touch state only, never `dev`. **[CORRECTION]** this confinement, not a `sending` mutex, is the real fix for the alert-during-transition race (A6).
- **NFR4 Device-free testable** — transitions, ring accounting, skip logic, alert interleave unit-testable via `transport-mock.js`.
- **NFR5 Deterministic time** — the loop steps as `tick(now)` with injectable `now()`/sleep (mirrors `Scheduler.update(now)` `scheduler.js:35`).

### Scope / non-goals
In: host cycler, panel modules, config, alert reuse, device-free tests. Out (this build): browser cycle mode (Phase 3 preview only), RGB-per-panel (Phase 3 optional), GIF panels, geocoding, retiring the daemon. **Explicitly not reconciled:** `daemon.js` + `transport-hid.js` — a separate thinner validator stack (no ACK-match/settle/ring/view, `transport-hid.js:38-44`) rendering the *bitmap* clock with region diffs, deliberately skipping the view switch (`daemon.js:1-5`). Build on `device.js`, leave the daemon alone.

### Constraints (verified)
| Constraint | Source |
|---|---|
| **Single-opener** — `Device.open()` throws "device busy" if another process holds `0xFF60/0x61`. | `device.js:65-73`; `weather-run.mjs:15-17` |
| **One screen, one owner** — the LCD is a single surface. | `weather-run.mjs:15-17`; `ui.js` mutual-exclusion |
| **Ring hygiene** — `PK_ADD_PIC` always commits a NEW slot (no overwrite). Delete-displayed-slot before each add, gated by `committed`; reset false on first push + after any reconnect (PK_DEL_PIC hits whatever's displayed — never delete blind). | `device.js:204-222`; `protocol.js:230-232`; `nowplaying-run.mjs:145`, `weather-run.mjs:78` |
| **Two transports, don't merge** — `device.js` (rich) vs `transport-hid.js` (thin). | those files |
| **Never `buildView(PICTURE)` after a card** — that's `PK_TOGGLE_PIC`, advances the ring past your card. | `device.js:186-191`; `protocol.js:207-241` |

**[CORRECTION] block count:** the brainstorm says "548 data." It's **549** (548×56-byte + 1×32-byte tail, `protocol.js:19-21` `BLOCK_COUNT=549`; `device.js:186`). The dropped tail was the original not-rendering bug.

---

## P — Pseudocode
The loop is a step function `tick(now)` + background pumps. All device I/O lives inside `tick`/its callees.
```
STATE: panels[], idx=0, committed=false, preempting=false, dwellUntil=0, scheduler=Scheduler(null)
BACKGROUND (never touch dev): every 5s np.poll(); every 10min wx.poll(); HTTP :7333 -> scheduler.onAlert()

async tick(now):
  scheduler.update(now)                                    // expire transient alerts
  const alert = scheduler.alertCount > 0 ? scheduler.active() : null   // [CORRECTION] A5
  if (alert):                                              // ALERT PREEMPTION
    if (!preempting || alert !== lastAlertShown):
      await pushCard(alert.render(new Date())); preempting=true; lastAlertShown=alert
    return                                                 // hold; dwell frozen
  if (preempting):                                         // alert cleared -> resume
    preempting=false; lastAlertShown=null
    await showPanel(panels[idx]); dwellUntil=now+panels[idx].dwellMs; return
  if (mode==='smart' && npFocusOnChange):                 // FOCUS-ON-CHANGE
    const npi = panels.findIndex(p=>p.id==='nowplaying')
    if (npi>=0 && panels[npi].wantsFocus?.()):
      idx=npi; await showPanel(panels[idx]); dwellUntil=now+panels[idx].dwellMs; return
  const p = panels[idx]
  if (dwellUntil===0):                                     // first tick
    idx=nextAvailableIndex(idx,true); await showPanel(panels[idx]); dwellUntil=now+panels[idx].dwellMs; return
  if (!available(p)):                                      // current panel died mid-dwell
    idx=nextAvailableIndex(idx); await showPanel(panels[idx]); dwellUntil=now+panels[idx].dwellMs; return
  if (now>=dwellUntil):                                    // dwell elapsed -> advance
    idx=nextAvailableIndex(idx); await showPanel(panels[idx]); dwellUntil=now+panels[idx].dwellMs; return
  // else still dwelling

available(p): return (p.available() && !(p.stale?.())) || mode==='roundrobin'
nextAvailableIndex(from, includeCurrent=false):
  for (n=(includeCurrent?0:1); n<=panels.length; n++){ const i=(from+n)%panels.length; if (available(panels[i])) return i }
  return from                                              // nothing else -> hold

// device I/O primitives (the ONLY code touching dev):
async showPanel(p):
  if (p.page==='home'): if (committed){ await dev.deletePicture(); committed=false } await dev.sendClock(); await dev.goHome()
  else: await pushCard(p.render()); if (syncRGB && p.rgb?.()) await dev.setRGB(p.rgb())
async pushCard(frame): await dev.sendCard(frame,{replacePrevious:committed}); committed=true

// driver (real timers):
loop forever:
  try { await tick(Date.now()) }
  catch(e){ if (!dev.opened){ committed=false; await dev.reopen(); dwellUntil=0 } }
  await sleep(TICK_MS)                                     // ~500ms; alerts land fast, dwell honored to a tick
```
The dwell is a wall-clock deadline (`dwellUntil`) checked each tick, NOT `sleep(dwellMs)` — so alerts + panel-death interrupt it naturally without a wake-on-flag mechanism.

---

## A — Architecture

### A1. Module map
```
host/
  cycle-run.mjs   NEW  owns Device+Scheduler+startLocalHook; runs tick()+pumps; parses env
  cycle.js        NEW  pure(ish) core: tick(now), showPanel, nextAvailableIndex, committed FSM (split so tests drive tick() with a RecordingDevice)
  panels/         NEW  nowplaying.js / weather.js / clock.js  (the Panel interface, A2)
  device.js / lib/scheduler.js / control/local-hook.js / apps/{nowplaying,weather}.js / lib/{spotify,weather,art}.js   REUSE unchanged
  nowplaying-run.mjs / weather-run.mjs   REFACTORED into thin launchers over the panels
  test/ transport-mock.js REUSE; recording-device.js NEW; cycle.test.mjs NEW
```
Split `cycle.js` from `cycle-run.mjs` (the daemon proves this — a `Daemon` class + stepped `run()`, `daemon.js:63-86`) so tests drive `tick(now)` with explicit timestamps + a `RecordingDevice`, like `scheduler.test.mjs` drives `update(now)`.

### A2. Panel interface (formal contract)
**[CORRECTION]** the brainstorm's clock panel exposes `show(dev)` (does its own I/O), fragmenting the `committed` invariant. Instead: **panels are pure data + render; the cycler owns every device call + the `committed` flag.** `page` tells the cycler which transition to run.
```ts
interface Panel {
  id: 'nowplaying'|'weather'|'clock';
  page: 'picture'|'home';        // 'picture' -> sendCard(render()); 'home' -> sendClock+goHome
  dwellMs: number;
  poll(): Promise<void>;         // fetch on OWN cadence; update state; MUST NOT throw; never touch dev
  available(): boolean;
  stale?(): boolean;             // default never
  wantsFocus?(): boolean;        // consume-once track-change jump (nowplaying only)
  render?(): Uint8Array;         // 30720-byte frame; REQUIRED iff page==='picture'; pure
  rgb?(): {hue,sat}|null;        // Phase-3 optional
}
```
`poll()` swallows its own errors + keeps last good state (`weather-run.mjs:58`, `nowplaying-run.mjs:107`). `render()` is pure (already is: `apps/nowplaying.js:144`, `apps/weather.js:201`). `available()`/`stale()` are cheap sync reads.

**nowplaying panel** (extracted from `nowplaying-run.mjs`): owns `tokenCache`+`accessToken()` PKCE (`:44-59`), `currentTrack()` incl. `invalid_grant` + 401-refresh (`:61-77`), `artCache`/`cacheArt` (`:27-32`), `fetchArtRGB` (`:34-41`), `progressOf` (`:79-83`), idle/paused bookkeeping.
```
poll(): np=await currentTrack()
  if np?.title: pausedSince = np.paused?(pausedSince??now):null; cache art on track change
    state={title,artist,artRGB,progress:progressOf(np),paused,elapsedMs,durationMs}
    if np.trackId!==lastTrackId: _wantsFocus=true; lastTrackId=np.trackId
  else state=null
available(): state!=null && !(state.paused && now-pausedSince>=PAUSE_HOME_MS)   // 5min paused -> drop
stale(): false                          // Spotify 5s poll owns freshness
wantsFocus(): w=_wantsFocus;_wantsFocus=false;return w
render(): renderNowPlaying(state)
```
**Decoupling payoff (FR2):** the runner's 15s progress re-push (`PROGRESS_REFRESH_MS`, `:24,:114`) disappears — `poll()` keeps `state.progress` fresh every 5s whether or not on screen; no off-screen writes.

**weather panel** (from `weather-run.mjs`):
```
poll(): try{ state=await getWeatherFromEnv(env); lastOkAt=now }catch{/*keep last*/}
available(): state!=null
stale(): now-lastOkAt > WEATHER_STALE_MS      // default 40min
render(): renderWeather(state)
```
The runner's `readingKey` change-gate (`:34-36`) is NOT needed — it existed to avoid ring churn on re-push; the cycler only pushes weather when it takes the screen. Drop it.

**clock panel:** `{id:'clock',page:'home',dwellMs:15000,poll:async()=>{},available:()=>true}` — no render; `page:'home'` → delete?+sendClock+goHome; always available (RTC, no data) — the FR3 fallback.

### A3. cycle-run.mjs (launcher)
Build panels from `CYCLE_PANELS`; `new Device()` + open (or reopen, like the runners `:87-91`); `new Scheduler(null)` (base unused); `startLocalHook(scheduler,{port})` (reuse 7333); start the native-cadence pumps (`setInterval(p.poll, pollMs[id])`); `await cyc.run()`. SIGINT: if `committed && dev.opened` → `deletePicture`, then close (mirrors runners `:93-99,:46-52`).

### A4. Refactor plan (before→after = Phase 0, behavior-preserving)
`nowplaying-run.mjs` interleaves 3 concerns → split: device open/reopen (`:86-91,:143-148`) → cycler; data poll + PKCE + art cache + idle/progress/reading keys (`:27-83,:107-130,:157-167`) → `panels/nowplaying.js`; display push + ring hygiene (`:118,:137,:161-165`) → cycler. `weather-run.mjs` splits the same way. The `.mjs` become ~20-line launchers (open, poll+render+sendCard on the panel's cadence, same SIGINT), same CLI (`--live/--sync/--mock-device`), same behavior. ~70% of each runner moves UNCHANGED behind the interface; the new code is `cycle.js`+`cycle-run.mjs` (~150 lines) + 3 thin wrappers.

### A5. Scheduler reuse — right for alerts, wrong for rotation
`Scheduler` models one base app + a preempting alert stack; `active()` = top alert ELSE base; knows nothing of pages/views/ring. Perfect for alerts-on-top, wrong for the rotation (cycler's own FSM owns that). **[CORRECTION]** don't rely on `Scheduler(null)+active()` truthiness (conflates "no alert" with "base app"). Be explicit: `const alert = scheduler.alertCount>0 ? scheduler.active() : null` (`scheduler.js:51,:18`). Base stays null, never rendered. `startLocalHook(scheduler)` (`local-hook.js:12`) reused verbatim (`/alert`→onAlert, `/ack`→ack, `/status`) — mutates scheduler state only, no device I/O (preserves NFR3).

### A6. Transition state machine + the alert race
Invariant: **`committed` = "our card is the displayed picture slot."**
| From → To | Ops (cycler-issued) | committed after |
|---|---|---|
| picture→picture (np↔wx, panel→alert, alert→panel) | `sendCard(frame,{replacePrevious:true})` → internally deletePicture+60ms+sendFrame (`device.js:216-222`) | true |
| home(clock)→picture | `sendCard(frame,{replacePrevious:false})` | true |
| picture→home(clock) | `deletePicture()`→`sendClock()`→`goHome()` | false |
| first paint | picture→`sendCard({replacePrevious:false})`; home→sendClock+goHome | per page |
| after reopen() | force `committed=false`, repaint (`dwellUntil=0`) | reset |

**[CORRECTION] the alert-during-transition race needs no mutex.** In single-threaded Node the ONLY code awaiting device ops is `tick`. Data pumps + the HTTP alert handler mutate state and return synchronously without touching `dev`. An alert raised mid-`showPanel` just sits in the scheduler stack and is picked up on the NEXT tick after the in-flight transition's awaits resolve. No concurrent packet stream to corrupt. The rule is **I/O confinement (NFR3)**, stronger than a mutex because structural. (Exception: SIGINT cleanup `deletePicture` — guard with an `inFlight` flag or accept best-effort.)
**Alert resume policy:** on clear, redraw the current panel + RESTART its full dwell (the user lost screen time to the alert) — `dwellUntil=now+p.dwellMs`.

### A7. Config schema (env; matches SPOTIFY_*/WEATHER_* habit; all optional)
`CYCLE_PANELS=nowplaying,weather,clock` · `CYCLE_MODE=smart|roundrobin` · `CYCLE_DWELL_MS=15000` (floored 8000) · `CYCLE_DWELL_<ID>` per-panel (default NOWPLAYING 30000) · `CYCLE_NP_FOCUS_ON_CHANGE=1` · `CYCLE_NP_IDLE_DROP=1` · `CYCLE_NP_PAUSE_HOME_MS=300000` · `CYCLE_WEATHER_STALE_MS=2400000` (40min) · `CYCLE_TICK_MS=500` · `CYCLE_SYNC_RGB=0` · `CYCLE_ALERT_PORT=7333` · plus the unchanged `SPOTIFY_*`/`WEATHER_*` read by the panels. `parseEnv` sets `pollMs={nowplaying:5000,weather:600000,clock:Infinity}`.

### A8. Node vs browser
**Host is the runtime.** The browser `nowPlayingCtl`/`weatherCtl` are tab-scoped + mutually exclusive by construction (`startNP`→`weatherCtl.stop`+`stopClockSync` `ui.js:1600-1601`; `startWx`→`nowPlayingCtl.stop`+`stopClockSync` `:1713-1715`; clock-sync stops both `:640-641`; `npLive` guards the live label; `setNowShowing` tracks the one owner) — and die when the tab closes. **Phase 3 browser preview** sequences the existing controllers on a timer as a demo/config surface, never the runtime.

---

## R — Refinement

### R1. Exact device sequences (wire-level)
- **Picture push** = `dev.sendFrame(frame)` → `buildImageTransfer` = `announce(0x10,0,0x01,[0x01])` + `buildImageSetup()` (`A5 5A 0C 78 00` commit) + 549 data (548×56+1×32) + `finish()` (`protocol.js:143-148`), via `_send({gate:true})`: 300ms after 0x40 announce, 30ms after 0x0c setup, ACK-gate every 0x41 block (4 retries) — `device.js:170-175`. Row-major on the wire (`protocol.js:146-147`).
- **Delete-before-add** = `deletePicture()` (`announce(0x0e,0,0)`+finish) then 60ms then the push (`device.js:216-221`).
- **Rest on home** = `sendClock()` (sent 3×, `protocol.js:176-203`) + `goHome()` (`buildView(HOMEPAGE=0x0b)`). The home clock ticks on the device RTC — **no host writes during the clock panel's dwell**.
- Never `buildView(PICTURE)` after a card.

### R2. Smart rules
1. **Drop-when-idle** — `nowplaying.available()` false when `state==null` (`spotify.js:183,189,205`) or paused ≥ `PAUSE_HOME_MS`. Skipped; rejoins when `poll()` repopulates. (Reuses `nowplaying-run.mjs:157-167`/`:110-122`.)
2. **Focus-on-track-change** — `poll()` sets `_wantsFocus` on trackId change; `tick` consumes once + jumps + fresh dwell. Off in roundrobin.
3. **Stale-skip** — `weather.stale()` true when `now-lastOkAt > CYCLE_WEATHER_STALE_MS`; never-fetched → `available()` false. Skip rather than show an old temp.
4. **Hold-on-clock** — clock always available → the loop can always land somewhere; if all data panels out, park on the clock (zero writes to keep ticking).

### R3. Failure modes
| Mode | Handling | Mirrors |
|---|---|---|
| Dropped handle mid-write | device throws+closes (`:120-124`,`_fail :127-135`); driver catch `!dev.opened`→`committed=false`→`reopen()`(1-5s backoff)→`dwellUntil=0` | `nowplaying-run.mjs:143-148` |
| Spotify token rotation (PKCE) | panel keeps `accessToken()` cache+persist logic; ONLY one poller → no double-refresh revoke | `spotify.js:151-161` |
| `invalid_grant` (dead refresh token) | log re-auth hint; `available()` stays false → rotate wx↔clock. **[CORRECTION]** do NOT inherit the runner's `process.exit(1)` (`nowplaying-run.mjs:68`) — a cycler must not die because one panel's creds lapsed | — |
| 401 mid-cache | `tokenCache=null` forces one refresh next poll | `:74` |
| Weather fetch fail | `poll()` swallows, keeps last; `stale()` eventually drops | `weather-run.mjs:58` |
| Transition banding | dwell floor (8s) + unchanged gating | — |
| PK_DEL_PIC wrong slot after desync | `committed=false`, accept one extra slot vs a wrong delete | `device.js:214` |

### R4. Clock panel decision — **native home wins**
(A) Native home (`sendClock`+`goHome`): cheap; the device RTC animates seconds itself → **zero host writes during the clock's dwell**. Cost: one FSM special-case. (B) Clock-as-picture (`renderClock`): uniform FSM but a ticking clock needs a full 549-block re-push EVERY second (or it freezes) — absurd for ambient. **Recommend (A).** The zero-write dwell is decisive; the one `showPanel` special-case is trivial (no cheap in-place picture overwrite exists, `device.js:205`). This native clock is a DIFFERENT clock than the daemon's bitmap `clockApp` — don't conflate.

### R5. Risks
Home page content is the vendor default (a styled clock = option B territory, future toggle). Focus-on-change thrash (only honor `wantsFocus` when not already showing np; consume-once prevents same-track re-trigger). Alert storms (acceptable — TTL expiry drains them). SIGINT vs in-flight transition (guard with `inFlight` or accept best-effort try/catch, as the runners do).

---

## C — Completion

### C1. Phased plan
- **Phase 0 — refactor, zero behavior change.** Extract the panels; rewrite the two `.mjs` as thin launchers. Done when both runners behave identically (A/B) + existing tests pass. Ships alone, de-risks everything.
- **Phase 1 — MVP dumb cycler.** `cycle.js`+`cycle-run.mjs`: one Device, fixed dwell, the transition FSM, decoupled pumps, reopen recovery, roundrobin, skip-if-unavailable. No alerts/focus/stale. Prove rotation on-device.
- **Phase 2 — smart + alerts.** Drop-when-idle, per-panel dwell, focus-on-change, stale-skip, full env. Fold in `Scheduler`+`startLocalHook`. The real feature.
- **Phase 3 — polish + Studio.** Dwell tuning, optional RGB-per-panel (`setRGB` in `showPanel`), a Studio "Cycle" tab (config + browser preview). Optionally retire `daemon.js`/`transport-hid.js`.

### C2. Device-free test plan (built on transport-mock.js)
**[CORRECTION] the mock's real shape:** `MockTransport` reassembles only `0x41` data blocks into a framebuffer by offset + checks `yne` checksums (`transport-mock.js:19-37`) — it does NOT model the ring/deletePicture/goHome/view. `MockDevice` (`device.js:276`) only COUNTS packets. Neither alone can assert "delete-before-add happened" → need a recording layer.
**`host/test/recording-device.js` (NEW):** implements the exact `Device` API the cycler calls (`open/sendCard/deletePicture/goHome/sendClock/setRGB/reopen/close/opened`), appends each call to an ordered `ops[]` (mirroring `sendCard`: when `replacePrevious`, push `'deletePicture'` THEN `{op:'sendCard'}`), pipes every picture frame through a `MockTransport` (pixels+checksums for free, reusing the `roundtrip.test.mjs` assertion), and supports fault injection (`failNextSend()`→throw+`opened=false`).
**`host/test/cycle.test.mjs` (NEW)** drives `makeCycler(...).tick(now)` with explicit timestamps + fake panels + the RecordingDevice. Assertions:
1. **Transition sequences** — first paint → `[{sendCard,replacePrevious:false}]`; np→wx → `['deletePicture',{sendCard,replacePrevious:true}]`; picture→clock → `['deletePicture',{sendClock},'goHome']`; clock→picture → `[{sendCard,replacePrevious:false}]`.
2. **Ring net-zero** — over a full cycle, `adds-deletes == (committed?1:0)` (FR7).
3. **Skip logic** — weather `available()=false` → idx never lands on weather; only clock available → parks on clock.
4. **Focus-on-change** — `wantsFocus()=true` mid-dwell → next tick shows np + resets dwell; flag consumed.
5. **Alert interleave** — `onAlert(sticky)` → tick pushes the alert card, dwell frozen; `ack()` → tick redraws current panel + restarts dwell.
6. **Reopen recovery** — `failNextSend()` → tick catch sets `committed=false`, `reopen()`, repaints `replacePrevious:false` — assert NO blind `deletePicture` after reconnect.
7. **Frame correctness** — after np `render()`, `mock.frame()` equals `apps/nowplaying.render(state)` + `mock.stats.badChecksums===0`.
All run with `node --test`, no hardware.

### C3. Done criteria
Phase 0: runners behavior-identical; `roundtrip`+`scheduler` tests green. Phase 1: rotates on-device no banding; survives unplug/replug; cycle.test 1-3,7 green. Phase 2: idle-drop/focus/stale/alert verified on-device; cycle.test 4-6 green; env honored. Ring: after an hour, no growth.

### C4. Open questions
Alert during clock's home rest (push `replacePrevious:false`; on ack, clock's `deletePicture` targets the alert card — verify). Styled clock demand (ship native home; revisit B if wanted). RGB-per-panel (default off). Retire the daemon (keep through Phase 2 as fallback; decide Phase 3). Home-page GIF interplay (if a main-page GIF is saved, does `goHome` show clock or GIF? one-line on-device check).

**Bottom line:** `device.js` already has every primitive — nothing to add there. The two run-loops are ~70% a shared panel waiting to be extracted. The build = a behavior-preserving refactor (Phase 0) + a ~150-line stepped loop with one boolean invariant (`committed`). The three brainstorm items NOT to copy: the `sending` mutex (use I/O confinement), `Scheduler(null).active()`-truthiness (use `alertCount`), and the runner's `process.exit(1)` on a dead Spotify token (degrade the panel, keep the process).
