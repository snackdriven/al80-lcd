---
title: How-to — Now-playing (Spotify)
status: confirmed
type: how-to
scope: The live Spotify now-playing card, the host, and the Spotify PKCE gotchas
---

# How-to: now-playing (Spotify)

Use this page to show a live Spotify now-playing card on the LCD.

A Spotify now-playing card (96×160, album art + title/artist + progress) renders, then commits
through [`PK_ADD_PIC`](../reference/glossary.md), then **displays and stays on-device.** This card
is the first real payload that proves the [display sequence](../protocol/display-commit.md) end to
end with live data.

## 📋 Before you start

The app Client ID is `4d8da9ff46054c45934a9f508d6928a8` (public, PKCE, no secret). The creds are in
the gitignored `host/.env`. The one-time auth is through `host/spotify-auth.mjs` (local
`127.0.0.1:8888/callback` catcher).

## 🔧 Run the host

The host is `al80-studio/host/nowplaying-run.mjs`, over the native node-hid transport
`host/device.js`.

1. Run `node --env-file=.env nowplaying-run.mjs --live`.
2. (Optional) To tint the RGB to the cover's dominant color, add `--sync`.

The same fix applies to the al80-studio browser **Picture** tab: drop the trailing
`buildView(PICTURE)` from `ui.js`. `sendAckGated` already has the settles.

## ⚠️ Spotify PKCE problems (all hit and fixed, current 2026 docs)

PKCE (Proof Key for Code Exchange) is the Spotify sign-in flow that works without a client secret.

- The **refresh token rotates** on every refresh. You **must** save the newly returned
  `refresh_token`. If you don't, you keep only the old token, and the old token is revoked
  (`invalid_grant`).
- **Cache the access token** (~1 h `expires_in`). Refresh it only near expiry or on a 401, not on
  every poll.
- Use `Authorization: Bearer <access_token STRING>`. The capital B is case-sensitive. If you pass
  the token *object*, the API returns `400 Only valid bearer authentication supported`.
- A **dev-mode app** needs the calling account on the allowlist (Settings → User Management). If
  the account isn't on the allowlist, the API returns **403** (owner needs Premium).
- The redirect URI must be **`http://127.0.0.1`**, not `localhost` (2025 rule).
- **Refresh tokens now expire at 6 months.** If you get `invalid_grant`, re-auth. Don't retry in a
  loop.

## 📖 What's next on the same path

Now-playing is the first live info-panel. The same render → `PK_ADD_PIC` path can drive these
panels:

- CPU/GPU temp+load.
- Unread mail.
- A crypto/stock ticker.
- Weather.
- The next calendar event.

See [History / Changelog](../history/changelog.md) and the roadmap notes in
[Research notes](../research-notes.md).
