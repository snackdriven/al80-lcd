# SPARC: Now-Playing (Spotify) + Webhook Alerts (2026-07-02)

Two apps on the M1 daemon (`al80-studio/host/`). Both are "glanceable status" surfaces, so they
share a foundation and differ mainly in data source. The two load-bearing decisions:
- **Spotify:** poll metadata slowly, **interpolate progress locally** — smooth bar, tiny API load.
- **Webhooks:** don't build a relay — **use ntfy** (self-hosted on the seedbox) as the pub-sub pipe.
  The daemon subscribes outbound (works behind NAT); sources publish. Uptime Kuma speaks ntfy natively.

---

## Shared foundation (build once)

**App model.** An app is `{ id, fps, render(ctx, now) -> Uint8Array(30720), onKnob?(dir), preempt? }`.
The daemon loop already renders → diffs → paced-sends → echo-checks (validated tonight).

**Scheduler with preemption.** A base app runs (clock / now-playing). An **alert preempts** it: show
the alert, then restore the base app. Sticky alerts wait for an ack; transient ones time out.
```
active = base
onAlert(a): stack.push(active); active = alertApp(a); if(!a.sticky) after(a.ttl, restore)
onAck():   active = stack.pop() || base
```

**Rendering additions** (beyond tonight's font/rect/diff): `loadImage()`→scale→RGB565 (album art,
via `@napi-rs/canvas`), and a **marquee** helper (blit a 96px window of a wider text buffer, shift
per frame → one contiguous band, cheap).

**Config + secrets.** `host/config.json` (non-secret) + `host/.secrets.json` (gitignored: Spotify
tokens, ntfy token). Both features register in the scheduler.

**Banding note:** album art and colored alerts need the picture-page byte-swap fix. Until then,
text-only versions run clean on the **main page (96×64)**.

---

# Feature A — Now-Playing (Spotify)

## S — Specification
Show the current Spotify track — album art, title, artist, progress — on the LCD, glanceable and
always-on, updating smoothly.

**Functional:** FR1 authenticate once (OAuth) + auto-refresh; FR2 poll `/me/player` every ~3 s for
metadata + `is_playing` + `progress_ms`/`duration_ms`; FR3 **interpolate progress every tick** between
polls, resync on poll; FR4 render art (top 96×96) + title (marquee if long) + artist + progress bar +
elapsed/total + play state; FR5 fetch + scale + cache album art, redraw **only on track change**;
FR6 handle "nothing playing" / "no active device" gracefully. FR7 (v2) knob = skip/scrub/pause.

**Non-functional:** poll well under the rate limit (~180 req/min); art only on change; region updates
cheap (bar/time each tick, art occasional); resilient to API/network blips (show last-known + a stale
flag). **Non-goals v1:** knob control (needs a VIA remap, below), SMTC any-source, lyrics.

**Constraints/risks:** OAuth one-time setup (Spotify app registration + local callback); album art
needs the banding fix + an image decoder (`@napi-rs/canvas`); Spotify API shows **only Spotify**
(browser/other sources need SMTC — a brittle WinRT/PowerShell bridge, deferred); the knob's OS job is
**volume**, so knob-control conflicts unless the knob is remapped in VIA to a custom keycode.

## P — Pseudocode
```
auth(): if no refresh_token -> PKCE flow: open browser to authorize URL (scopes:
        user-read-currently-playing, user-read-playback-state[, user-modify-playback-state]),
        catch redirect on 127.0.0.1:PORT, exchange code -> {access,refresh}, persist refresh.
tokens.access refreshed when expired (refresh_token grant).

pollLoop (every 3s):
  p = GET /me/player            // is_playing, item{name,artists,album.images}, progress_ms, duration_ms
  if p.item.id != state.trackId: state.art = await fetchScaleArt(p.item.album.images)  // 300->96, cache
  state = {trackId, title, artist, dur, progAtPoll: p.progress_ms, polledAt: now(), playing: p.is_playing}

render(now):                     // called each daemon tick (~1 fps display; bar smooths via interp)
  prog = state.playing ? state.progAtPoll + (now - state.polledAt) : state.progAtPoll
  fb = frame(); blit(state.art, 0,0)                      // top 96x96 (redraws only when art bytes change)
  marquee(fb, state.title, y=100); text(fb, state.artist, y=118, dim)
  bar(fb, prog/state.dur, y=150); text(fb, mmss(prog)+'/'+mmss(state.dur), y=134)
  return fb
```

## A — Architecture
```
host/apps/nowplaying.js     render() + marquee + progress interpolation
host/lib/spotify-auth.js    PKCE flow + local callback server + token refresh
host/lib/spotify.js         GET /me/player ; (v2) PUT/POST /me/player/{next,previous,pause,seek}
host/lib/art-cache.js       fetch image -> @napi-rs/canvas decode/scale 96x96 -> RGB565 (cache by trackId)
host/.secrets.json          { spotify: { clientId, refreshToken } }   (gitignored)
```
Data flow: `spotify.poll` (3 s) → `state` → `nowplaying.render` (per tick) → diff → HidTransport.
Registered as a base app in the scheduler (clock and now-playing rotate or user-selects).

## R — Refinement
- **Progress interpolation + resync** (FR3): smooth bar with a ~3 s API cadence; clamp to duration;
  reset on seek detected (poll progress jumps).
- **Token lifecycle:** refresh on 401/expiry; if refresh fails, prompt re-auth (rare). Store only the
  refresh token; never the client secret in the daemon (use PKCE — public client, no secret).
- **Rate limit / backoff:** on 429, honor `Retry-After`; widen poll when nothing's playing.
- **"Nothing playing":** show a dim idle card (last track greyed, or a small logo) — don't thrash.
- **Art cache:** keep last N covers by trackId; skip fetch if unchanged; art redraw only changes the
  top 96×96 bytes, so the diff naturally makes it an occasional big region.
- **Knob control (v2):** conflicts with OS volume. Fix = remap the knob in **VIA** to a custom keycode
  the daemon reads on `MI_03` (raw) or a dedicated consumer usage; then turn=scrub/skip, press=pause
  via the Spotify API. Documented as v2, not v1.
- **SMTC any-source (future):** a PowerShell/WinRT bridge to `GlobalSystemMediaTransportControls*`
  captures browser/any player + a thumbnail stream — brittle, so it's a later add, not the primary.
- **Banding dependency:** art needs the byte-swap fix; ship a **text-only main-page** variant first.
- **Testing:** mock the Spotify JSON + a local sample cover → render via the **mock transport → PNG**;
  no live account needed to iterate the layout.

## C — Completion
- **N1** auth + poll + **text-only** render (title/artist/progress on the main page) — works today, no
  banding gate.
- **N2** album art (after the byte-swap fix): fetch/scale/cache + top-96×96 blit.
- **N3** marquee + smooth progress interpolation.
- **N4** knob control (after a VIA remap).
- **Accept (N1–N3):** the current track shows with a smoothly ticking progress bar, art updates on
  track change, survives network blips, negligible API load. **First step:** register a Spotify app
  (PKCE, redirect `http://127.0.0.1:8888/callback`), scope `user-read-playback-state`.

---

# Feature B — Webhook Alerts

## S — Specification
External events (monitors, CI, generic) appear as alerts on the LCD, delivered to the behind-NAT
daemon without inbound ports.

**Functional:** FR1 daemon **subscribes outbound** to an ntfy topic (HTTP stream) and reconnects with
backoff; FR2 an **alert app** preempts the base app, renders level color + icon + title + body (scroll
if long); FR3 **sticky** alerts (error) wait for an ack (knob/key), **transient** (info) auto-clear +
restore; FR4 **local events** (the terminal-notifier) POST to the daemon's `127.0.0.1` endpoint
directly (skip the internet round-trip); FR5 sources: **Uptime Kuma** (native ntfy), GitHub, generic
`curl`; FR6 dedup / rate-limit (a flapping monitor mustn't strobe the panel); FR7 deliver missed
alerts on reconnect (ntfy `since=`).

**Non-functional:** authenticated (ntfy token/ACL + TLS); the daemon holds only an outbound
connection; low idle cost; the seedbox piece is tiny + self-hosted (privacy). **Non-goals v1:**
bidirectional control from the LCD, rich media in alerts, many-daemon fan-out.

**Constraints/risks:** the **seedbox must expose a public HTTPS endpoint** for ntfy (Ultra.cc app-port
/ reverse-proxy — VERIFY reachability); TLS + token management; offline queueing TTL; spam control.

## P — Pseudocode
```
# seedbox: run ntfy (docker/binary), topic e.g. al80-alerts, auth token, TLS via the box's proxy.
#   Uptime Kuma -> Settings -> Notifications -> ntfy(url, topic).  GitHub -> ntfy webhook/forwarder.
#   generic:  curl -H "Authorization: Bearer T" -d '{"title":"...","message":"...","tags":["warning"]}' URL/al80-alerts

daemon.relayClient:
  loop: GET https://ntfy.seedbox/al80-alerts/json?since=<lastId>  (streaming)  [outbound]
    on message m: scheduler.onAlert(normalize(m))                  # {title,body,level<-tags,sticky}
    on drop: backoff + reconnect with since=lastId                 # gets missed alerts

daemon.localHook (127.0.0.1:7333):
  POST /alert {title,body,level,sticky} -> scheduler.onAlert(...)  # local/terminal events, no round-trip

alertApp(a).render():
  frame(bg = levelColor(a.level)); icon(a.level); marquee(a.title, y=..); wrap(a.body, y=..)
  if a.sticky: show "press to dismiss"; onKnobOrKey -> scheduler.onAck()
  else: after ttl -> scheduler.restore()

dedup: drop identical (source+title) within window; collapse a flapping source to one card + a count.
```

## A — Architecture
```
SEEDBOX (public):
  ntfy server (self-hosted)         pub-sub; topics + auth; TLS via existing reverse proxy
  [Uptime Kuma already here]        native ntfy notifier -> topic
DAEMON (local):
  host/control/relay-client.js      outbound ntfy subscription + reconnect + since=
  host/control/local-hook.js        127.0.0.1 endpoint for local/terminal events
  host/apps/alert.js                preemptive alert render + ack
  host/.secrets.json                { ntfy: { url, topic, token } }
```
Data flow: `webhook source -> ntfy(seedbox) -> [outbound stream] -> daemon.relay-client ->
scheduler.onAlert -> alert.render -> LCD`. Local events bypass the seedbox via `local-hook`.
**Why ntfy, not a custom relay:** it already solves pub-sub, auth, the outbound-subscribe-behind-NAT
pattern, missed-message replay, and even a phone app — and Uptime Kuma has a built-in ntfy notifier.
A hand-rolled WS relay is the fallback if self-hosting ntfy is a problem.

## R — Refinement
- **Reachability unknown:** confirm the seedbox can serve a public HTTPS endpoint (Ultra.cc app URL /
  reverse-proxy). If not, fallback options: ntfy.sh (public, less private), a Cloudflare Tunnel from
  the seedbox, or the hand-rolled outbound-WS relay.
- **Auth/TLS:** ntfy access tokens + topic ACL; TLS terminated by the box's proxy. Per-source secrets
  where the source supports it (GitHub HMAC → a tiny forwarder that validates then publishes).
- **Offline/missed:** ntfy caches; daemon reconnects with `since=<lastId>` to replay. TTL per source.
- **Dedup / rate-limit:** window-dedup identical alerts; collapse flapping into one card + a counter;
  a hard cap on alerts/min so the panel never strobes.
- **Preemption policy:** error > warn > info; an error is sticky (ack to clear); info auto-clears in
  ~5 s and restores the base app. A queue if several arrive.
- **Ack via knob/key:** dismiss with a knob press or a chosen key (reading the consumer/raw interface).
- **Local vs remote split:** local/terminal notifier posts to `127.0.0.1` (instant, private); only
  internet-origin events traverse the seedbox. Same alert model both ways.
- **Testing:** `curl` a fake alert to `127.0.0.1:7333/alert` and to the ntfy topic → render via the
  **mock transport → PNG**; verify preemption, sticky/transient, dedup — no real webhook needed.

## C — Completion
- **W1** self-host ntfy on the seedbox + daemon subscribes + a hardcoded test alert renders.
- **W2** alert app: level color + icon + title/body + transient/sticky + ack.
- **W3** wire **Uptime Kuma → ntfy** (near-zero glue; the first real, useful alert).
- **W4** GitHub + generic `curl` + dedup/rate-limit + the `127.0.0.1` local path.
- **Accept:** taking a monitored site down flashes "SITE DOWN" on the keyboard within seconds; it
  clears/acks correctly; a flapping source doesn't strobe. **First step:** confirm the seedbox can
  expose ntfy over public HTTPS; if yes, `docker run` ntfy + point Uptime Kuma at it.

---

## Sequencing + combined caveats

**Build webhooks first.** It reaches a real, useful result fastest: no OAuth, **no banding gate**
(text alerts render clean on the main page today), and the infra exists (seedbox + Uptime Kuma). Now-
playing needs OAuth + the byte-swap fix + an image decoder, so it's second (and its N1 text-only
variant can land in parallel).

**Shared gates/unknowns:**
- **Banding fix** — gates album art + colored alerts on the picture page; both have clean main-page
  text fallbacks until then.
- **Knob** — readable + benign, but its OS job is volume; any knob *control* (scrub/skip/ack) wants a
  VIA remap so it doesn't fight volume. Ack-via-a-key needs no remap.
- **Seedbox public HTTPS** — the one infra unknown for webhooks; verify, with ntfy.sh / Cloudflare
  Tunnel / WS-relay as fallbacks.
- **@napi-rs/canvas** — pulled in for art decode/scale (fine; prebuilt).
- Both plug into the same scheduler/preemption, so building the **foundation** (app model + scheduler)
  is the true first task, then W1→W4, then N1→N3.
