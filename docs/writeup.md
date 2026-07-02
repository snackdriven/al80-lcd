---
title: Reverse-engineering my keyboard's LCD (and catching AI three times)
date: 2026-07-01
tags: [reverse-engineering, HID, QA]
---

# Reverse-engineering my keyboard's LCD (and catching AI three times)

My keyboard has a tiny color screen on it. A YUNZII AL80, 112 by 137 pixels of LCD tucked
above the arrows. Out of the box you can only drive it through the vendor's web app, which
shows a 24-hour clock and lets you upload pictures. I wanted a 12-hour clock, and eventually
I wanted to put my own things on it. So I took the protocol apart.

This is the story of that, and of the part I didn't expect: how much of the work turned out
to be QA.

## The easy win

The screen talks raw HID. I sniffed the traffic the web app sends and found every screen
operation is the same three-packet handshake: an announce, a run of data packets, a finish.
The clock is just three little packets carrying the hour, minute, and second.

The 12-hour hack fell out immediately. The firmware displays whatever hour value it's handed.
It doesn't convert anything. Send it `5` instead of `17` and the screen reads 05. So the whole
"feature" is one line: `hour = (hour24 % 12) || 12`. A 60-second re-sync loop keeps it honest,
because the keyboard's own clock drifts. Shipped it as a Node script and moved on.

Then I wanted images, and images meant the checksums.

## The wall

Every packet carries two checksums, and nothing renders if they're wrong. The announce has a
two-byte field; each data packet has another. Cracking them was the real work.

The announce one turned out to be **CRC16-MODBUS** over three specific header bytes, stored
big-endian. Once I had the polynomial and the input range, it verified on every command I had.

The data-packet checksum was sneakier. Early notes called it a "running accumulator, seed 121,
plus 56 per packet," and on the captures I first looked at, that's exactly what it looked like.
It's not. It's a plain 16-bit additive checksum over the packet:
`(0x41 + offsetLo + offsetHi + length + sum of the pixels) & 0xFFFF`. The "121" was a
coincidence: on a black region the pixel sum is zero, so the checksum collapses to the header
bytes, which happen to add to 121 and step by 56 as the offset climbs. Real pixels blow that
pattern apart.

Display is 112 by 137, RGB565, big-endian, 30,688 bytes a frame, 548 packets. I confirmed the
resolution two independent ways: the byte count only factors into 112 by 137, and a red/green/
blue test image showed its color boundaries land exactly on the thirds of a 137-row image.

## The QA part I didn't expect

I used AI to help sort through the captures and write up findings as I went. It was fast and
mostly right. It was also confidently wrong three separate times, and each time the same thing
saved me: checking the claim against the actual bytes.

- It labeled the packet "type" bytes backwards — said 9 was images and 18 was time. My own
  working clock script sends type 9 to set the clock. Ten seconds of "wait, that contradicts
  the thing that already works" and it was obvious.
- It insisted on the "seed 121 accumulator." I wrote the additive-checksum formula, ran it
  against every data block in the captures, and got 4,288 out of 4,288 exact matches. That's
  what "confirmed" should mean. The accumulator theory got 2 out of 4,288.
- It carried a "16-byte final block" through the docs. But 548 times 56 is 30,688 exactly, so
  there's no short block at the end of a still image. The 16-byte block only shows up in the
  GIF path, where the frame is streamed in 1 KB banks. The capture said so plainly.

None of these were dramatic. That's the point. Plausible-and-wrong is the normal failure mode,
and the fix isn't cleverness, it's running the number. I've spent years doing that to other
people's software. It was funny to spend a weekend doing it to a robot helping me read a
keyboard.

## What it is now

I built a converter that turns any image into a valid transfer: fit it to 112 by 137, pack it
to big-endian RGB565, chunk it into 548 checksummed blocks, wrap it in the announce and finish.
The part I'm proudest of is that it's verifiable **without the hardware**. It emits the exact
packet stream to a file and checks every checksum with the same rules I pulled from the
captures, then diffs its block structure against a real recorded transfer. If the tool and the
capture disagree, that's a bug, and I catch it before anything touches the keyboard. Test the
thing offline, then trust it on the device. Same instinct as always.

The screen's a programmable panel now. Next it becomes a status light for whatever I'm testing
that day. But that's the next weekend.

---

*Protocol, tooling, and the full knowledge base live in the repo. The keyboard still runs its
stock lighting firmware — none of this required a reflash, which was the whole point.*
