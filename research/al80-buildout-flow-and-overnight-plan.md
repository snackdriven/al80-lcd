# AL80 Feature Build-Out — Flow, Parallelism & Overnight Assessment

**Date:** 2026-07-10 · Ties together the five SPARCs into a buildable order: what's foundational, what runs in parallel, and what an unattended overnight run can vs can't do.

## The five features (nature + firmware dependency)
| # | SPARC | Runs on | Firmware? | Firmware valid for |
|---|---|---|---|---|
| 1 | **Auto-cycle** (`…panel-auto-cycle`) | host Node | none | — |
| 2 | **Global music-reactive** (`…music-reactive-lighting`) | host + browser | none (+1 tiny builder) | stock AND custom |
| 3 | **Per-key audio-reactive** (`…per-key-audio-reactive`) | browser + firmware | new opcode `0x49` | custom only |
| 4 | **Hotkey→panel** (`…hotkey-panel-switch`) | firmware + host | `process_record` + `raw_hid_send` + `PANEL_*` | custom only |
| 5 | **View-switch keycodes** (`…firmware-view-switch-keycodes`) | firmware | `process_record` + view keycodes | custom (the user's fw) |

## Dependency graph
```
                 ┌─ (2) global music-reactive  ── independent, no deps ────────────┐
                 ├─ (3) per-key HOST builders   ── independent ──────────┐         │
(1a) auto-cycle  │                                                       │         │
   Phase 0       ├─ FIRMWARE (one build):                                │         │
  (refactor      │     (5) view-switch process_record                    │         │
   run-loops →   │       └─(6)─ (4) hotkey PANEL_* + raw_hid_send  ──┐    │         │
   panels/)      │     (3) per-key 0x49 opcode ─────────────────────┤    │         │
      │          └───────────────────────────────────────────── one .bin│    │         │
      ▼                                                                  │    │         │
(1b) auto-cycle Phase 1 (cycle.js + cycle-run.mjs) ──┬─────────────────  │    │         │
      │                                              ▼                   ▼    ▼         ▼
      ▼                             (4) hotkey HOST reader (_onData 0x4B → jumpTo)   (7) autostart
(1c) auto-cycle Phase 2 (smart + alerts)             (needs the cycler)             unify → cycle-run
```
**The only hard edges:** auto-cycle 0→1→2 is serial; the **hotkey host reader** needs the **cycler** (1b); the **hotkey firmware** needs the **view-switch firmware** (they share `process_record` — so they're ONE firmware change, not two); the **autostart unification** needs `cycle-run` to exist. Everything else is independent.

## Firmware consolidation (the key efficiency)
All firmware changes land in **ONE new build → ONE flash → ONE at-desk verify session**:
- (5) `process_record_kb` + view keycodes `CUSTOM(22-24)` + the `al80_screen_view` flag/task.
- (4) `CUSTOM(25-29)` `PANEL_*` cases in the same switch + `al80_panel_req` (`raw_hid_send` 0x4B).
- (3) the `0x49` per-key LED-stream opcode + `g_live_rgb` buffer + `indicators_advanced` paint + idle timeout.
Don't flash three times. Batch them; verify them together.

## Overnight-safe (device-free) vs at-desk (human-gated)
**Overnight — build + test with NO hardware:**
- **Host:** auto-cycle 0→1→2 + the device-free test suite (`RecordingDevice` + `transport-mock`, per the auto-cycle SPARC §C2). Global music-reactive: `buildLightBrightnessLive` + the audio→HSV mapper + fixture tests + `detectFirmware`/`pickSaveLessCommand` + the "Music" effect UI scaffold. Per-key HOST: `buildLiveLeds`/`buildLiveFrame` + unit tests. Hotkey HOST: `_onData` 0x4B + `jumpTo` + tests. Autostart unification. All green with `node --test`, no board.
- **Firmware:** WRITE all the code, COMPILE it (WSL qmk), and MEASURE flash against `__flash0_size__` / the `.map` — device-free. Produce the flashable `.bin`. **Resolve the flash-budget question early** (config.h says F103xB/128 KB, memory said x8/64 KB, roadmap says ~2.9 KB free after v20 — read the linker script + last `.map` to settle it; it gates whether all three firmware features fit one build).
- **Docs:** the morning at-desk playbook.

**At-desk only (morning, one bounded session — the "never startling live effects, confirm I'm at the desk" rule + brick/wedge risk make these un-automatable):**
- Flash the consolidated `.bin`.
- View-switch keys (Fn+9/8/0), hotkey panel-jump (with `cycle-run` up).
- **Per-key LED walk** — one `CYCLE_LEFT_RIGHT` sweep to confirm `g_aw20216s_leds` order (likely already correct per the per-key SPARC R1), then the static test pattern before any audio.
- Auto-cycle on-device rotation (banding / transitions).
- Reactive RGB + audio: `getDisplayMedia` gesture + at-desk watching (global first, then per-key), tasteful defaults.

## The flow (parallel workstreams)
**Serial spine:** S1 auto-cycle Phase 0 (refactor) → S2 Phase 1 (cycler) → S3 Phase 2 (smart+alerts). Foundational — the panels are reused everywhere and the hotkey host-reader targets the cycler.
**Parallel from the start (independent):** P1 global music-reactive (host code + tests + UI scaffold). P2 per-key HOST builders + tests + resolve the flash/MCU-part question. P3 firmware code — write the consolidated build, compile, measure, produce `.bin`.
**Join after S2 (the cycler exists):** P4 hotkey HOST reader + tests, then wire firmware `PANEL_*` → `jumpTo`. P5 autostart unification + morning playbook.
→ 3 concurrent streams overnight (spine + P1 + P2 + P3), P4/P5 fold in once S2 lands.

## Autostart unification (folded in — P5)
Single-opener means ONE always-on host. Today `host/autostart/run-nowplaying.vbs` launches `nowplaying-run.mjs` (one panel). Repoint it at **`cycle-run.mjs`** (the superset: rotates now-playing/weather/clock + alerts + hosts the hotkey reader). `nowplaying-run.mjs`/`weather-run.mjs` survive as `--only=<panel>` debug launchers; `daemon.js`/`transport-hid.js` get deprecated (their alert intake folds into the cycler). Config's already unified (env/`.env`). Note the mode tension: the always-on host does the LCD cycle **or** streams reactive RGB, not both at full tilt (shared interface + `g_screen_busy`) — a mode switch, not a merge.

## Documentation each feature must update (not optional — part of "done")
Every phase closes by updating the docs it touched, in the SAME PR. A feature isn't done when the code is green; it's done when the KB reflects it.
| Feature | Docs to update | Paired-doc discipline |
|---|---|---|
| Auto-cycle | `AL80_KNOWLEDGE_BASE.md` (new "panel cycler" section), `roadmap.md` (mark built), `host/README` (cycle-run + `--only=` flags) | keep `…auto-cycle-brainstorm.md` ↔ `…auto-cycle-SPARC.md` in sync if the build diverges from the SPARC; log every divergence in a new `research/al80-buildout-discoveries.md` |
| Global music-reactive | `AL80_KNOWLEDGE_BASE.md` (the save-less brightness finding + `detectFirmware` probe), `roadmap.md` | `…music-reactive-lighting-brainstorm.md` ↔ `…-SPARC.md`; record the on-device firmware-detection result in discoveries |
| Per-key audio-reactive | `AL80_KNOWLEDGE_BASE.md` (the `0x49` opcode + `g_aw20216s_leds` order once the LED walk confirms it), `wiki` RGB page, `roadmap.md` | resolve+record the MCU-part/flash-cap question (128 KB vs 64 KB) in discoveries — it's been ambiguous across three sources |
| Hotkey→panel + View-switch (one firmware) | `AL80_KNOWLEDGE_BASE.md` (the new `process_record_kb`), `wiki/docs/firmware/via-keymap.md` (these keycodes now DO something on custom), `roadmap.md` | the `…hotkey-panel-switch-SPARC.md` + `…firmware-view-switch-keycodes-SPARC.md` pair; note the dynamic-keymap shadowing caveat in the wiki so users know to bind via Studio |
| Autostart unification | `host/autostart/README`, `AL80_KNOWLEDGE_BASE.md` (single-opener → one always-on host) | — |

**New running doc:** `research/al80-buildout-discoveries.md` — the append-only discovery log for this build (mirrors the `patterns.md`↔`recent-discoveries.md` discipline). Every "the SPARC said X, the board actually did Y" goes here as it's found, so the SPARCs stay design-intent and the discoveries capture ground truth. The morning at-desk verifies each write their result here.

## Execution discipline (applies to every phase)
- **ultrathink** — each phase runs its subagent with ultrathink; the firmware and per-key phases especially (byte-level wire + LED-order reasoning).
- **Checklists** — each phase opens by turning its SPARC's §C (Completion) into a literal todo checklist, one item per deliverable + one per doc-update + one per test, and works the list top to bottom. No phase is "done" with an unchecked box.
- **Tests gate the PR** — every host/browser phase must be `node --test`-green on the mock transport / `RecordingDevice` before its PR opens (the SPARCs' §C2 test plans are the source). Firmware phase gate = compiles + flash-budget within headroom (device-free); its on-device tests move to the morning playbook.
- **Docs in the same PR** — the doc updates above ride in the feature's own PR, never a follow-up.

## What lands by morning (realistic)
Auto-cycle fully built + device-free-green (0→1→2); the host halves of music-reactive / per-key / hotkey built + tested; ONE consolidated firmware `.bin` compiled + flash-confirmed; autostart unified; the morning playbook written. Per-feature PRs, each gated on its device-free tests.

## Verdict
**Yes — a strong overnight goal, scoped as: ship all host/browser code + green device-free tests + the compiled firmware `.bin` + a morning flash-and-verify playbook.** NOT autonomous on-device building. The device-free surface is large (the SPARCs were written for it), so ~80% lands unattended; the irreducible at-desk work is one flash + one verify session + the audio gesture.

**Overnight guardrails (hard):** no flashing (produce the `.bin`, don't flash); no live sends to the real board (all host tests on the mock transport / `RecordingDevice`); no live lighting (the at-desk/no-startle rule). The morning playbook enumerates the exact at-desk steps.

**Suggested execution:** a workflow/ultracode run with the phases above — the spine sequential, P1/P2/P3 fanned out, P4/P5 after S2. Every phase: ultrathink on, opens by converting its SPARC §C into a todo checklist (deliverables + doc-updates + tests), gates its PR on device-free tests green (host) or compiles-within-flash-budget (firmware), and ships its doc updates (KB/roadmap/wiki + the brainstorm↔SPARC pair + an entry in `al80-buildout-discoveries.md`) in the same PR. Final deliverable = the "morning playbook" doc listing the at-desk verification in order, each step writing its result back to the discoveries log.
