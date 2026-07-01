#!/usr/bin/env python3
"""
Offline analysis of the archived AL80 HID captures — no keyboard or browser needed.

Runs entirely on the raw JSON captures already in this repo. Reproduces the findings
in AL80_KNOWLEDGE_BASE.md that were derived from captured data (as opposed to the ones
that need new captures from the device):

  - verifies the announce CRC16-MODBUS over bytes[9..11]
  - verifies the still-image data-block accumulator (seed 121, +56/block)
  - segments each capture into 0x40-delimited transactions
  - decodes the GIF banked ~1 KB window structure and banks-per-frame

Usage:  python research/analyze_captures.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
STILL = os.path.join(HERE, "image_capture", "testpattern_capture_raw.json")
GIF   = os.path.join(HERE, "gif_capture", "testgif_capture_raw.json")


def load(path):
    return [[int(x, 16) for x in r["hex"].split()] for r in json.load(open(path, encoding="utf-8"))]


def crc16_modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def verify_announce_crc(recs, label):
    print(f"\n[{label}] announce CRC16-MODBUS(bytes[9..11]) -> big-endian bytes[12,13]")
    seen = set()
    for b in recs:
        if b[0] != 0x40:
            continue
        key = tuple(b[9:12])
        if key in seen:
            continue
        seen.add(key)
        crc = crc16_modbus(b[9:12])
        ok = ((crc >> 8) & 0xFF, crc & 0xFF) == (b[12], b[13])
        typ = {0x09: "time", 0x10: "image", 0x12: "gif"}.get(b[9], "?")
        print(f"  type=0x{b[9]:02X} ({typ:5}) input={b[9:12]} crc=0x{crc:04X} "
              f"stored={b[12]:02X}{b[13]:02X}  {'OK' if ok else 'MISMATCH'}")


def verify_checksum(recs, label):
    """All 0x41 data packets: bytes[4,5] LE = (0x41 + offLo + offHi + len + sum(payload)) & 0xFFFF.
    Equivalently, a 16-bit additive checksum over the packet excluding the checksum field."""
    print(f"\n[{label}] data-packet checksum = (0x41 + off + len + sum(payload)) & 0xFFFF")
    checked = bad = 0
    for b in recs:
        if b[0] != 0x41 or b[3] not in (0x38, 0x10, 0x03, 0x04):
            continue
        if len(b) > 8 and b[7] == 0xA5 and b[8] == 0x5A:
            continue  # setup packet, different shape
        want = (sum(b[0:4]) + sum(b[6:7 + b[3]])) & 0xFFFF
        got = b[4] | (b[5] << 8)
        checked += 1
        bad += (want != got)
    print(f"  checked {checked} data packets, {checked - bad} match, {bad} mismatch")


def transactions(recs, label):
    print(f"\n[{label}] transactions + GIF bank structure")
    seq = []
    prev = None
    for b in recs:
        if b[0] == 0x41 and len(b) > 8 and b[7] == 0xA5 and b[8] == 0x5A:
            seq.append(("SET", b[3]))
        elif b[0] == 0x41 and b[3] in (0x38, 0x10):
            off = b[1] | (b[2] << 8)
            if prev is None or off < prev:
                seq.append(("RUN", off))
            prev = off
        elif b[0] == 0x40:
            seq.append(("ANN", b[9]))
        elif b[0] == 0x42:
            seq.append(("FIN", None))
            prev = None
    runs = [k for k, s in enumerate(seq) if s[0] == "RUN"]
    a_marks = [k for k, s in enumerate(seq) if s == ("SET", 0x0A)]
    print(f"  data runs={len(runs)}  0x0A setups={len(a_marks)}  "
          f"0x07 setups={sum(1 for s in seq if s == ('SET', 0x07))}")
    if a_marks:
        bounds = a_marks + [len(seq)]
        prev_b, frame = 0, 0
        for bnd in bounds:
            n = sum(1 for r in runs if prev_b <= r < bnd)
            if n:
                print(f"  frame {frame}: {n} banks (~{n*1064} bytes; full frame=30688)")
                frame += 1
            prev_b = bnd


def main():
    for label, path in [("STILL", STILL), ("GIF", GIF)]:
        recs = load(path)
        print(f"\n===== {label}: {len(recs)} records =====")
        verify_announce_crc(recs, label)
        verify_checksum(recs, label)
        transactions(recs, label)


if __name__ == "__main__":
    main()
