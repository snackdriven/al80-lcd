#!/usr/bin/env node
/**
 * Offline test — NO hardware, and the pure-logic path needs neither sharp nor node-hid.
 * Builds a synthetic solid-red frame by hand and asserts the whole encode chain.
 *
 *   run:  node test/frame_encoder.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const enc = require('../al80-image.js');
const {
  WIDTH, HEIGHT, FRAME_BYTES, BLOCK, BLOCK_COUNT, ANNOUNCE, FINISH,
  packRGB565BE, buildPacketStream, streamToRecords, selfCheck, padTo64, padForSend, toHex,
} = enc;

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

console.log('al80-image offline test (no hardware, no sharp/node-hid needed)\n');

// ---- hand-made solid-red RGB888 buffer (255,0,0) ----
const px = WIDTH * HEIGHT;
const redRGB = Buffer.alloc(px * 3);
for (let i = 0; i < px; i++) { redRGB[3 * i] = 255; redRGB[3 * i + 1] = 0; redRGB[3 * i + 2] = 0; }

const frame = packRGB565BE(redRGB);

ok('frame is exactly 30,688 bytes', () => {
  assert.strictEqual(frame.length, FRAME_BYTES);
});

ok('red encodes to F8 00 big-endian (repeating)', () => {
  // first pixel
  assert.strictEqual(frame[0], 0xF8, `high byte ${frame[0].toString(16)} != f8`);
  assert.strictEqual(frame[1], 0x00, `low byte ${frame[1].toString(16)} != 00`);
  // every pixel across the whole frame
  for (let i = 0; i < px; i++) {
    assert.strictEqual(frame[2 * i], 0xF8);
    assert.strictEqual(frame[2 * i + 1], 0x00);
  }
});

const stream = buildPacketStream(frame);

ok('stream = announce + 548 blocks + finish', () => {
  assert.strictEqual(stream.length, 1 + BLOCK_COUNT + 1);
  assert.strictEqual(toHex(stream[0]), toHex(ANNOUNCE));
  assert.strictEqual(toHex(stream[stream.length - 1]), toHex(FINISH));
});

ok('self-check passes (548 blocks, offsets 0..30632 step 56, 30688 bytes)', () => {
  const s = selfCheck(frame, stream);
  assert.strictEqual(s.blocks, 548);
  assert.strictEqual(s.firstOffset, 0);
  assert.strictEqual(s.lastOffset, 30632);
  assert.strictEqual(s.step, 56);
  assert.strictEqual(s.totalBytes, FRAME_BYTES);
});

ok('every block: 63 logical bytes, len 56, checksum recomputes', () => {
  const blocks = stream.slice(1, -1);
  let expOff = 0;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    assert.strictEqual(b.length, 63, `block ${k} logical length`);
    assert.strictEqual(b[0], 0x41);
    assert.strictEqual(b[3], BLOCK);
    const off = b[1] | (b[2] << 8);
    assert.strictEqual(off, expOff);
    const payload = b.slice(7, 7 + BLOCK);
    let sum = 0; for (const p of payload) sum += p;
    const want = (0x41 + b[1] + b[2] + BLOCK + sum) & 0xFFFF;
    const got = b[4] | (b[5] << 8);
    assert.strictEqual(got, want, `block ${k} checksum`);
    expOff += BLOCK;
  }
});

ok('a red block payload is F8 00 repeating', () => {
  const b = stream[1]; // first data block
  const payload = b.slice(7, 7 + BLOCK);
  for (let i = 0; i < BLOCK; i += 2) {
    assert.strictEqual(payload[i], 0xF8);
    assert.strictEqual(payload[i + 1], 0x00);
  }
});

ok('padTo64 -> 64 bytes, no report id; padForSend -> 65 bytes, 0x00 report id', () => {
  const p64 = padTo64(stream[1]);
  assert.strictEqual(p64.length, 64);
  assert.strictEqual(p64[0], 0x41);
  const p65 = padForSend(stream[1]);
  assert.strictEqual(p65.length, 65);
  assert.strictEqual(p65[0], 0x00);
  assert.strictEqual(p65[1], 0x41);
});

// ---- emit JSON in capture schema and run the Python verifier on it ----
const tmp = path.join(os.tmpdir(), `al80_red_${process.pid}.json`);
const records = streamToRecords(stream);
fs.writeFileSync(tmp, JSON.stringify(records, null, 1));

ok('JSON records match capture schema (64-byte payloads)', () => {
  assert.strictEqual(records.length, stream.length);
  for (const r of records) {
    assert.strictEqual(r.hex.split(' ').length, 64);
  }
  assert.ok(records[0].hex.startsWith('40 00 00 08 cf'));
});

// al80_verify.py cross-check (skips gracefully if python is unavailable)
const script = path.join(__dirname, '..', 'al80_verify.py');
const py = process.platform === 'win32' ? 'python' : 'python3';
const r = spawnSync(py, [script, tmp], { encoding: 'utf8' });
if (r.error) {
  console.log('  skip - al80_verify.py (python not runnable: ' + r.error.message + ')');
} else {
  ok('al80_verify.py PASSes on the emitted JSON', () => {
    process.stdout.write(r.stdout.split('\n').map((l) => '      ' + l).join('\n'));
    assert.strictEqual(r.status, 0, 'al80_verify.py exited non-zero:\n' + r.stdout + r.stderr);
  });
}

try { fs.unlinkSync(tmp); } catch (_) {}

console.log(`\nAll ${passed} checks passed.`);
