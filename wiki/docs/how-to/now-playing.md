---
title: How-to — Now-playing (Spotify)
status: confirmed
scope: The live Spotify now-playing card, the host, and the Spotify PKCE gotchas
---

# How-to: now-playing (Spotify)

A Spotify now-playing card (96×160, album art + title/artist + progress) renders → commits via
`PK_ADD_PIC` → **displays and stays on-device.** This is the first real payload proving the
[display sequence](../protocol/display-commit.md) end-to-end with live data.

## The host

- Host: `al80-studio/host/nowplaying-run.mjs` over the native node-hid transport `host/device.js`.
- Run: `node --env-file=.env nowplaying-run.mjs --live`.
- `--sync` tints the RGB to the cover's dominant color.
- The same fix applies to al80-studio's browser Picture tab: drop `ui.js`'s trailing
  `buildView(PICTURE)`; `sendAckGated` already has the settles.

## Spotify PKCE gotchas (all hit + fixed, current 2026 docs)

- The **refresh token ROTATES** on every refresh — you MUST persist the newly returned
  `refresh_token` or the old one is revoked (`invalid_grant`).
- **Cache the access token** (~1 h `expires_in`); refresh only near expiry / on 401 — not every poll.
- `Authorization: Bearer <access_token STRING>` — capital B, case-sensitive; passing the token
  *object* returns `400 Only valid bearer authentication supported`.
- A **dev-mode app** needs the calling account on the allowlist (Settings → User Management) or the
  API returns **403** (owner needs Premium).
- Redirect URI must be **`http://127.0.0.1`**, not `localhost` (2025 rule).
- **Refresh tokens now expire at 6 months** — handle `invalid_grant` → re-auth, don't retry-loop.

App Client ID `4d8da9ff46054c45934a9f508d6928a8` (public, PKCE, no secret); creds in gitignored
`host/.env`; one-time auth via `host/spotify-auth.mjs` (local `127.0.0.1:8888/callback` catcher).

## What's next on the same path

now-playing is the first live info-panel. The same render → `PK_ADD_PIC` path can drive CPU/GPU
temp+load, unread mail, a crypto/stock ticker, weather, or the next calendar event — see
[History / Changelog](../history/changelog.md) and the roadmap notes in
[Research notes](../research-notes.md).
