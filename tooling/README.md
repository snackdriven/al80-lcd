# AL80 12-Hour LCD Clock Sync

Makes the YUNZII AL80's LCD show a 12-hour clock synced to your PC.
Works with the ripple-lighting firmware in place (no reflash needed).

## How it works
The LCD firmware displays whatever hour value it receives, so sending the
hour as 1-12 (instead of 0-23) yields a 12-hour clock. The keyboard runs its
own internal clock, so it's re-synced on an interval to prevent drift.
No AM/PM indicator is available on this firmware.

## Protocol (raw HID, VID 0x28E9 / PID 0x30AF, interface usagePage 0xFF60, report ID 0)
Each packet is padded to 64 data bytes (Node/Python prepend a 0x00 report-ID byte).

    P1 (announce): 40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1
    P2 (time):     41 00 00 03 [CKSUM] 00 00 HH MM SS
    P3 (finish):   42 00 00 38 7A

    HH    = (hour24 % 12) || 12
    CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF

The device ACKs each packet by echoing it with byte[6] set to 0x55.

## Files
- al80_clock.js .............. Node version (npm install node-hid)
- al80_clock.py .............. Python version (pip install hidapi)
- al80_clock.bat ............. visible launcher (shows console + pause on crash)
- al80_clock_hidden.bat ...... silent launcher (via run_hidden.vbs)
- run_hidden.vbs ............. helper to run Node with no window
- browser_console_snippet.js . no-install option; paste into the site's console
- al80_clock.log ............. created at runtime; timestamped sync/error log

## Setup (Node)
1. Install Node.js (LTS).
2. In this folder:  npm install node-hid
3. Test:  node al80_clock.js --once   (LCD should update; exits 0 on success)
4. Run the loop:  node al80_clock.js   (or use a launcher)

## Setup (Python)
1. Install Python 3 (check "Add to PATH").
2. pip install hidapi
3. Test:  python al80_clock.py --once
4. Run:   python al80_clock.py   (or  pythonw al80_clock.py  for no window)

## Auto-start at login
Win+R -> shell:startup -> put a shortcut to al80_clock_hidden.bat there.
(Or use Task Scheduler "At log on" with "restart on failure" for more robustness.)

## Loud errors
Every sync is logged to al80_clock.log. After 3 consecutive failures the script
fires a native Windows toast notification (no dependencies) so you're alerted
even when it runs hidden.

## Gotchas
- Close the yunzii-game.com browser tab before running the script - the raw HID
  interface generally allows only one opener at a time.
- If the device isn't found, your hidapi/node-hid build may not report usagePage;
  inspect the enumerated interfaces and match by interface number instead.
