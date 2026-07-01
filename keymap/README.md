# Keymap

VIA/QMK keymap export for the AL80 — the layout work documented in `../AL80_KNOWLEDGE_BASE.md` §8.

| File | What it is |
|------|-----------|
| `AL80_QMK__V0106_20251219.json` | The keymap itself (VIA Save-JSON format, build V0106 / 2025-12-19). Load it in usevia.app via Load-JSON. |
| `AL80_QMK__V0106_20251219.zip` | Original zip as downloaded (contains just the JSON). Kept for provenance. |

Quick recap of what this layout does (full detail in the knowledge base):
- Layer 0: F12 = `LT(1, F12)`, Caps = `LT(2, Caps)`, Del restored to `KC_DEL`
- Layer 1 (hold F12): app launcher on S/T/E/C
- Layer 2 (hold Caps): S = snip macro, N = NumLock, Q = close window
- Macro 0: Windows snipping tool (`Win+Shift+S`)

Applied via VIA only — no firmware recompile, so the ripple-lighting firmware stays put.
