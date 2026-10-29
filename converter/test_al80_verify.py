import json
import os
import tempfile
import pytest

from converter.al80_verify import crc16_modbus, verify

def test_crc16_modbus():
    # Empty data should return initial crc value 0xFFFF
    assert crc16_modbus([]) == 0xFFFF

    # Known test case from announce payload
    assert crc16_modbus([0x10, 0x00, 0x01]) == 0xC5B1

    # Another simple case
    # crc16_modbus([0x01])
    # initial: 0xFFFF
    # xor: 0xFFFF ^ 0x01 = 0xFFFE
    # ...
    assert crc16_modbus([0x01, 0x02, 0x03]) == 0x6161

def make_valid_recs():
    recs = []
    recs.append([0x40, 0, 0, 0x08, 0xCF, 0x02, 0, 0xA5, 0x5A, 0x10, 0, 0x01, 0xC5, 0xB1, 0x01])

    payload = [0] * 56
    for i in range(548):
        off = i * 56
        b1 = off & 0xFF
        b2 = (off >> 8) & 0xFF
        length = 56
        want = (0x41 + b1 + b2 + length + sum(payload)) & 0xFFFF
        b4 = want & 0xFF
        b5 = (want >> 8) & 0xFF
        block = [0x41, b1, b2, length, b4, b5, 0] + payload
        recs.append(block)

    recs.append([0x42, 0, 0, 0x38, 0x7A])
    return recs

def write_recs(path, recs):
    json_data = [{"hex": " ".join(f"{x:02x}" for x in r)} for r in recs]
    with open(path, "w") as f:
        json.dump(json_data, f)

def test_verify_valid():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        write_recs(path, recs)
        assert verify(path) is True
    finally:
        os.remove(path)

def test_verify_missing_announce(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs.pop(0)  # Remove announce
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "expected 1 announce (0x40), found 0" in captured.out
    finally:
        os.remove(path)

def test_verify_bad_announce_crc(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs[0][12] = 0x00  # corrupt CRC
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "announce CRC16 mismatch" in captured.out
    finally:
        os.remove(path)

def test_verify_missing_finish(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs.pop(-1)  # Remove finish
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "expected 1 finish (0x42), found 0" in captured.out
    finally:
        os.remove(path)

def test_verify_bad_data_checksum(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs[1][4] = (recs[1][4] + 1) & 0xFF  # corrupt checksum on first data block
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "block 0: checksum got" in captured.out
    finally:
        os.remove(path)

def test_verify_bad_data_length(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs[1][3] = 55  # corrupt length
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "block 0: len 55 != 56" in captured.out
    finally:
        os.remove(path)

def test_verify_bad_data_offset(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs[2][1] = 0x00  # corrupt offset
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "block 1: offset" in captured.out
    finally:
        os.remove(path)

def test_verify_total_bytes_mismatch(capsys):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        path = tmp.name
    try:
        recs = make_valid_recs()
        recs.pop(-2)  # Remove last data block
        write_recs(path, recs)
        assert verify(path) is False

        captured = capsys.readouterr()
        assert "expected 548 data blocks, found 547" in captured.out
        assert "total payload 30632 != 30688" in captured.out
    finally:
        os.remove(path)
