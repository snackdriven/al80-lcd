# Keymap

VIA files for the AL80 — the layout work documented in `../AL80_KNOWLEDGE_BASE.md` §9.
**Two different things live here** (easy to confuse):

| File | What it is |
|------|-----------|
| `al80_keymap.json` | **The actual keymap** — the current live layout (4 layers, macros, encoders). This is what you Load in usevia.app to restore your bindings. Exported via VIA's Save (matches rev2.1's `window.__editedJSON`, 6571 bytes). |
| `AL80_QMK__V0106_20251219.json` | **The keyboard *definition*** (VIA design JSON: matrix, layouts, keycodes, menus) — describes the hardware to VIA, not your bindings. |
| `AL80_QMK__V0106_20251219.zip` | Original zip of the definition, kept for provenance. |
| [`community/`](community/) | Third-party VIA files from @nvoostrom (ArgentStonecutter/keyboards). His fixed definition exposes **25 named custom keycodes** — including `HOM`/`IMG`/`GIF` LCD view-switches — that Yunzii's own definitions hide. See `community/README.md`. |

Quick recap of the layout in `al80_keymap.json` (full detail in the knowledge base):
- Layer 0: F12 = `LT(1, F12)`, Caps = `LT(2, Caps)`, Del restored to `KC_DEL`
- Layer 1 (hold F12): app launcher on S/T/E/C
- Layer 2 (hold Caps): S = snip macro, N = NumLock, Q = close window
- Macro 0: Windows snipping tool — `Down(LGUI) Down(LSFT) Tap(S) Up(LSFT) Up(LGUI)`
- Encoders: volume down / up on all 4 layers

Applied via VIA only — no firmware recompile, so the ripple-lighting firmware stays put.
