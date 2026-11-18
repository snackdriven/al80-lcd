---
title: Protocol overview & HID framing
status: confirmed
type: explanation
scope: HID transport, the 0x40/0x41/0x42 packet roles, and the fully-framed announce header
---

# Protocol overview & HID framing

This page explains how the AL80 talks to its LCD: one HID interface, three packet roles, and one shared header.

!!! tip "TL;DR"

    - Each screen operation is a **three-packet sequence**: `0x40` announce → `0x41` data → `0x42` finish.
    - On the `0xFF60/0x61` interface, the screen commands are `0x40/0x41/0x42`. The vendor commands `0x55` and `0xB0` return a NAK. **Do not** probe `0xB1–0xB7`. They can brick the keyboard.
    - The device **ACKs each packet**: it echoes the packet with `byte[6] = 0x55`.

You control the AL80 LCD through one [HID](../reference/glossary.md) interface (`0xFF60`, usage
`0x61`, VID `0x28E9` / PID `0x30AF`). Every screen operation is a **three-packet sequence**:

    0x40 announce  →  0x41 data (one or many)  →  0x42 finish

Reports are 64 bytes, with report ID `0`. The keyboard's microcontroller (MCU) doesn't draw pixels
itself. It passes the report body to a separate smart display module over a serial link, USART3. That
module runs its own `PK_*` command set (see [Display commit (PK_*)](display-commit.md)).

!!! note "Two protocols, one interface"
    The same `0xFF60/0x61` interface also carries the **VIA** protocol, which usevia.app uses for keymap and lighting.
    VIA opcodes sit in the range `0x01–0x15`, and the LCD screen opcodes (`0x40/0x41/0x42`) sit above it.
    That's how one interface serves both protocols. It is also why only **one process** can hold the interface at a time.

## 📦 Screen-control command set

The command byte (`byte[0]`) values come from the vendor site's JS bundle:

| Byte | Name (from JS) | Meaning |
|---|---|---|
| `0x40` | sendScreenControlInformationPackage | "announce" header packet |
| `0x41` | sendScreenControlDataPacket | data payload (time OR image/GIF data) |
| `0x42` | finishScreenControlDataPacket | "finish" / commit packet |
| `0x55` | getDongleAndKeyboardStatus | status query (NAKs on the LCD interface) |
| `0xB0` | getFirmwareVersion | returns `0xFF` = NAK on the LCD interface |
| `0xB1..0xB7` | bootloader / firmware upgrade | [DFU](../reference/glossary.md) flow. **Do not use.** It is dangerous (see [Safety](../reference/safety.md)). |

**Command-sweep finding (read-only probe):** on the `0xFF60` LCD interface, the vendor commands `0x55`
and `0xB0` both returned `FF 00 00 …` (a [NAK](../reference/glossary.md)). Only `0x40/0x41/0x42` work
for the screen. The VIA opcodes `0x01–0x15` also work on this interface (see the note above). The sweep
didn't test any other opcodes. The status, version and config commands live on a different interface,
probably `0xFF31`.

**Do not** probe `0xB1–0xB7`. They can brick the keyboard.

## ✅ ACK behavior

The device echoes every packet back on the input report with **`byte[6] = 0x55`**. That echo is the
acknowledgment ([ACK](../reference/glossary.md)). Send `40 00 00 07 f6 02 00 …` and you get back
`40 00 00 07 f6 02 55 …`. The echo proved that writes were arriving even when the LCD showed no
change. Reliable picture uploads are ACK-gated: they wait for this echo before sending the next
block. See [Chunking & pacing](chunking-and-pacing.md).

## 📦 The 0x40 announce header, fully framed

Every operation starts with the same header layout. It's confirmed across 3,460 captured packets
(only `0x40/0x41/0x42` appear in them):

    40 00 00 07 [c4 c5] 00 A5 5A [type] [param] [subcmd] [crc16:2]

| Byte(s) | Field | Notes |
|---|---|---|
| `[0]` | `0x40` | announce |
| `[1,2]` | `00 00` | reserved |
| `[3]` | **payload length marker** = `(lastIndex − 7)` | `0x38` (56) for a full data packet; `0x07` for short announces. This is a length, not a version constant. |
| `[4,5]` | **additive checksum `yne`, little-endian** | `(Σ all packet bytes, with [4,5] held 0) & 0xFFFF`. The same rule applies to *every* packet. See [Checksums & CRC](checksums.md). |
| `[6]` | `0x00` | reserved |
| `[7,8]` | **`A5 5A`** | magic constant, in each announce |
| `[9]` | **type / channel** | `0x09`=time, `0x0A`=date, `0x0B`=home-view, `0x0D`=picture-view, `0x0E`=clear-picture, `0x0F`=GIF-view, `0x10`=image-upload, `0x12`=GIF-upload, `0x13`=GIF sub-op |
| `[10]` | **param** | usually 0 |
| `[11]` | **subcmd** | |
| `[12,13]` | **CRC16-MODBUS of `[9..11]`**, big-endian | see [Checksums & CRC](checksums.md) |

Example: the time announce (`byte[9]=0x09`):

    40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1   (rest zero-padded to 64)

!!! info "Type-byte mapping is source-confirmed"
    The vendor JS time handler sends `type 9 = time` and `type 10 = date`. An earlier claim
    ("type 9 is a generic data-write channel") was **wrong**. Confirmed: `0x09=time, 0x0A=date,
    0x0B=homepage, 0x0D=picture, 0x0F=GIF, 0x0E=clear-picture, 0x10=image, 0x12=GIF-upload,
    0x13=GIF sub-op`.

## 📖 Where to go next

- [Checksums & CRC](checksums.md): the `yne` additive checksum and CRC16-MODBUS. Both are fully decoded.
- [Time & Date sync](time-and-date.md): the clock protocol that works, and the 12-hour hack.
- [Still images](still-images.md) / [GIF / animation](gif-animation.md): the pixel upload formats.
- [Display commit (PK_*)](display-commit.md): how the module *shows* the data that you upload.
- [Full byte-map reference](full-reference.md): the source-decoded command map and byte-maps.
