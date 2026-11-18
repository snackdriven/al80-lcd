---
title: Time & Date sync
status: confirmed
scope: The working clock/date protocol, packet byte-maps, and the 12-hour clock hack
---

# Time & Date sync

The clock protocol is confirmed, and it works. A full "update time" is an announce → data → finish
transaction. It is sent **3×**, for the time channel (`type 9`) and for the date channel (`type 10`).

!!! tip "TL;DR"

    - A full clock update is **announce → data → finish, sent 3×**, on the time (`type 9`) and date (`type 10`) channels.
    - **12-hour hack:** send `HH = (hour24 % 12) || 12`. The LCD shows the raw hour that it receives. (There is no AM/PM indicator. The clock drifts, so sync it again approximately every 60 s.)
    - The date payload order is **`[YY, dayOfWeek(1–7), month, dayOfMonth]`**.

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

The payload order is **`[year(2-digit), dayOfWeek(1–7), month, dayOfMonth]`** (from the vendor `f`
handler: `M=[YY, day()||7, month()+1, date()]`). The sample `1a 03 07 01` decodes as year
`0x1A`=26 (2026), weekday 3, month 7, day 1. This is **2026-07-01**, which agrees with the capture
time. (An earlier `[DD][MM][YY]` guess was wrong.) Date announce: `A5 5A 10 00 04 …`, subcmd 0x04.

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

**Key insight:** the LCD firmware displays the raw hour value that it receives. It does not force
24-hour mode internally, and it does not convert the value. Thus:

- Send **`HH = (hour24 % 12) || 12`** → the LCD shows a 12-hour clock.
    - 17 (5 PM) → send 5 → shows `05`
    - 12 (noon) → send 12 → shows `12` (verified clean)
    - 0 (midnight) → send 12 → shows `12`
    - 12:45 verified clean.
- Calculate `CKSUM` again for the 12-hour hour value.

### Limitations

- There is **no AM/PM indicator**. `byte[10]=0x01` did not make an AM/PM dot (03:xx showed
  identically). 3 AM and 3 PM both show `03`.
- The keyboard runs its own internal clock from the last value set. Thus the clock drifts and
  advances (set `05`, and one hour later it shows `06`). A **periodic re-sync (~60 s)** keeps it
  accurate. See [Tooling & the 12-hour clock](../how-to/tooling-and-clock.md).
- The packets have no firmware "time format" flag. Only the raw-hour trick is available.

### Dead ends

- `byte[4]` is NOT a 12/24 flag. It is a checksum (at first, it was misdiagnosed as flags).
- A lone `0x41` without the `0x40` announce + `0x42` finish had no visible effect.

## 🎨 Clock background color: there is no HID command for it

The firmware draws the clock homepage with a fixed background. The app sets only the time value.
Each "color / theme / background / dynamic color" option in the vendor app targets the RGB
backlight (per-key lighting). This is a different opcode family, out of scope for the LCD.
