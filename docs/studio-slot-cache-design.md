# Studio slot cache + recents — design

Goal: al80-studio remembers what it pushed to each LCD area, shows it on load, and lets you re-push / replace / clear — plus a recents library to re-use past pushes.

## The constraint (why it's a client-side cache)
The LCD is **write-only for content** — no pixel read-back. So the cache is *Studio's record of what Studio pushed*, persisted in the browser, not a read of the device. The module persists content across unplugs, so the record stays accurate unless another app or a reflash changes it. Label everything **"last pushed from Studio · <time>"** — it's a model, not a mirror. (Possible later sanity-check: query `GIF_NUM` / picture-slot count and flag a mismatch. Nice-to-have.)

## Areas → slots
`main`, `picture` (slot ring — the Slideshow feeds this), `gif`, `startup`. Clock is excluded (it's generated). When **Now Playing** is running it owns the picture/main slot as a **live** source (card shows "▶ Now Playing (live)", not a frozen thumb).

## Data (IndexedDB, db `al80studio`)
Store `slots` keyed by `area`:
```
{ area, name, kind: 'image'|'gif'|'slideshow'|'live',
  sourceBlob,   // the ORIGINAL file you picked (re-derivable; NOT the 5MB RGB565)
  settings,     // fit, fps, brightness, contrast, saturation, gray, dither, dest
  thumbBlob,    // small PNG, first processed frame
  frameCount, fps, pushedAt }
```
Store `recents` keyed by `id`: same shape + `id` + `pinned`. Capped (~24), LRU-evict the unpinned. Store **source + settings**, re-derive frames on re-push; optional in-memory same-session frame cache for instant re-push.

## Capture point
In `ui.js`, after a **successful** send in each dest handler (picture/main still, gif/startup/gif-page, slideshow): `saveSlot(area, {...})` + `addRecent(...)`. Thumb = render frame 0 to a small canvas → `toBlob`.

## UX
- **Per-tab "Currently on <area>" card**: thumbnail + name + "pushed <time>" + `[Re-push] [Replace] [Clear]`. GIF cards animate the source on hover.
- **Overview strip** in the device-bar ("On the LCD"): the 4 slot thumbnails, click to jump to that tab.
- **Recents drawer/gallery**: recent pushes as thumbnails; click → load into the current tab (re-derive) or re-push to its area; pin to keep.
- Restored on app load (read slots → render cards).
- **Live handling**: while Now Playing runs, the picture/main card shows "▶ Now Playing (live)".

## Actions
- **Re-push**: slot.source + settings → existing process pipeline → existing send path (clear-before-send already in).
- **Replace**: pick a new file → normal push → overwrites the slot.
- **Clear**: delete the slot; optionally also wipe the device area (`buildClearGif` / `DEL_PIC`) behind a confirm.

## Storage / quotas
IndexedDB (~50MB+). Per-area = bounded (4 slots). Recents capped ~24. Blobs: source ~1–5 MB, thumb a few KB. Evict oldest unpinned recents at the cap; on quota-exceeded, drop the source but keep thumb+settings so the display survives.

## Files
- **new `src/slots.js`** — IndexedDB CRUD (`getSlot`/`saveSlot`/`allSlots`/`clearSlot`; recents `add`/`list`/`pin`/`evict`) + a thumbnail helper. Pure-ish, unit-testable (thin IDB abstraction or fake-indexeddb).
- `src/ui.js` — call save/addRecent in the send handlers; render cards + overview strip + recents; wire actions; restore on load; hook the Now-Playing live state.
- `index.html` — card containers per tab + overview strip + recents drawer.
- `styles.css` — card / strip / recents styles.
- `test/` — slots.js logic (recents cap/evict, record shape).

## Honesty note
Every surface reads "Last pushed from Studio · <time>," never "on the device now." Studio can't read the panel back; this is its own memory of what it sent.
