/**
 * AL80 five-feature build-out — Workflow script (DRY RUN, saved for review)
 * ---------------------------------------------------------------------------
 * Companion to research/al80-buildout-flow-and-overnight-plan.md and the five SPARCs.
 * This file does NOT run on its own. It fires only when you invoke the Workflow tool
 * against it AND set a token cap. See "HOW TO RUN" below.
 *
 * WHAT IT DOES
 *   Builds all device-free work for the five features + one consolidated firmware .bin,
 *   each in its own isolated worktree, each opening its own DRAFT PR, each verified
 *   adversarially the moment its build finishes (pipeline, no barrier). Then writes the
 *   morning at-desk playbook. Nothing touches the physical keyboard.
 *
 * MODEL ROUTING (the cost lever we agreed on for Max)
 *   - Sonnet: all al80-studio host/browser features (roomy weekly budget on Max).
 *   - Opus:   the firmware build (byte-level wire/CRC reasoning) + every verify pass.
 *   To shrink the Opus draw further, flip VERIFY_MODEL to 'sonnet' below (roughly halves
 *   the Opus spend). To spend MORE Opus on a specific host feature, set its .model.
 *
 * SAFETY (hard — encoded in every prompt)
 *   - No WebHID/node-hid open, no sends, no flashing, no live RGB. Device-free only.
 *   - All device interaction in tests uses the mock transport / RecordingDevice.
 *   - Never commit host/.env or Spotify creds.
 *
 * HOW TO RUN (only when you say go)
 *   Invoke with a HARD CAP, e.g. a "+400k" directive on the turn, then:
 *     Workflow({ scriptPath: "<this file>" })
 *   The cap makes the run stop at 400k output tokens — no overrun. On Max 20x you can
 *   raise it; on 5x, run as-is.
 *
 * PREREQUISITES TO CONFIRM BEFORE RUNNING (flagged for review, not yet resolved)
 *   [ ] Both repos reachable from the workflow's working dir:
 *         - al80-studio (this worktree)  -> host/, src/
 *         - al80-lcd  (WSL: /home/kg/al80-lcd) -> custom QMK firmware, KB, roadmap, wiki, research/
 *       The firmware/docs agents target al80-lcd; confirm git ops work against it from here
 *       (Windows cwd -> WSL path is the one wrinkle to sort out first).
 *   [ ] `gh` authenticated so agents can open draft PRs.
 *   [ ] worktree.baseRef = fresh (branch each feature from origin/main).
 */

export const meta = {
  name: 'al80-buildout',
  description: 'Build all five AL80 features device-free + one firmware .bin, each its own draft PR, each verified',
  whenToUse: 'Overnight build-out of the SPARC-d AL80 features. Device-free only; flashing/live verify is a morning at-desk playbook.',
  phases: [
    { title: 'Build',    detail: 'one isolated agent per feature: checklist from SPARC C, code, tests, docs, draft PR' },
    { title: 'Verify',   detail: 'adversarial re-check per feature the moment its build lands (Opus)', model: 'opus' },
    { title: 'Playbook', detail: 'write the morning at-desk flash-and-verify playbook from what shipped' },
  ],
}

// ---- knobs -----------------------------------------------------------------
const VERIFY_MODEL = 'opus'   // flip to 'sonnet' to roughly halve the Opus draw
const HOST_MODEL   = 'sonnet' // al80-studio host/browser features
const FW_MODEL     = 'opus'   // firmware byte-level reasoning wants Opus

// ---- structured output schemas ---------------------------------------------
const BUILD_RESULT = {
  type: 'object',
  required: ['feature', 'testsGreen', 'branch', 'filesChanged', 'docsUpdated'],
  properties: {
    feature:       { type: 'string' },
    testsGreen:    { type: 'boolean', description: 'device-free tests pass (node --test on the mock transport)' },
    testCommand:   { type: 'string' },
    branch:        { type: 'string', description: 'pushed branch name the verify pass will check out' },
    prUrl:         { type: 'string', description: 'draft PR url, or empty if push/PR failed' },
    filesChanged:  { type: 'array', items: { type: 'string' } },
    testsAdded:    { type: 'array', items: { type: 'string' } },
    docsUpdated:   { type: 'array', items: { type: 'string' }, description: 'KB / roadmap / wiki paths touched' },
    discoveries:   { type: 'array', items: { type: 'string' }, description: 'SPARC-said-X / build-did-Y notes appended to al80-buildout-discoveries.md' },
    flashDeltaBytes: { type: ['integer', 'null'], description: 'firmware only: .bin size delta vs headroom; null for host features' },
    compiled:      { type: ['boolean', 'null'], description: 'firmware only: did it compile clean' },
    blockers:      { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_RESULT = {
  type: 'object',
  required: ['feature', 'verdict', 'issues'],
  properties: {
    feature:        { type: 'string' },
    verdict:        { type: 'string', enum: ['pass', 'needs-work', 'fail'] },
    testsReRun:     { type: 'boolean', description: 'checked out the branch and re-ran the device-free tests' },
    checklistComplete: { type: 'boolean', description: 'every SPARC C item + doc-update + test actually present' },
    issues:         { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
}

// ---- shared prompt fragments -----------------------------------------------
const SAFETY = `HARD SAFETY RULES - never violate:
- Do NOT touch the physical keyboard: no WebHID/node-hid open(), no sends, no flashing, no live RGB. Device-free work only.
- All device interaction in tests uses the mock transport / RecordingDevice (transport-mock.js) - never a real Device.
- Do NOT commit host/.env or any Spotify credentials (it is gitignored - keep it that way).`

const RESEARCH = '/home/kg/al80-lcd/research'

function buildPrompt(f) {
  return `Ultrathink. Build the "${f.name}" feature to its SPARC. This is device-free work only.

1. Read the SPARC in full: ${f.sparc}
2. Turn its C (Completion) section into an explicit checklist - one item per deliverable, one per doc-update, one per test - and work it top to bottom. Do not leave a box unchecked.
3. Implement in ${f.repo}.
${f.buildExtra}
4. Tests: write the device-free tests from the SPARC C2 test plan and RUN them (${f.testCmd}). They must be green before you finish. ${f.testNote}
5. Docs (part of "done", same PR): update the docs the build-out plan assigns to this feature - see ${RESEARCH}/al80-buildout-flow-and-overnight-plan.md "Documentation each feature must update". Append every "SPARC said X / build did Y" divergence to ${RESEARCH}/al80-buildout-discoveries.md (create it if missing; it is the append-only ground-truth log).
6. Ship: commit, push a branch, open a DRAFT PR. Do NOT merge, do NOT push to main. Put the branch name and PR url in your result.

${SAFETY}

Return the structured BUILD_RESULT. Set testsGreen honestly - a red suite is a blocker, not a pass.`
}

function verifyPrompt(b, f) {
  return `Ultrathink, adversarially. A prior agent built "${f.name}". Your job is to REFUTE its "done", not rubber-stamp it. Default to skepticism.

Build agent reported: testsGreen=${b.testsGreen}, branch="${b.branch}", files=${JSON.stringify(b.filesChanged)}.

1. Fetch and check out the branch "${b.branch}" (git fetch && git checkout). Read the actual diff - do not trust the report.
2. Re-run the device-free tests yourself (${f.testCmd}). If they are not actually green on a clean checkout, verdict = fail.
3. Check the SPARC C checklist against the diff: is every deliverable, every doc-update, and every test ACTUALLY present? Missing doc update or missing test => needs-work.
4. Look for the usual lies: tests that assert nothing, a mock that hides a real bug, a builder whose bytes don't match the SPARC's wire table, host/.env accidentally staged, a "green" run that skipped the new tests.
5. ${f.verifyExtra}

${SAFETY}

Return the structured VERIFY_RESULT. Be specific in issues[] - file:line and what's wrong.`
}

// ---- the five features + the consolidated firmware -------------------------
// NB on ordering: features build against each other's INTERFACES + mocks (per the SPARCs),
// not each other's unmerged code - so they fan out in parallel and reconcile at PR-merge /
// at-desk. The conceptual dependency order lives in the build-out plan, not in this code.
const FEATURES = [
  {
    key: 'auto-cycle',
    name: 'LCD panel auto-cycle',
    sparc: `${RESEARCH}/al80-lcd-panel-auto-cycle-SPARC.md`,
    repo: 'al80-studio (host/)',
    model: HOST_MODEL, effort: 'medium', isolate: true,
    testCmd: 'node --test',
    testNote: 'Use the NEW RecordingDevice + transport-mock.js from the SPARC C2 - assert the panel rotation FSM, the committed invariant, alert pre-emption via scheduler.alertCount, and native-home clock dwell. No real Device.',
    buildExtra: '   - Do the Phase 0 refactor (split the run-loops into host/panels/{nowplaying,weather,clock}.js), then Phase 1 (cycle.js FSM + cycle-run.mjs owning ONE Device), then Phase 2 (smart rules + alert intake). Expose a jumpTo(panelId) on the cycler - the hotkey feature builds against it.',
    verifyExtra: 'Confirm cycle-run opens exactly ONE Device (single-opener) and that a dead Spotify token does not exit(1) the whole cycler.',
  },
  {
    key: 'music-reactive',
    name: 'Global music-reactive lighting',
    sparc: `${RESEARCH}/al80-music-reactive-lighting-SPARC.md`,
    repo: 'al80-studio (src/protocol.js + src/ui.js)',
    model: HOST_MODEL, effort: 'medium', isolate: true,
    testCmd: 'node --test',
    testNote: 'Fixture-test the audio->HSV mapper and assert buildLightBrightnessLive == bare buildLightSet(BRIGHTNESS,[v]) (noeeprom - NOT the EEPROM-writing wrapper). Test detectFirmware/pickSaveLessCommand branch selection. No live capture, no board.',
    buildExtra: '   - Add ONLY the new builder buildLightBrightnessLive (bare noeeprom set). Reuse startFx/stopFx/lightingFxCtl. Detect fw via buildBarGet() probe; custom->buildVialRGBColorLive, stock->buildLightColorLive+buildLightBrightnessLive. Scaffold the "Music" effect UI (no getDisplayMedia call in code paths that run headless).',
    verifyExtra: 'Confirm no accidental EEPROM-writing brightness path slipped in (that was the whole finding).',
  },
  {
    key: 'per-key-host',
    name: 'Per-key audio-reactive (HOST half)',
    sparc: `${RESEARCH}/al80-per-key-audio-reactive-SPARC.md`,
    repo: 'al80-studio (src/protocol.js)',
    model: HOST_MODEL, effort: 'medium', isolate: true,
    testCmd: 'node --test',
    testNote: 'Unit-test buildLiveLeds/buildLiveFrame: chunk boundaries (<=20 leds/chunk, 5 chunks/frame), the 0x49 opcode + offset/count framing, and the 82*3 buffer coverage. HOST builders only - the firmware 0x49 handler is the firmware feature.',
    buildExtra: '   - Build the host-side 0x49 stream builders only. Also RESOLVE the long-ambiguous MCU-part / flash-cap question from ground truth (read the linker script __flash0_size__ + the last .map / nm) and record the answer in the discoveries log - the firmware feature depends on it.',
    verifyExtra: 'Confirm the flash-cap question got a definitive answer (128KB vs 64KB) with its source cited, not hand-waved.',
  },
  {
    key: 'hotkey-host',
    name: 'Hotkey-to-panel (HOST half)',
    sparc: `${RESEARCH}/al80-hotkey-panel-switch-SPARC.md`,
    repo: 'al80-studio (host/device.js + cycle-run wiring)',
    model: HOST_MODEL, effort: 'medium', isolate: true,
    testCmd: 'node --test',
    testNote: 'Test the _onData 0x4B reader -> panelRequest -> cycler.jumpTo path against a MOCK cycler (do not depend on auto-cycle unmerged code - build against the jumpTo interface the auto-cycle SPARC specifies). Debounce/coalesce covered.',
    buildExtra: '   - Add the host inbound reader for the keyboard->host 0x4B panel signal and route it to cycler.jumpTo. Build against the jumpTo INTERFACE + a mock; integration with the real cycler is a PR-merge/at-desk concern.',
    verifyExtra: 'Confirm it does not open a second Device and that a stray 0x4B byte cannot wedge the reader.',
  },
  {
    key: 'autostart',
    name: 'Autostart unification',
    sparc: `${RESEARCH}/al80-buildout-flow-and-overnight-plan.md (Autostart unification section - not a standalone SPARC)`,
    repo: 'al80-studio (host/autostart/)',
    model: HOST_MODEL, effort: 'low', isolate: true,
    testCmd: 'node --test',
    testNote: 'Light: assert the --only=<panel> arg parsing and that the launcher targets cycle-run.mjs. No board.',
    buildExtra: '   - Repoint host/autostart/run-nowplaying.vbs at cycle-run.mjs (the superset host). Keep nowplaying-run.mjs/weather-run.mjs as --only=<panel> debug launchers. Deprecate daemon.js/transport-hid.js (fold their alert intake into the cycler). Update host/autostart/README + the KB single-opener note. Do NOT register any new scheduled task / startup entry - only repoint the existing launcher.',
    verifyExtra: 'Confirm NO new self-registering persistence was added (only the existing launcher repointed) - this is a hard user rule.',
  },
  {
    key: 'firmware',
    name: 'Consolidated firmware (.bin): view-switch + hotkey + per-key 0x49',
    sparc: `${RESEARCH}/al80-firmware-view-switch-keycodes-SPARC.md (+ hotkey + per-key SPARCs)`,
    repo: 'al80-lcd (custom QMK firmware tree)',
    model: FW_MODEL, effort: 'high', isolate: false, // separate repo - not an al80-studio worktree
    testCmd: 'qmk compile (device-free) + a host-mirrored wire-bytes unit test',
    testNote: 'Extract the view-announce builder as a pure fn and assert its bytes == the SPARC A4 wire table AND == protocol.js buildView(type) payload. CRC via al80_crc16 == protocol.js ga. Then COMPILE and measure the .map delta vs __flash0_size__. Do NOT flash.',
    buildExtra: `   - ONE build, three additions, per the firmware-view-switch SPARC (owns process_record) + hotkey SPARC (adds PANEL_* cases + raw_hid_send 0x4B) + per-key SPARC (adds the 0x49 opcode + g_live_rgb buffer + indicators_advanced paint + idle fallback):
       (a) add process_record_kb + view keycodes CUSTOM(22-24) + al80_screen_view/_send_view + the deferred view_request flag flushed in housekeeping_task_kb;
       (b) add PANEL_* keycodes CUSTOM(25-29) in the same switch + al80_panel_req (raw_hid_send 0x4B);
       (c) add the 0x49 per-key LED-stream opcode.
   - Compile clean. MEASURE flash delta against the cap resolved by the per-key-host agent's finding; if it does not fit, say so in blockers[] - do NOT trim features silently.
   - Produce the flashable .bin as a build artifact. DO NOT FLASH (brick/wedge risk; flashing is a morning at-desk step).`,
    verifyExtra: 'Re-derive the three view keycodes wire bytes by hand from the CRC and confirm they match A4 and buildView. Confirm the .bin was produced and the flash delta is within headroom with the cap source cited.',
  },
]

// ---- run: pipeline (build -> verify per feature, no barrier) ----------------
phase('Build')
log(`AL80 build-out - ${FEATURES.length} features. Sonnet on host, Opus on firmware + verify. Device-free only; flashing is the morning playbook.`)
if (budget.total) log(`Hard cap: ${Math.round(budget.total / 1000)}k output tokens.`)

const results = await pipeline(
  FEATURES,
  // Stage 1 - build (isolated worktree per al80-studio feature; firmware works in al80-lcd)
  (f) => agent(buildPrompt(f), {
    label: `build:${f.key}`,
    phase: 'Build',
    schema: BUILD_RESULT,
    model: f.model,
    effort: f.effort,
    ...(f.isolate ? { isolation: 'worktree' } : {}),
  }),
  // Stage 2 - adversarial verify, starts the moment this feature's build lands
  (build, f) => {
    if (!build) return null // build agent died/skipped
    return agent(verifyPrompt(build, f), {
      label: `verify:${f.key}`,
      phase: 'Verify',
      schema: VERIFY_RESULT,
      model: VERIFY_MODEL,
      effort: 'high',
    }).then((v) => ({ feature: f.name, build, verify: v }))
  },
)

const done = results.filter(Boolean)
const shipped   = done.filter((r) => r.verify && r.verify.verdict === 'pass')
const needsWork = done.filter((r) => r.verify && r.verify.verdict !== 'pass')
log(`Verified: ${shipped.length} pass, ${needsWork.length} need work.`)

// ---- morning at-desk playbook ----------------------------------------------
phase('Playbook')
const summary = JSON.stringify(
  done.map((r) => ({
    feature: r.feature,
    verdict: r.verify && r.verify.verdict,
    pr: r.build && r.build.prUrl,
    issues: r.verify && r.verify.issues,
  })),
  null, 2,
)
const playbook = await agent(
  `Ultrathink. Write the morning AT-DESK verification playbook for the AL80 build-out to ${RESEARCH}/al80-morning-playbook.md.
This is the human-gated, on-hardware half that could NOT run overnight (single-opener + the never-startle-live-effects rule + flash brick risk).

Context - what shipped (from the build+verify pipeline):
${summary}

Write an ordered, checkbox playbook covering, in a safe sequence:
  1. Flash the consolidated firmware .bin (with the "partial send wedges the LCD - replug resets" caveat).
  2. View-switch keys (Fn+9 home / Fn+8 picture / Fn+0 gif).
  3. Hotkey panel-jump - with cycle-run up.
  4. Per-key LED walk - one CYCLE_LEFT_RIGHT sweep to confirm g_aw20216s_leds order, THEN a static test pattern, BEFORE any audio.
  5. Auto-cycle on-device rotation (banding / transitions).
  6. Reactive RGB + audio LAST: getDisplayMedia gesture, global first then per-key, tasteful low defaults - confirm at the desk, never a startling flash.
Each step: exact action, expected result, and a line to record the outcome back into al80-buildout-discoveries.md. Flag any feature the verify pass marked needs-work/fail as "fix before flashing".
Commit the playbook to a branch and open a draft PR. Device-free (you are only WRITING the doc, not doing the steps).

${SAFETY}`,
  { label: 'playbook', phase: 'Playbook', model: HOST_MODEL, effort: 'medium', isolation: 'worktree' },
)

return {
  shipped: shipped.map((r) => ({ feature: r.feature, pr: r.build.prUrl })),
  needsWork: needsWork.map((r) => ({ feature: r.feature, issues: r.verify && r.verify.issues })),
  playbook: `${RESEARCH}/al80-morning-playbook.md`,
  discoveries: `${RESEARCH}/al80-buildout-discoveries.md`,
}
