---
title: Protocol overview & HID framing
status: confirmed
scope: HID transport, the 0x40/0x41/0x42 packet roles, and the fully-framed announce header
---

# Protocol overview & HID framing

The AL80 LCD is driven over one HID interface (`0xFF60`, usage `0x61`, VID `0x28E9` / PID
`0x30AF`). Every screen operation is a **three-packet sequence**:

    0x40 announce  →  0x41 data (one or many)  →  0x42 finish

64-byte reports, report ID `0`. The keyboard MCU doesn't render pixels; it forwards the
report body to a separate smart display module over USART3, which runs its own `PK_*` command set
(see [Display commit (PK_*)](display-commit.md)).

!!! tip "TL;DR"

    - Every screen operation is a **three-packet sequence**: `0x40` announce → `0x41` data → `0x42` finish.
    - The `0xFF60/0x61` interface **only accepts `0x40/0x41/0x42`** and NAKs everything else — never probe `0xB1–0xB7` (brick risk).
    - The device **ACKs each packet** by echoing it back with `byte[6] = 0x55`.

!!! note "Two protocols, one interface"
    The same `0xFF60/0x61` interface also speaks **VIA** (usevia.app uses it for keymap/lighting).
    VIA opcodes live in `0x01–0x15`; the LCD screen opcodes (`0x40/0x41/0x42`) sit above them.
    That's why one interface serves both, and why only **one process** can hold it at a time.

## 📦 Screen-control command set

Command byte (`byte[0]`), pulled from the vendor site's JS bundle:

| Byte | Name (from JS) | Meaning |
|---|---|---|
| `0x40` | sendScreenControlInformationPackage | "announce" header packet |
| `0x41` | sendScreenControlDataPacket | data payload (time OR image/GIF data) |
| `0x42` | finishScreenControlDataPacket | "finish" / commit packet |
| `0x55` | getDongleAndKeyboardStatus | status query (NAKs on the LCD iface) |
| `0xB0` | getFirmwareVersion | returns `0xFF` = NAK on the LCD iface |
| `0xB1..0xB7` | bootloader / firmware upgrade | DFU flow — **dangerous, avoid** (see [Safety](../reference/safety.md)) |

**Command-sweep finding (read-only probe):** the `0xFF60` LCD interface only accepts
`0x40/0x41/0x42` and NAKs everything else (`0x55` and `0xB0` both returned `FF 00 00 …`).
Status / version / config live on a different interface (likely `0xFF31`). Do **not** probe
`0xB1–0xB7`: brick risk.

## ✅ ACK behavior

The device echoes each packet back on the input report with **`byte[6] = 0x55`** to
acknowledge. Send `40 00 00 07 f6 02 00 …` → receive `40 00 00 07 f6 02 55 …`. That's how writes
were confirmed as landing even when the LCD showed no visible change. Reliable picture uploads
ACK-gate on this echo. See [Chunking & pacing](chunking-and-pacing.md).

## 📦 The 0x40 announce header, fully framed

Every operation opens with the same header layout. Confirmed across 3,460 captured packets (only
`0x40/0x41/0x42` ever appear):

    40 00 00 07 [c4 c5] 00 A5 5A [type] [param] [subcmd] [crc16:2]

| Byte(s) | Field | Notes |
|---|---|---|
| `[0]` | `0x40` | announce |
| `[1,2]` | `00 00` | reserved |
| `[3]` | **payload length marker** = `(lastIndex − 7)` | `0x38` (56) for a full data packet; `0x07` for short announces. A length, not a version constant. |
| `[4,5]` | **additive checksum `yne`, little-endian** | `(Σ all packet bytes, with [4,5] held 0) & 0xFFFF`. Same rule for *every* packet — see [Checksums & CRC](checksums.md). |
| `[6]` | `0x00` | reserved |
| `[7,8]` | **`A5 5A`** | magic constant, in every announce |
| `[9]` | **type / channel** | `0x09`=time, `0x0A`=date, `0x0B`=home-view, `0x0D`=picture-view, `0x0E`=clear-picture, `0x0F`=GIF-view, `0x10`=image-upload, `0x12`=GIF-upload, `0x13`=GIF sub-op |
| `[10]` | **param** | usually 0 |
| `[11]` | **subcmd** | |
| `[12,13]` | **CRC16-MODBUS of `[9..11]`**, big-endian | see [Checksums & CRC](checksums.md) |

Example, the time announce (`byte[9]=0x09`):

    40 00 00 07 F6 02 00 A5 5A 09 00 03 C3 E1   (rest zero-padded to 64)

!!! info "Type-byte mapping is source-confirmed"
    The vendor JS time handler sends `type 9 = time`, `type 10 = date`. An earlier "type 9 is a
    generic data-write channel" claim was **wrong**. Confirmed: `0x09=time, 0x0A=date,
    0x0B=homepage, 0x0D=picture, 0x0F=GIF, 0x0E=clear-picture, 0x10=image, 0x12=GIF-upload,
    0x13=GIF sub-op`.

## 📖 Where to go next

- [Checksums & CRC](checksums.md): the `yne` additive checksum and CRC16-MODBUS, both cracked.
- [Time & Date sync](time-and-date.md): the working clock protocol and the 12-hour hack.
- [Still images](still-images.md) / [GIF / animation](gif-animation.md): pixel upload formats.
- [Display commit (PK_*)](display-commit.md): how the module actually *shows* what you upload.
- [Full byte-map reference](full-reference.md): the source-decoded command map and byte-maps.
