---
title: How-to — Now-playing (Spotify)
status: confirmed
scope: The live Spotify now-playing card, the host, and the Spotify PKCE gotchas
---

# How-to: now-playing (Spotify)

A Spotify now-playing card (96×160, album art + title/artist + progress) renders, then commits
through `PK_ADD_PIC`, then **displays and stays on-device.** This card is the first real payload
that proves the [display sequence](../protocol/display-commit.md) end-to-end with live data.

## 🔧 The host

- Host: `al80-studio/host/nowplaying-run.mjs` over the native node-hid transport `host/device.js`.
- Run: `node --env-file=.env nowplaying-run.mjs --live`.
- `--sync` tints the RGB to the dominant color of the cover.
- The same fix applies to the browser Picture tab of al80-studio. Drop the trailing
  `buildView(PICTURE)` from `ui.js`. `sendAckGated` already has the settles.

## ⚠️ Spotify PKCE gotchas (all hit + fixed, current 2026 docs)

- The **refresh token ROTATES** on every refresh. You MUST persist the newly returned
  `refresh_token`. If you do not, you keep only the old token, and the old token is revoked
  (`invalid_grant`).
- **Cache the access token** (~1 h `expires_in`). Refresh it only near expiry or on a 401. Do not
  refresh it on every poll.
- Use `Authorization: Bearer <access_token STRING>`. The capital B is case-sensitive. If you pass
  the token *object*, the API returns `400 Only valid bearer authentication supported`.
- A **dev-mode app** needs the calling account on the allowlist (Settings → User Management). If
  the account is not on the allowlist, the API returns **403** (owner needs Premium).
- The redirect URI must be **`http://127.0.0.1`**, not `localhost` (2025 rule).
- **Refresh tokens now expire at 6 months.** Handle `invalid_grant` → re-auth. Do not retry-loop.

The app Client ID is `4d8da9ff46054c45934a9f508d6928a8` (public, PKCE, no secret). The creds are in
the gitignored `host/.env`. The one-time auth is through `host/spotify-auth.mjs` (local
`127.0.0.1:8888/callback` catcher).

## 📖 What's next on the same path

now-playing is the first live info-panel. The same render → `PK_ADD_PIC` path can drive these
panels:

- CPU/GPU temp+load.
- Unread mail.
- A crypto/stock ticker.
- Weather.
- The next calendar event.

Refer to [History / Changelog](../history/changelog.md) and the roadmap notes in
[Research notes](../research-notes.md).
