---
title: Checksums & CRC
status: confirmed
scope: The yne additive checksum (bytes[4,5]) and the CRC16-MODBUS announce CRC (bytes[12,13])
---

# Checksums & CRC

Two integrity fields, both cracked and verified in-repo. **One additive checksum rule covers every
packet** (announce and data alike); announces additionally carry a CRC16-MODBUS over the type
triple.

## Announce CRC16 (bytes[12,13]) = CRC16-MODBUS

- Parameters: poly `0x8005` (reflected `0xA001`), init `0xFFFF`, refin/refout = true, xorout = 0.
- Input: **`bytes[9..11]`** (the `[type][param][subcmd]` triple). Stored **big-endian** at
  `bytes[12,13]`.
- Verified on multiple announces:

| Triple | CRC16 | Bytes |
|---|---|---|
| time `[0x09,0,0x03]` | `0xC3E1` | 195, 225 |
| image `[0x10,0,0x01]` | `0xC5B1` | 197, 177 |
| GIF `[0x12,0,0x02]` | `0x0450` | 4, 80 |

Reference implementation (`ga` in the vendor source):

```js
ga = (bytes) => {              // input = [type, param, subcmd]
  let n = 0xFFFF;
  for (const b of bytes) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = (n & 1) ? ((n >> 1) ^ 0xA001) : (n >> 1);
  }
  return [n >> 8, n & 0xFF];   // big-endian → bytes[12,13]
}
```

## Data-packet checksum (0x41, bytes[4,5]) — the `yne` additive checksum

    bytes[4,5] (16-bit LITTLE-ENDIAN) = ( 0x41 + offLo + offHi + len + Σpayload ) & 0xFFFF

A **16-bit additive checksum over the whole 64-byte packet, excluding the checksum field itself**
(`bytes[4,5]`) and the zero pad. Verified against every image data block in the archived captures:
**1096/1096 still + 3192/3192 GIF = 4288/4288 exact matches** (`research/analyze_captures.py`).

!!! warning "Correction — the 'seed 121 / += 56 accumulator' model is wrong"
    That model only *looks* like a running counter on a zero/constant payload: for offset 0,
    len `0x38`, the header sum is `0x41 + 0 + 0 + 0x38 = 121`, so an all-zero payload gives
    121, 177, 233… On real pixel data the value is content-dependent (block 0 of the test
    pattern = `0x19B7`, not 121). The additive checksum above is the correct rule.

## One rule for every packet

The builder computes `bytes[4,5]` with `yne()` for **all** opcodes — announce and data:

    yne(o) = ( Σ o[i] ) & 0xFFFF, stored little-endian at o[4],o[5]   (o[4],o[5] held 0 while summing)

So the announce `bytes[4,5]` long treated as a "per-command constant" is the same checksum. The
homepage announce `[40,0,0,07,0,0,0,A5,5A,0B,0,0,02,00]` sums to **339 = 0x0153** → bytes `53 01`,
matching the capture. The old "per-command constants" (homepage 339, picture 566, GIF 601, time
758) were just `yne()` of each packet.

## Source: the one-function packet builder

The whole protocol was re-derived from `research/site_assets/index-8Bj3uPPc.js`. One function
builds every packet:

```js
Bn = (t, n, r = ["00","00"], i = 63) => {
  let o = [t, ...r, (i-7).toString(16), "00","00","00", ...n]; // opcode, off, len, pad, payload
  const c = yne(o);                                            // additive checksum
  o[4] = c[0]; o[5] = c[1];                                    // stored little-endian
  return o;
}
```

- `yne` — additive, little-endian, at `bytes[4,5]`: `sum(all bytes) & 0xFFFF`.
- `ga` — CRC16-MODBUS (init `0xFFFF`, poly `0xA001`, big-endian) over `[type,param,subcmd]`, at
  `bytes[12,13]` of announces.

The time-data one-byte form is just the low byte of this rule:
`CKSUM = (0x41 + 0x03 + HH + MM + SS) & 0xFF` (see [Time & Date sync](time-and-date.md)).
