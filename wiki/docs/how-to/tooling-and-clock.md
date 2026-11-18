---
title: How-to — Tooling & the 12-hour clock
status: confirmed
scope: The clock scripts, the language-agnostic recipe, gotchas, and RE notes for future captures
---

# How-to: tooling & the 12-hour clock

The tooling in `tooling/` (originally packaged as `al80_12hr_clock.zip`) keeps a 12-hour clock on
the LCD. To do this, it re-syncs the time every ~60 s. The hack itself is on
[Time & Date sync → 12-hour clock hack](../protocol/time-and-date.md).

## 🔧 What's in `tooling/`

- **`al80_clock.js`**: Node (node-hid). Loop or `--once`, file logging, a Windows toast after 3
  consecutive failures, and crash handlers.
- **`al80_clock.py`**: Python (hidapi). It has the same features.
- **`al80_clock.bat`**: visible launcher (console + pause).
- **`al80_clock_hidden.bat`** + **`run_hidden.vbs`**: silent background launcher.
- **`browser_console_snippet.js`**: no install. Paste it into the yunzii-game.com console.
- Auto-start: put a shortcut to the hidden `.bat` in `shell:startup`, or use Task Scheduler at
  logon with restart-on-failure.

## 🕐 Core recipe (language-agnostic)

```text
h = (hour24 % 12) or 12
cksum = (0x41 + 0x03 + h + minute + second) & 0xFF
write pad([0x40,0,0,0x07,0xF6,0x02,0,0xA5,0x5A,0x09,0,0x03,0xC3,0xE1])   // announce
write pad([0x41,0,0,0x03,cksum,0,0,h,minute,second])                     // data
write pad([0x42,0,0,0x38,0x7A])                                          // finish
// pad() = prepend 0x00 report id (OS libs), then zero-fill to 64 data bytes
```

## ⚠️ Gotchas

- **Only one opener** of the `0xFF60` interface is possible at a time. Before you run the script,
  close the yunzii-game.com tab (and VIA). If you do not, they fight.
- If the script does not find the device, possibly hidapi/node-hid does not report `usagePage`. In
  this case, match by **interface number** (enumerate and inspect).
- The keyboard free-runs its own clock, and the clock drifts. That is why the re-sync loop exists.

## 📖 RE notes for future capture sessions (yunzii-game.com)

- The web app holds its **own** device handle. After any reconnect, it re-acquires the handle
  through `getDevices()`/request. A patch to `window.__lcd.sendReport` or
  `HIDDevice.prototype.sendReport` does **not** intercept the sends of the app. (The app captured a
  bound reference first.) Read the app's own **`window.__hidCaptures`** buffer instead.
- Console state: `targetDevice HIDDevice` = device (re)selected; `sendCount 1` = a send fired;
  `No HID device selected` = the app lost its handle (it needs a reconnect).
- `javascript_tool` on the site: async/Promise-returning top-level expressions return `{}`, but
  their side-effects still run. Use this sequence:
    1. Do the async work.
    2. Stash the result to `window`.
    3. Read the result with a separate **synchronous** call.
- A security-filter false positive (`[BLOCKED: Cookie/query string data]`) fires when a call
  returns long hex/token-like strings. Emit only short scalar fields or structural booleans.
