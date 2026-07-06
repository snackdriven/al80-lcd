---
title: Time & Date sync
status: confirmed
scope: The working clock/date protocol, packet byte-maps, and the 12-hour clock hack
---

# Time & Date sync

The clock protocol is confirmed working. A full "update time" is an announce → data → finish
transaction, sent **3×**, for both the time channel (`type 9`) and the date channel (`type 10`).

!!! tip "TL;DR"

    - A full clock update is **announce → data → finish, sent 3×**, on both the time (`type 9`) and date (`type 10`) channels.
    - **12-hour hack:** send `HH = (hour24 % 12) || 12` — the LCD shows the raw hour it's given (no AM/PM indicator, and it drifts, so re-sync ~every 60 s).
    - Date payload order is **`[YY, dayOfWeek(1–7), month, dayOfMonth]`**.

## 🕐 Time data packet (0x41, subcommand 0x03)

    41 00 00 03 [CKSUM] 00 00 HH MM SS   (rest zero-padded to 64)

| Byte | Field |
|---|---|
| `[3]` | `0x03` (subcommand: set time) |
| `[4]` | **CKSUM = `(0x41 + 0x03 + HH + MM + SS) & 0xFF`** (the low byte of the [§ data checksum](checksums.md)) |
| `[7]` | `HH` (hour) |
| `[8]` | `MM` (minute) |
| `[9]` | `SS` (second) |

Time announce: `40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1`.

## 🕐 Date data packet (0x41, subcommand 0x04)

    41 00 00 04 [CKSUM] 00 00 [YY] [DOW] [MM] [DD]

Payload order is **`[year(2-digit), dayOfWeek(1–7), month, dayOfMonth]`** (from the vendor `f`
handler: `M=[YY, day()||7, month()+1, date()]`). The sample `1a 03 07 01` decodes as year
`0x1A`=26 (2026), weekday 3, month 7, day 1, i.e. **2026-07-01**, matching capture time. (An
earlier `[DD][MM][YY]` guess was wrong.) Date announce: `A5 5A 10 00 04 …`, subcmd 0x04.

## 📦 Finish packet (0x42)

    42 00 00 38 7A   (rest zero-padded to 64)   — constant, commits the operation.

## 📖 Handler flow (from source)

```text
D = [165,90,9,0,3,195,225]    // time announce: A5 5A, type 9, subcmd 3, crc C3E1
T = [165,90,10,0,4,1,80]      // date announce: A5 5A, type 10, subcmd 4, crc 0150
P = [hour, minute, second]                    // time data payload
M = [YY, dayOfWeek(1-7), month, dayOfMonth]   // date data payload
for (3 times): announce(D) → data(P) → finish ;  announce(T) → data(M) → finish
```

---

## 🕐 The 12-hour clock hack

**Key insight:** the LCD firmware displays the raw hour value it's given. It doesn't force
24-hour internally, nor convert. So:

- Send **`HH = (hour24 % 12) || 12`** → the LCD shows a 12-hour clock.
    - 17 (5 PM) → send 5 → shows `05`
    - 12 (noon) → send 12 → shows `12` (verified clean)
    - 0 (midnight) → send 12 → shows `12`
    - 12:45 verified clean.
- Recompute `CKSUM` for the 12-hour hour value.

### Limitations

- **No AM/PM indicator** exists. `byte[10]=0x01` didn't produce an AM/PM dot (03:xx displayed
  identically). 3 AM and 3 PM both read `03`.
- The keyboard free-runs its own internal clock from the last value set, so it drifts and
  rolls forward (set `05`, an hour later it shows `06`). A **periodic re-sync (~60 s)** keeps it
  accurate. See [Tooling & the 12-hour clock](../how-to/tooling-and-clock.md).
- No firmware "time format" flag exists in the packets, only the raw-hour trick.

### Dead ends

- `byte[4]` is NOT a 12/24 flag; it's a checksum (initially misdiagnosed as flags).
- A lone `0x41` without the `0x40` announce + `0x42` finish did nothing visible.

## 🎨 Clock background color: there is no HID command for it

The clock homepage is firmware-drawn with a fixed background; the app only sets the time value.
Every "color / theme / background / dynamic color" option in the vendor app targets the RGB
backlight (per-key lighting), a different opcode family, out of scope for the LCD.
