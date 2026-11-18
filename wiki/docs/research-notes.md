---
title: Research notes
status: index
scope: Index of the dated research notes, playbooks, and investigations in research/
---

# Research notes

The `research/` directory in the repo holds the raw, dated investigation notes, playbooks, SPARC
plans, and capture tooling. The reference pages come from these files. This page is the index. The
files stay in `research/` and are not copied here. Thus the wiki reference pages stay the curated
version, with the important data first.

## 🔧 Investigations & playbooks

| File | What it is |
|---|---|
| `research/2026-07-02-picture-page-banding-investigation.md` | The overnight banding investigation. It proposed the parity-slip theory, which was retired later (see [History](history/changelog.md)). |
| `research/2026-07-03-overnight-custom-qmk-summary.md` | The custom QMK build session: compiled GREEN, keys+RGB, editable presets |
| `research/custom-qmk-lcd-port-plan.md` | The verdict that LCD-on-custom is portable from source (C9 enable), with no logic analyzer |
| `research/al80-lcd-morning-playbook.md` | Morning playbook: the status of the custom firmware (enable/baud confirmed) |
| `research/al80-lcd-on-custom-logic-analyzer-plan.md` | The logic-analyzer plan for the screen forwarding (now superseded) |
| `research/al80-qmk-hardware-params.md` | The hardware params from RIPPLE.bin for the custom build |
| `research/al80-feature-map.md` | A map from the manual to the RGB/keymap modification methods |
| `research/vendor-feature-parity.md` | The full inventory of vendor app features and payloads |
| `research/via-protocol.md` | The VIA raw-HID protocol, and how it shares the 0xFF60 interface |

## 📖 Roadmap & design (SPARC)

| File | What it is |
|---|---|
| `research/al80-dreams-roadmap.md` | Ideas that are based on the confirmed limits |
| `research/al80-always-on-host-SPARC.md` | A resident host that owns the LCD HID interface |
| `research/al80-nowplaying-webhooks-SPARC.md` | The design for now-playing + webhook alerts (shipped: now-playing) |

## 📦 Captures & tooling

- `research/analyze_captures.py`: checks the checksum rule against the archived captures (4288/4288).
- `research/captures/`, `research/image_capture/`, `research/gif_capture/`: raw HID captures and
  test artifacts (test pattern, test GIF, findings).
- `research/mk856-src/`: the sibling b75Pro + AL80 cert QMK source (the `PK_*` enum, factory stub).
- `research/source-notes/`, `research/site_assets/`: notes on the deobfuscated vendor JS bundle.

## 📖 Related repos & files

- **`al80-studio`** (sibling repo): the WebHID control panel that drives all of this. `src/protocol.js`
  is the pure packet builder, with unit tests. `host/nowplaying-run.mjs` is the Spotify host.
- **`AL80_KNOWLEDGE_BASE.md`** (repo root): the canonical single-file KB. This wiki puts its content
  into sections.
- **`docs/llm-friendly-documentation-2026.md`**: the documentation philosophy that this wiki
  follows.
