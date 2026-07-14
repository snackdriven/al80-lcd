# AGENTS.md

## Project Shape

This repo is the private source of truth for reverse-engineering and driving the
YUNZII AL80 LCD panel over raw HID. It contains docs, wiki source, research
captures/notes, host-side tooling, image conversion code, and custom firmware
release artifacts.

Start with these files:

- `AL80_KNOWLEDGE_BASE.md` - canonical protocol and hardware reference.
- `README.md` and `llms.txt` - short repo map and current entry points.
- `wiki/` - MkDocs source for the public wiki.
- `firmware/` - custom firmware bins, release script, and source backups.
- `tooling/` - clock sync scripts that talk to the keyboard over HID.
- `converter/` - still-image packet builder and verifier.
- `research/` - raw findings, captures, plans, and dated investigation notes.

If files disagree, trust `AL80_KNOWLEDGE_BASE.md` first, then current root docs,
then older subdirectory docs. Known trap: older converter docs may still mention
`112x137`; the settled panel geometry is `96x160`, RGB565 big-endian, row-major.

## Safety Rules

- Do not send or generate HID commands `0xB0` through `0xB7`. Those are
  bootloader/DFU paths and can brick the board.
- Normal LCD work should stay on the `0x40` announce, `0x41` data, `0x42`
  finish path unless the knowledge base explicitly says otherwise.
- Do not casually reflash firmware. If firmware work is actually requested,
  read `firmware/README.md` and the relevant research note first.
- The `0xFF60` HID interface is single-opener. Close the YUNZII web app or any
  other host process before testing scripts against hardware.
- Treat firmware binaries and vendor assets as artifacts. Do not rewrite,
  normalize, or regenerate them unless the task is explicitly about that file.

## Commands

Converter:

```bash
cd converter
npm install
npm test
node al80-image.js <image> --dry-run out.json --verify
python al80_verify.py out.json
```

Clock tooling:

```bash
cd tooling
npm install node-hid
node al80_clock.js --once
python al80_clock.py --once
```

Wiki:

```bash
cd wiki
uvx --with mkdocs-material mkdocs serve
uvx --with mkdocs-material mkdocs build
./deploy.sh "wiki: message"
```

Firmware release:

```bash
cd firmware
./release.sh v1.3.0 "title" "notes"
```

The firmware release script builds from `~/qmkwork/vial-qmk`, checks the flash
cap from the ELF, copies the bin/source backups, commits, pushes, and creates a
GitHub release. Use it only when that whole flow is intended.

## Working Rules

- Check `git status --short --branch` before edits. This repo often has local
  firmware/source artifacts in flight; do not clean or revert user work.
- Stage files by name. Avoid broad `git add .` in this repo because firmware
  bins and generated wiki output can sit next to source changes.
- Keep docs factual and dated when a claim came from a specific investigation.
  Protocol claims drift as captures are re-read; stale theories are kept for
  history but should be marked superseded, not silently reused.
- For docs/wiki changes, build the wiki before calling it done.
- For converter changes, run `npm test` in `converter/` and, when touching
  emitted packet structure, run the Python verifier against a generated JSON.
- For hardware-touching changes, separate device-free checks from at-desk
  verification. If the physical keyboard was not tested, say that plainly.
- Do not add AI/Codex attribution to commits, release notes, docs, or PR text.

