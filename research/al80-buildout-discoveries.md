# AL80 Build-Out Discoveries — append-only ground-truth log

Mirrors the `patterns.md` ↔ `recent-discoveries.md` discipline: SPARCs stay design-intent, this file
captures what the build actually did when it diverged. Append only — never edit/delete a past entry,
correct forward with a new dated one if a later finding supersedes it. Each entry: date, feature, SPARC
said X, build did Y, why.

---

## 2026-07-10 — Hotkey → panel switch (HOST half)

**Feature:** `research/al80-hotkey-panel-switch-SPARC.md`. Scope built: host inbound reader
(`device.js`) + `cycler.jumpTo`/`togglePaused`/`step` wiring (`host/panel-request.js`), device-free
only, per the overnight build-out plan's host/firmware split for this feature.

- **SPARC said** (pseudocode, HOST section): `dev.on('panelRequest', id => { if (now-lastReq <
  PANEL_REQ_DEBOUNCE_MS) return; lastReq=now; ... })` — a leading-edge drop-and-hold debounce (ignore
  anything inside the window after the first).
  **Build did:** a trailing-edge coalescing debounce instead — every request inside the window replaces
  the pending one, and a single timer fires the LATEST id once the window closes with no further
  requests. Reasoning: the SPARC's own FR7 goal is "a held key must not spam switches," and R3 also
  frames it as "collapses double-taps/bounce (coalesce to last id)" — coalesce-to-last is explicitly the
  intent, and a leading-edge drop would instead act on the FIRST (possibly still-settling) id in a
  rapid burst. Trailing-edge coalescing matches "coalesce to last id" literally. Test 4 in
  `host/panel-request.test.mjs` locks this in: three ids in one window → exactly one `jumpTo` call, on
  the last id.
- **SPARC said:** the host reader lives in `cycle-run.mjs` / `cycle.js` (the auto-cycle SPARC's files).
  **Build did:** those files don't exist yet — `al80-lcd-panel-auto-cycle-SPARC.md` is a separate,
  unmerged feature as of this build. Per this task's explicit instruction, built the wiring as its own
  module, `host/panel-request.js`, exporting `wirePanelRequests(dev, cycler, opts)` against the `cycler`
  INTERFACE the auto-cycle SPARC specifies (`jumpTo(name, now)`, `togglePaused()`, `step(now)`), tested
  against a hand-rolled mock cycler, not the real one. `cycle-run.mjs` wires it in with
  `wirePanelRequests(dev, cyc)` once both features land — a one-line integration, not a redesign.
- **SPARC said:** `PANEL_REQ = 0x4B` and the `PANEL_BY_ID` map live implicitly wherever the host reader
  is written. **Build did:** promoted them to `src/protocol.js` as `PANEL_REQ`, `PANEL_ID`, and
  `PANEL_NAME_BY_ID` (the wire-id → auto-cycle panel-name map) — protocol.js is the existing home for
  every other opcode constant (`AP_BAR`, `VIA_CMD`, `LIGHT`, `VIEW`, etc.), and `device.js` / a future
  `cycle-run.mjs` both need the same constants, so a shared, tested home beat a private one).
- **Not yet verified (carried forward, unchanged from the SPARC's own C4):** firmware half
  (`process_record_kb` + `al80_panel_req` + the 5 `PANEL_*` keycodes) is NOT built by this pass — it's
  device-touching/firmware work explicitly out of scope for a device-free host session. Until it ships,
  the host reader is wired and tested but inert (nothing on the wire ever sends `0x4B`). The two
  hardware verifies the SPARC's C4 flags (keyboard-sourced view announces; unsolicited `raw_hid_send` vs
  the image ACK stream) remain unverified — they need the firmware half + an at-desk session.

---

## 2026-07-10 — Autostart unification (P5)

**Feature:** "Autostart unification" section, `research/al80-buildout-flow-and-overnight-plan.md`
(not a standalone SPARC). Scope built: repoint `host/autostart/run-nowplaying.vbs` at
`cycle-run.mjs`, keep `nowplaying-run.mjs`/`weather-run.mjs` as `--only=<panel>` debug launchers,
deprecate `daemon.js`/`transport-hid.js`, device-free tests, docs.

- **SPARC said:** "Repoint it at `cycle-run.mjs` (the superset host)" — phrased as if the file
  already exists (produced by the S1→S2→S3 auto-cycle spine, a separate parallel workstream).
  **Build did:** `host/cycle-run.mjs` did NOT exist in this worktree at the time this feature ran
  (checked: no `cycle-run*` or `cycle.js` anywhere in `host/`, and no sibling worktree on disk had
  it either). Rather than block on a dependency that hadn't landed, built a real but intentionally
  modest `cycle-run.mjs`: rotates clock/weather/now-playing on a fixed 20s timer, reuses the
  existing `makeNowPlayingApp`/`makeWeatherApp`/`clockApp` + `Scheduler` + `control/local-hook.js`
  (folding in `daemon.js`'s alert-intake role), and supports `--only=<panel>` for parity with the
  single-panel debug scripts. It deliberately does NOT reimplement: the picture-ring commit/delete
  choreography `nowplaying-run.mjs` uses (delete-before-add so the ring doesn't grow — this file
  just always passes `replacePrevious` after the first push, which is coarser but ring-safe), the
  hotkey `jumpTo`/`panel-request.js` wiring (that's P4's `host/panel-request.js` +
  `wirePanelRequests`, per the 2026-07-10 "Hotkey → panel switch (HOST half)" entry above — not
  present in this worktree; integrating it into `cycle-run.mjs` is a one-line follow-up once both
  branches merge), and any smart "show now-playing when a track is actually playing" priority logic
  (auto-cycle Phase 2 "smart" territory, S3 in the overnight plan). **Reconcile note for whoever
  lands the full auto-cycle build:** this file should be reviewed against the real
  `al80-lcd-panel-auto-cycle-SPARC.md` output and the two either merged (this becomes the shell,
  the real cycler's rotation/priority logic replaces the fixed-timer loop) or this one deleted in
  favor of the SPARC's — don't let two competing "the cycler" files ship.
- **SPARC said:** "Deprecate daemon.js/transport-hid.js (fold their alert intake into the
  cycler)." **Build did:** exactly that — added header deprecation notices to both files (not
  deleted, per the instruction to only repoint the launcher, not remove code), and `cycle-run.mjs`
  reuses `lib/scheduler.js` + `control/local-hook.js` directly (the same modules `daemon.js` used),
  so the alert-intake behavior (127.0.0.1:7333 `/alert` `/ack` `/status`) is byte-for-byte the same
  contract, just hosted from the new entrypoint.
- **SPARC said:** "Do NOT register any new scheduled task / startup entry — only repoint the
  existing launcher." **Build did:** confirmed — only `run-nowplaying.vbs`'s `nodeArgs` line and
  `al80-nowplaying.bat`'s `node` line changed; the Task Scheduler / startup-folder instructions in
  `autostart/README.md` are the same pre-existing snippet (a device-free test
  (`host/test/cycle-run.test.mjs`) asserts exactly one `Register-ScheduledTask` string in the
  README, guarding against a future accidental second registration).
- **Verified device-free:** `node --test host/test/*.test.mjs` → 15/15 green (7 new in
  `cycle-run.test.mjs`: arg parsing incl. `--only` validation/rejection, launcher-targets-
  cycle-run.mjs, no-new-scheduled-task guard). Also smoke-ran `cycle-run.mjs --mock-device` by hand
  (not part of the automated suite): confirmed full-frame + no-op-diff push cycling on a bare
  `clock`-only run, and confirmed a POSTed `/alert` correctly preempts the rotation
  (`GET /status` → `{"active":"alert:anon","alerts":1}`) — both device-free via `MockDevice`.

---

## 2026-07-10 — Per-key audio-reactive (HOST half)

**Feature:** `research/al80-per-key-audio-reactive-SPARC.md`. Scope built: host-side `0x49`/`0x4A`
stream builders in `al80-studio/src/protocol.js` (`buildLiveLeds`, `buildLiveFrame`, `buildLiveStop`),
device-free tested, per the overnight build-out plan's host/firmware split for this feature. The
firmware handler (`g_live_rgb[]`, `rgb_matrix_indicators_advanced_kb` paint loop,
`matrix_scan_kb` idle timeout) is explicitly out of scope for this pass.

- **SPARC said (R.4 / C.4.1), the headline open question:** the MCU-part/flash-cap question was
  unresolved — `config.h:4`'s header comment claims **STM32F103xB (128 KB)**, contradicting the
  earlier summarized facts that said **x8 (64 KB, ~2.5 KB free)**. Flagged ⚠VERIFY, must be settled
  from the linker script + the last `.map`/`nm` before trusting the flash budget, because it gates
  whether this opcode (and the other two firmware features sharing the consolidated build) fit.
  **Build did:** resolved definitively from ground truth, not the header comment. Neither
  `keyboards/yunzii/al80/rules.mk` nor `keyboard.json` overrides `MCU_LDSCRIPT`, so
  `platforms/chibios/mcu_selection.mk`'s STM32F1xx-family default (`MCU_LDSCRIPT ?= STM32F103x8`)
  is what actually links — the 64 KB tier, matching the "summarized facts," not `config.h`'s comment.
  The stm32duino bootloader's ld fragment carves out the first 8 KB
  (`org = 0x08002000, len = f103_flash_size - 0x2000`), leaving a 56 KB `flash0` app region.
  Confirmed on the actual linked ELF via `nm .build/yunzii_al80_vial.elf | grep flash`:
  `__flash0_base__=0x08002000`, `__flash0_end__=0x08010000`, `__flash0_size__=0xE000` (57,344 B),
  `f103_flash_size=0x10000` (65,536 B total chip flash), `__flash0_free__=0x0800f684`. The build
  present in the tree (v1.3.0/`v25_locks`) links `text=53552 + data=1364 = 54916` B, so free =
  `__flash0_end__ - __flash0_free__` = `0x97C` = **2,428 bytes (≈2.37 KB) free.** Verdict:
  `config.h`'s "STM32F103xB (128 KB)" comment is stale/aspirational and never touches
  `MCU_LDSCRIPT` — the real budget is the tight 64 KB-class tier the SPARC's own summarized facts
  guessed, and it's tighter now (2.37 KB) than the roadmap's separate "~2.9 KB after v20" estimate
  since more code (v21-v25) has landed since that snapshot. The SPARC's ~200-400 B handler estimate
  fits, with room for roughly one more small feature after it, not several.
- **SPARC said (A.1):** the SPARC's own C.2 test plan is written generically ("mirror `protocol.js`
  tests") without specifying a runner. The parent build-out plan's execution-discipline section says
  tests must be "`node --test`-green." **Build did:** al80-studio's existing test suite
  (`test/*.test.mjs`) is plain ESM scripts using `node:assert/strict` + a hand-rolled `ok(name, fn)`
  counter, not the `node:test` runner — `npm test` chains them with `&&`. The new builder tests were
  added to the existing `test/protocol.test.mjs` in that same style (consistent with every other
  opcode builder already in the file) and run via `node test/protocol.test.mjs` /
  `npm test`, not literally `node --test`. Functionally equivalent gate (a thrown `assert` exits
  non-zero either way); noting it so a later phase doesn't go looking for `node --test` output
  specifically.
- **Not built, unchanged from the SPARC's own scope (C.4, Phase 1):** the firmware half — `0x49`
  handler, `g_live_rgb[]`, the indicators paint loop, the idle timeout, and `config.h`'s opcode
  `#define`s. Until it ships, `0x49`/`0x4A` fall through via.c's default case and no-op on every bin
  through v1.3.0 — harmless per the SPARC's own R.5. The R.1 LED-order ⚠VERIFY (does
  `CYCLE_LEFT_RIGHT` sweep clean, confirming no per-key walk is needed) is also unchanged/unverified —
  it's an at-desk check, not device-free work.
- **Docs updated with these findings:** `AL80_KNOWLEDGE_BASE.md` §9b (new section, mirrors the §9a
  "HOST half built" pattern), `wiki/docs/firmware/custom-qmk.md` (new "Per-key audio-reactive RGB"
  section under the version-history table), `wiki/docs/roadmap.md` (TL;DR flash-budget line updated
  to the ground-truth 2.37 KB figure + a new "Shipped since this survey" bullet).

---

## 2026-07-10/11 — Panel auto-cycle (`al80-lcd-panel-auto-cycle-SPARC.md`) — the real cycler lands

**Feature:** the full 3-phase build — Phase 0 (extract `panels/{nowplaying,weather,clock}.js`),
Phase 1 (`cycle.js` FSM + `cycle-run.mjs`, one Device), Phase 2 (smart rules + alert intake). All
device-free; on-device rotation/banding confirm is at-desk follow-up, not this pass.

- **RECONCILE — this supersedes the placeholder `cycle-run.mjs` from the "Autostart unification
  (P5)" pass (see the 2026-07-10 entry above).** That worktree built a real-but-modest fixed-20s-
  timer `cycle-run.mjs` because the auto-cycle branch hadn't landed yet when P5 ran, and explicitly
  flagged itself for reconciliation ("this becomes the shell, the real cycler's rotation/priority
  logic replaces the fixed-timer loop — don't let two competing 'the cycler' files ship"). This PR
  IS that real cycler. Whoever merges both branches: take THIS `cycle.js` + `cycle-run.mjs` (smart
  dwell-per-panel, `available()`/`stale()`/`wantsFocus()` rules, alert preemption via
  `scheduler.alertCount`, `jumpTo()`, the `committed` invariant, the device-free FSM tests) as
  canonical, and fold in P5's actual deltas on top of it: the `--only=<panel>` CLI convenience flag
  (this build kept the two debug launchers as separate files instead — either is fine, pick one),
  the `daemon.js`/`transport-hid.js` deprecation header notices, and the `run-nowplaying.vbs`/
  `al80-nowplaying.bat` repoint to `cycle-run.mjs` (not touched by this PR — autostart unification
  is intentionally a separate concern per the build-out plan's own P5/S-spine split, and this PR's
  scope stops at the host code + device-free tests for the auto-cycle SPARC itself).
- **SPARC said (P, the pseudocode) the reopen-recovery catch lives in an outer "driver (real
  timers)" loop, separate from `tick(now)`.** **Build did:** folded that catch INTO `tick()` itself.
  Reason: the SPARC's own §C2 test plan literally says "drives `makeCycler(...).tick(now)`" and
  assertion 6 describes `failNextSend() → tick catch sets committed=false, reopen()...` — for a
  device-free test to observe the reopen having happened by the time `await cyc.tick(now)` resolves,
  the try/catch has to be inside `tick()`, not in a real-timer loop the test never drives. `cycle-
  run.mjs`'s own `while` loop is now just `await cyc.tick(Date.now()); await sleep(tickMs)` — no
  separate catch layer, because `tick()` already self-heals.
- **Found while building, not in the SPARC — a real startup-race bug:** `cycle-run.mjs`'s original
  draft fired every panel's first `poll()` without awaiting it ("fire once immediately so the first
  tick has data"), mirroring how `nowplaying-run.mjs`/`weather-run.mjs` never needed to await their
  first poll (they don't have a competing panel to fall back to). But `nowplaying.js`'s `poll()`
  hits its first `await` (`currentTrack()`) before setting `state`, even in mock mode (`getNowPlaying
  Mock` is wrapped in an async call chain) — so the VERY FIRST `tick(now)` could run before that
  microtask resolved, see `available()===false` for nowplaying (correctly, per FR3, since it truly
  had no data yet), and land on weather for exactly one tick before focus-on-change self-corrected
  the next tick 500ms later. Reproduced on a clean `--mock-device` run: first three device pushes
  were nowplaying-skip→weather, then delete, then nowplaying, all within under a second of process
  start. Not a bug in the FSM (the skip-to-weather call was the CORRECT decision given the state it
  was handed) — it was a caller-side ordering bug. **Fixed:** `await Promise.all(panels.map(p =>
  p.poll()))` before the tick loop starts, so every panel has real data (or a real "no data yet"
  answer) before the first `tick()` runs. Worth remembering for any FUTURE panel/launcher: async
  `poll()` implementations need their first call awaited before the first `tick`/render, even if the
  underlying data source is itself synchronous or mocked — the `async` keyword alone inserts a
  microtask boundary.
- **SPARC said (A2) the weather panel drops the runner's `readingKey` change-gate** ("the cycler
  only pushes weather when it takes the screen, so there's nothing to gate"). **Build did:** exactly
  that for the panel itself — but the debug launcher `weather-run.mjs` still needs a change-gate
  (it has no dwell/cycler deciding when to push), so it keeps `readingKey` and reads the panel's raw
  state via a small non-formal `panel.state()` accessor added to `panels/weather.js` (documented
  inline as "not part of the formal Panel interface — the cycler never calls this").
- **Minor, accepted divergence in the Phase-0 refactor:** the original `nowplaying-run.mjs`'s
  "track changed" key included the paused/resumed toggle (`` `${trackId}|${paused?'p':'r'}` ``), so
  pausing/resuming the SAME track counted as a "change" and force-repainted immediately. The
  extracted `panels/nowplaying.js`'s `wantsFocus()` only fires on an actual `trackId` change (per the
  SPARC A2's spec: "sets `_wantsFocus` on trackId change"). Net effect in the single-panel launcher:
  pausing/resuming the same track now waits up to `PROGRESS_REFRESH_MS` (15s) for the paused/resumed
  state to visibly refresh, instead of repainting on the same poll. Accepted as a deliberate
  behavior-preserving trade against following the SPARC's formal contract literally; the multi-panel
  cycler (`cycle-run.mjs`) isn't affected since dwell timing dominates there anyway.
- **Verified device-free:** `node --test` in `host/` → 8/8 files green, including the new
  `test/cycle.test.mjs` (7/7 SPARC §C2 assertions: transition sequences, ring net-zero, skip logic,
  focus-on-change, alert interleave via `scheduler.alertCount`, reopen recovery with no blind delete,
  frame correctness). Also hand-smoke-tested (not part of the automated suite, all via
  `--mock-device`): `cycle-run.mjs` end-to-end alert preemption over real HTTP (`POST /alert` →
  `GET /status` shows `alert:anon` → `POST /ack` → resumes rotation), `jumpTo('clock')` mid-dwell,
  and `jumpTo('nope-does-not-exist')` correctly no-ops.
- **Not built (explicitly out of scope, unchanged from the SPARC's own C4):** on-device rotation/
  banding confirm, unplug/replug recovery on real hardware, Phase 3 (RGB-per-panel sync beyond the
  `rgb()` hook already wired but unused by the Phase-1/2 cycler, a Studio "Cycle" tab, retiring
  `daemon.js`), and autostart unification (separate P5 concern, see the RECONCILE note above).

---

## 2026-07-11 — Consolidated firmware: view-switch + hotkey + per-key `0x49` (the FIRMWARE build)

**Feature:** `research/al80-firmware-view-switch-keycodes-SPARC.md` (owns `process_record`) + the hotkey
+ per-key SPARCs. Scope built: ONE custom-QMK build in `firmware/al80-keyboard-src/` adding all three
firmware halves the §9a/§9b HOST passes left open. Compiled + flash-measured device-free; NOT flashed.
Artifact `firmware/AL80_CUSTOM_QMK_v28_keycodes.bin` (55,368 B, sha256
`7926e87503c41ab01da6742b905468fd1c01f2f0e05fc46803e5c0f4bf4cd499`). Test: `node --test
firmware/test/firmware-wire.test.mjs` -> 9/9 green.

- **Flash - measured, fits (this is the number the whole consolidation gates on).** Clean baseline
  rebuild of the current tree = 54,916 B (matches the §9b ground-truth cap derivation exactly). With all
  three features: **55,368 B -> +452 B**, against `__flash0_size__` = 0xE000 = 57,344 B -> **1,976 B free.**
  The SPARC estimates (view ~150-200 B + hotkey tens-to-low-hundreds + per-key ~200-400 B) summed to
  ~450-700 B; the actual +452 landed at the low end (LTO folds the shared `al80_screen_view` call the
  view keys and the `PANEL_*` keys both use). **All three fit one build - no feature trimmed.** After
  this, roughly ~1.9 KB is left for one more small feature, not several.
- **SPARC A.2 (per-key) sketched the indicators hook as two separate `if`s** (`if(g_live_active){...}`
  then `if(bar_independent && !g_live_active){...}`, plus a comment to guard 76-78). **Build did:** one
  mutually-exclusive `if(g_live_active){paint whole board 0..led_max} else if(bar_independent){bar 76-78}`.
  Net effect matches the SPARC's own stated recommendation ("live owns the whole board") - when a live
  audio field is streaming it paints the side bar too; the independent-bar override only runs when live
  is idle. Simpler and no per-frame branch inside the hot loop. Nothing lost: with live inactive (the
  normal case) the bar behaves exactly as before.
- **SPARC view NFR2 says "no `sdWrite`/`wait_us` in the key handler."** Build honored it for the USART3
  view switch (handler only sets the `view_request` byte; `housekeeping_task_kb` does the `sdWrite`
  when `!g_screen_busy`). BUT the hotkey `PANEL_*` keys call `al80_panel_req` -> `raw_hid_send`
  **directly in `process_record_kb`**, per the hotkey SPARC's own pseudocode (A1/§P). `raw_hid_send` is
  the USB endpoint, not USART3, so it has no byte-shear concern with the image stream - but whether an
  unsolicited `raw_hid_send` from inside `process_record` delivers cleanly against an in-flight image
  ACK stream on this via.c build is the hotkey SPARC's C4 **[verify]** item, still unverified (needs the
  board). If it collides at-desk, the documented fallback is to defer it behind a dirty flag like
  `view_request`/`locks_dirty`. Carried forward, unchanged.
- **PICTURE key uses `0x0D` (PK_TOGGLE_PIC), which advances the picture ring** - not a neutral "show
  the picture page." Per view SPARC R3 (no random-access "show slot N" opcode; `buildNextPicture` IS
  `buildView(PICTURE)`). From a non-picture view, Fn+8 switches TO the picture page; pressing again
  cycles slots. Correct/expected, flagged for the at-desk verify (first-press-from-cold-home is a C4 [verify]).
- **keymap.c defaults vs Studio binding (view SPARC A6 shadowing).** Build set Fn+8/9/0 on layer 1 as
  fresh-board defaults and **deliberately did NOT force-seed them via `al80_apply_dynamic_keymap_fixups`**
  (per A6 - the fixups explicitly refuse to fight a later user remap). Consequence, documented in the
  wiki: a user already on custom fw won't get these from a reflash (VIA's emulated EEPROM survives it);
  they bind via Studio's existing `PRESETS['LCD view']` (zero code change). Design intent, not a gap -
  noting it so the morning verify checks Studio binding, not just a fresh-flash keypress.
- **Vial `customKeycodes` labels deferred.** Both SPARCs rate the `vial.json` picker labels low-value
  Phase 2 (Vial indexes from `QK_KB_0`, so labeling `CUSTOM(22-29)` needs a 30-entry array with 21
  placeholders). The keycodes still bind + fire unlabeled via Studio/raw `CUSTOM(n)`. Left out on purpose
  to keep the diff and flash tight; metadata-only, can land whenever.
- **Test shape - vendored protocol reference + drift guard, not a cross-repo import.** The wire-bytes
  test must assert against `protocol.js buildView`, which lives in the *separate* al80-studio repo. Rather
  than make al80-lcd's test depend on an al80-studio checkout path (fragile on a fresh clone), the test
  vendors the exact view-relevant functions (`ga`/`announce`/`finish`/`build`/`buildView`, verbatim) into
  `firmware/test/protocol-view-ref.mjs` with a provenance header, asserts the firmware mirror against
  BOTH that ref AND the hardcoded SPARC A4 table, and adds a **drift guard** that dynamically imports the
  LIVE al80-studio `protocol.js` when resolvable (env `AL80_STUDIO_PROTOCOL` or a sibling path) and
  asserts the vendored copy still matches it. On this run the live file WAS resolvable, so the drift
  guard ran green - real end-to-end parity, self-contained test. On a checkout without al80-studio the
  guard skips and the vendored ref + A4 table stand in.
- **`al80_screen_view` sends the announce only** (7 bytes), not `buildView`'s `[announce, finish]` pair.
  Correct per A3/A4: the `finish()` (0x42) maps host-side to `g_screen_busy=false` and writes nothing to
  USART3, so `al80_screen_view` manages `g_screen_busy` itself and emits just the announce. Not a
  divergence - recording it because "buildView returns two reports but only one crosses the wire" is a
  foot-gun for anyone diffing the host path against the firmware path.
- **Docs updated (same PR):** `AL80_KNOWLEDGE_BASE.md` §9c (new - the consolidated firmware half),
  `wiki/docs/firmware/via-keymap.md` (view + panel keycodes now DO something on custom; shadowing note),
  `wiki/docs/firmware/custom-qmk.md` (`v28_keycodes` row + per-key firmware-built update),
  `wiki/docs/roadmap.md` ("Shipped since this survey" bullet + pending-table view-switch row marked built).
- **Carried forward, unchanged (at-desk only):** flash it; Fn+9/8/0 view switches; hotkey panel-jump
  with `cycle-run` up; the per-key `CYCLE_LEFT_RIGHT` LED-order sweep (per-key SPARC R.1 ⚠VERIFY) then a
  static test pattern BEFORE any audio; unsolicited `raw_hid_send` vs the image ACK stream. See
  `research/al80-lcd-morning-playbook.md`.

## Global music-reactive lighting - shipped (al80-studio, 2026-07-11)

Built per `research/al80-music-reactive-lighting-SPARC.md`. Branch `feat/music-reactive-lighting`
(draft PR on `snackdriven/al80-studio`). Device-free build: no board opened, no sends, no flash.

- **The whole feature = existing FX loop + audio color source + a firmware-aware save-less picker.**
  No firmware change, as the SPARC predicted. Reuses `startFx`/`stopFx`/`sendFrame`/`lightingFxCtl`
  wholesale; the only new runtime bits are the audio capture, the pure mapper, and the fw detect.
- **One protocol addition: `buildLightBrightnessLive(v)` = `buildLightSet(LIGHT.BRIGHTNESS,[v])`** -
  the BARE noeeprom set (single `07 03 01 <val>` report), NOT the `buildLightBrightness` wrapper that
  appends a `09` save. This is the whole point on stock: brightness reactivity save-less. A test
  asserts the live builder is a lone `Uint8Array` with no `0x09` byte and contrasts it against the
  wrapper's `[set, save]` pair, so the distinction can't silently regress.
- **New pure module `src/music.js`** (DOM-free, HID-free, node-testable): `mapAudioToHSV` (P.2 math -
  bands->hue, RMS->brightness, spectral-flux onset, host-side cap + value/hue slew), `newMapState`,
  `pickSaveLessCommand` (custom -> 1 `07 41` report; stock -> `07 03 04` + `07 03 01`, neither with a
  save), `detectFirmware(transact)` (0x46 side-bar probe; reply -> custom, no reply/throw -> stock).
- **UI:** a "Music" card in the Lighting tab (Breathe default / Pulse / Follow-hue, brightness-cap
  slider default 60%, Start/Stop). `getDisplayMedia({video,audio,systemAudio:'include'})` is gated
  behind the Start gesture; video track is stopped immediately, analyser never connects to
  destination. `startMusic` calls `stopFx` first and chains `stopMusic` into `lightingFxCtl.stop`, so
  tab-away (`ui.js:445/467`), disconnect (`ui.js:161`), Stop, and track-`ended` all tear the stream +
  AudioContext down and cancel the rAF loop.

### Divergences from the SPARC (small)
- **Stock base-effect pin uses effect id 1, not `SOLID_COLOR_EFFECT` (2).** The SPARC's A.4 sketch pins
  custom with the VialRGB ordinal `SOLID=2` (correct) but the two enums differ: stock QMK RGB-matrix
  `RGB_MATRIX_SOLID_COLOR` is id 1, the VialRGB `SOLID` ordinal is 2. Implemented `STOCK_SOLID_EFFECT=1`
  for the stock `buildLightEffect(...)` pin; custom still pins with 2. (SPARC A.4 already wrote
  `buildLightEffect(1)` for stock in its pin line - so this matches the SPARC's stock value, just
  reconciles it against the shared `SOLID_COLOR_EFFECT` const.)
- **Node/headless `setRGBLive` path (S.2 FR9 / A.5) not built** - SPARC Phase 4, lowest priority, and
  the task scoped the browser feature only. `host/device.js` still only has the EEPROM-writing `setRGB`.
- **Tests use `node --test` (node:test)** rather than the repo's older custom `ok()`-counter runner, so
  the new file is wired as `node --test test/music.test.mjs` in the root `package.json` "test" script
  (runs green there; the pre-existing `host/test/device.dryrun` step still needs an installed `node-hid`,
  unrelated to this feature). 15 tests: the builder distinction, mapper fixtures (floor/band-hue/cap/
  slew/onset/hue-wrap), `pickSaveLessCommand` per fw, `detectFirmware` branch selection.
