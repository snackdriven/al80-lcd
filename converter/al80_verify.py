#!/usr/bin/env python3
"""
al80_verify.py — self-contained offline verifier for a dry-run packet stream.

Reads a JSON file in the capture schema ([{"hex": "40 00 00 08 cf ..."}, ...], one
record per 64-byte HID payload, no report-id byte) and checks it the same way the
archived captures were verified. No hardware, no imports from research/.

Logic mirrored from research/analyze_captures.py:
  - announce CRC16-MODBUS over bytes[9..11], stored big-endian at bytes[12,13]
  - data-packet checksum bytes[4,5] LE = (0x41 + offLo + offHi + len + sum(payload)) & 0xFFFF

Also asserts the still-image frame structure this converter emits:
  - exactly one 0x40 image announce == the known-good constant
  - exactly one 0x42 finish == the known-good constant
  - 548 data blocks, all len 56, offsets 0..30632 step 56, total 30688 bytes

Usage:  python al80_verify.py <dry-run.json>
Exit:   0 = PASS, 1 = FAIL, 2 = usage/read error
"""
import json
import os
import sys

WIDTH, HEIGHT = 112, 137
FRAME_BYTES = 30688
BLOCK = 56
BLOCK_COUNT = FRAME_BYTES // BLOCK  # 548

ANNOUNCE = [0x40, 0, 0, 0x08, 0xCF, 0x02, 0, 0xA5, 0x5A, 0x10, 0, 0x01, 0xC5, 0xB1, 0x01]
FINISH = [0x42, 0, 0, 0x38, 0x7A]


def load(path):
    with open(path, encoding="utf-8") as f:
        recs = json.load(f)
    return [[int(x, 16) for x in r["hex"].split()] for r in recs]


def crc16_modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def verify(path):
    recs = load(path)
    errors = []
    ann = [r for r in recs if r[0] == 0x40]
    fin = [r for r in recs if r[0] == 0x42]
    data = [r for r in recs if r[0] == 0x41]

    # ---- announce: constant + CRC16-MODBUS(bytes[9..11]) big-endian at [12,13] ----
    if len(ann) != 1:
        errors.append(f"expected 1 announce (0x40), found {len(ann)}")
    for b in ann:
        if b[:15] != ANNOUNCE:
            errors.append("announce != known-good constant "
                          f"({' '.join(f'{x:02x}' for x in b[:15])})")
        crc = crc16_modbus(b[9:12])
        if ((crc >> 8) & 0xFF, crc & 0xFF) != (b[12], b[13]):
            errors.append(f"announce CRC16 mismatch: computed {crc:04X}, stored {b[12]:02X}{b[13]:02X}")

    # ---- finish: constant ----
    if len(fin) != 1:
        errors.append(f"expected 1 finish (0x42), found {len(fin)}")
    for b in fin:
        if b[:5] != FINISH:
            errors.append("finish != known-good constant "
                          f"({' '.join(f'{x:02x}' for x in b[:5])})")

    # ---- data blocks: count, len, offsets, checksum ----
    if len(data) != BLOCK_COUNT:
        errors.append(f"expected {BLOCK_COUNT} data blocks, found {len(data)}")

    exp_off = 0
    total = 0
    bad_cksum = 0
    for k, b in enumerate(data):
        length = b[3]
        off = b[1] | (b[2] << 8)
        if length != BLOCK:
            errors.append(f"block {k}: len {length} != {BLOCK}")
        if off != exp_off:
            errors.append(f"block {k}: offset {off} != {exp_off}")
        payload = b[7:7 + length]
        want = (0x41 + b[1] + b[2] + length + sum(payload)) & 0xFFFF
        got = b[4] | (b[5] << 8)
        if want != got:
            bad_cksum += 1
            if bad_cksum <= 5:
                errors.append(f"block {k}: checksum got {got:04X} want {want:04X}")
        total += len(payload)
        exp_off += BLOCK

    if total != FRAME_BYTES:
        errors.append(f"total payload {total} != {FRAME_BYTES}")

    last_off = (BLOCK_COUNT - 1) * BLOCK
    print(f"records={len(recs)} announce={len(ann)} data={len(data)} finish={len(fin)}")
    print(f"offsets 0..{last_off} step {BLOCK}, frame bytes {total}")
    print(f"checksums: {len(data) - bad_cksum}/{len(data)} match")

    if errors:
        print("\nFAIL:")
        for e in errors[:20]:
            print(f"  - {e}")
        if len(errors) > 20:
            print(f"  - (+{len(errors) - 20} more)")
        return False
    print("\nPASS: announce + finish constants OK, CRC16 OK, 548 blocks, all checksums OK.")
    return True


def main():
    if len(sys.argv) != 2:
        print("usage: python al80_verify.py <dry-run.json>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"error: no such file: {path}", file=sys.stderr)
        return 2
    try:
        ok = verify(path)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"error: could not parse {path}: {e}", file=sys.stderr)
        return 2
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
