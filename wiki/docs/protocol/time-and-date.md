---
title: Time & Date sync
status: confirmed
type: reference
scope: The working clock/date protocol, packet byte-maps, and the 12-hour clock hack
---

# Time & Date sync

Use this page to look up the clock and date packets, and the byte trick that gives a 12-hour clock.

!!! tip "TL;DR"

    - A full clock update is **announce → data → finish, sent 3×**, on the time (`type 9`) and date (`type 10`) channels.
    - **12-hour hack:** send `HH = (hour24 % 12) || 12`. The LCD shows the raw hour it receives. (There's no AM/PM indicator. The clock drifts, so sync it again about every 60 s.)
    - The date payload order is **`[YY, dayOfWeek(1–7), month, dayOfMonth]`**.

The clock protocol is confirmed and works. A full "update time" is an announce → data → finish
transaction, sent **3×**, on both the time channel (`type 9`) and the date channel (`type 10`).

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
handler: `M=[YY, day()||7, month()+1, date()]`).

The sample `1a 03 07 01` decodes as year `0x1A`=26 (2026), weekday 3, month 7, day 1. That's
**2026-07-01**, which matches the capture time. (An earlier `[DD][MM][YY]` guess was wrong.)

Date announce: `A5 5A 0A 00 04 01 50` (type `0x0A`, subcmd 0x04, CRC `0x0150`). The handler below
writes the type as decimal 10.

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

The LCD firmware shows the raw hour value it receives. It doesn't force 24-hour mode internally, and
it doesn't convert the value. So:

- Send **`HH = (hour24 % 12) || 12`** → the LCD shows a 12-hour clock.
    - 17 (5 PM) → send 5 → shows `05`
    - 12 (noon) → send 12 → shows `12` (verified clean)
    - 0 (midnight) → send 12 → shows `12`
    - 12:45 verified clean.
- Recalculate `CKSUM` for the 12-hour hour value.

### Limitations

- There's **no AM/PM indicator**. `byte[10]=0x01` didn't make an AM/PM dot (03:xx looked
  identical). 3 AM and 3 PM both show `03`.
- The keyboard runs its own internal clock from the last value set, so the clock keeps advancing and
  drifts (set `05`, and one hour later it shows `06`). A **periodic re-sync (~60 s)** keeps it
  accurate. See [Tooling & the 12-hour clock](../how-to/tooling-and-clock.md).
- The packets have no firmware "time format" flag. The raw-hour trick is the only option.

## 🎨 Clock background color: there is no HID command for it

The firmware draws the clock homepage with a fixed background, and the app sets only the time value.
Every "color / theme / background / dynamic color" option in the vendor app targets the RGB
backlight (per-key lighting). That's a different opcode family, out of scope for the LCD.

??? note "Dead ends"
    - `byte[4]` is **not** a 12/24 flag. It's a checksum (at first, it was misdiagnosed as flags).
    - A lone `0x41` without the `0x40` announce + `0x42` finish had no visible effect.
