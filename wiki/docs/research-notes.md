---
title: Research notes
status: index
scope: Index of the dated research notes, playbooks, and investigations in research/
---

# Research notes

The `research/` directory in the repo holds the raw, dated investigation notes, playbooks, SPARC
plans, and capture tooling that the reference pages were distilled from. This is the index; the
files themselves stay in `research/` (not duplicated here) so the wiki reference pages remain the
curated, front-loaded version.

## Investigations & playbooks

| File | What it is |
|---|---|
| `research/2026-07-02-picture-page-banding-investigation.md` | The overnight banding investigation (proposed the later-retired parity-slip theory; see [History](history/changelog.md)) |
| `research/2026-07-03-overnight-custom-qmk-summary.md` | Custom QMK build session — compiled GREEN, keys+RGB, editable presets |
| `research/custom-qmk-lcd-port-plan.md` | The verdict that LCD-on-custom is portable from source (C9 enable), no logic analyzer |
| `research/al80-lcd-morning-playbook.md` | Morning playbook: where the custom firmware stands (enable/baud confirmed) |
| `research/al80-lcd-on-custom-logic-analyzer-plan.md` | The (now-superseded) logic-analyzer plan for the screen forwarding |
| `research/al80-qmk-hardware-params.md` | Hardware params extracted from RIPPLE.bin for the custom build |
| `research/al80-feature-map.md` | Manual → RGB/keymap modification-method map |
| `research/vendor-feature-parity.md` | Full vendor app feature + payload inventory |
| `research/via-protocol.md` | VIA raw-HID protocol and how it shares the 0xFF60 interface |

## Roadmap & design (SPARC)

| File | What it is |
|---|---|
| `research/al80-dreams-roadmap.md` | Ideas grounded in the confirmed limits |
| `research/al80-always-on-host-SPARC.md` | Resident host that owns the LCD HID interface |
| `research/al80-nowplaying-webhooks-SPARC.md` | Now-playing + webhook alerts design (shipped: now-playing) |

## Captures & tooling

- `research/analyze_captures.py` — verifies the checksum rule against archived captures (4288/4288).
- `research/captures/`, `research/image_capture/`, `research/gif_capture/` — raw HID captures and
  test artifacts (test pattern, test GIF, findings).
- `research/mk856-src/` — sibling b75Pro + AL80 cert QMK source (the `PK_*` enum, factory stub).
- `research/source-notes/`, `research/site_assets/` — deobfuscated vendor JS bundle notes.

## Related repos & files

- **`al80-studio`** (sibling repo) — the WebHID control panel that drives all of this. `src/protocol.js`
  is the pure, unit-tested packet builder; `host/nowplaying-run.mjs` is the Spotify host.
- **`AL80_KNOWLEDGE_BASE.md`** (repo root) — the canonical single-file KB this wiki reorganizes.
- **`docs/llm-friendly-documentation-2026.md`** — the documentation philosophy this wiki follows.
