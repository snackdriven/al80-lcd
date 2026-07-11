// Device-free wire-bytes unit test for the consolidated AL80 firmware keycode build.
// Proves the on-USART3 view announce the firmware emits is byte-identical to what the host relays
// (al80-studio protocol.js buildView), the keyboard->host 0x4B panel signal is well-formed, and the
// per-key 0x49 stream handler frames/bounds-checks the 82-LED field correctly. No hardware, no HID.
//
//   run:  node --test firmware/test/
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  al80Crc16, al80ScreenSendView, al80PanelReq,
  applyLiveChunk, liveFrameChunks,
  RAW_EPSIZE, RGB_MATRIX_LED_COUNT, AP_PANEL_REQ, AP_LIVE_LEDS, ACK_OK, ACK_RANGE,
} from './firmware-wire.mjs';
import * as ref from './protocol-view-ref.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

// SPARC A4 ground-truth wire table (al80-firmware-view-switch-keycodes-SPARC.md).
// type -> { crc, bytes } where bytes is the full 7-byte USART3 announce.
const A4 = {
  HOME:    { type: 0x0b, crc: 0x0200, bytes: [0xa5, 0x5a, 0x0b, 0x00, 0x00, 0x02, 0x00] },
  PICTURE: { type: 0x0d, crc: 0x03e0, bytes: [0xa5, 0x5a, 0x0d, 0x00, 0x00, 0x03, 0xe0] },
  GIF:     { type: 0x0f, crc: 0xc341, bytes: [0xa5, 0x5a, 0x0f, 0x00, 0x00, 0xc3, 0x41] },
};

test('firmware al80_crc16 == protocol.js ga (CRC16-MODBUS parity)', () => {
  const cases = [[0x0b, 0, 0], [0x0d, 0, 0], [0x0f, 0, 0], [0x01, 0, 1], [0xa5, 0x5a, 0x0b], [0xde, 0xad, 0xbe]];
  for (const c of cases) {
    const fw = al80Crc16(c); // 16-bit int
    const [hi, lo] = ref.ga(c); // big-endian pair
    assert.equal(fw, (hi << 8) | lo, `CRC mismatch for [${c.map((n) => n.toString(16))}]`);
  }
});

test('view announce CRC matches the SPARC A4 constants', () => {
  for (const [name, { type, crc }] of Object.entries(A4)) {
    assert.equal(al80Crc16([type, 0, 0]), crc, `${name} CRC != 0x${crc.toString(16)}`);
  }
});

test('al80_screen_send_view bytes == SPARC A4 wire table', () => {
  for (const [name, { type, bytes }] of Object.entries(A4)) {
    assert.equal(hex(al80ScreenSendView(type)), hex(Uint8Array.from(bytes)), `${name} bytes off`);
  }
});

test('al80_screen_send_view bytes == protocol.js buildView(type) payload (bytes 7..14)', () => {
  for (const { type } of Object.values(A4)) {
    const announceReport = ref.buildView(type)[0];       // 64-byte 0x40 announce report
    const payload = announceReport.slice(7, 14);          // the 7 bytes forwarded to USART3
    assert.equal(hex(al80ScreenSendView(type)), hex(payload), `view 0x${type.toString(16)} payload`);
  }
  // finish() (the 0x42) writes nothing to USART3 — the firmware manages g_screen_busy itself, so
  // only buildView()[0]'s payload crosses the wire. Sanity: buildView returns exactly [announce, finish].
  assert.equal(ref.buildView(0x0b).length, 2);
});

// Drift guard: if the live al80-studio protocol.js is reachable, prove the vendored ref hasn't
// desynced from it. Not a hard failure when absent (the vendored copy + A4 table are ground truth),
// but green here means real end-to-end parity against the shipping host code.
test('vendored protocol ref matches live al80-studio protocol.js (when reachable)', async (t) => {
  const candidates = [
    process.env.AL80_STUDIO_PROTOCOL,
    resolve(here, '../../../al80-studio/src/protocol.js'),
    resolve(here, '../../al80-studio/src/protocol.js'),
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    t.skip('al80-studio/src/protocol.js not resolvable from this checkout — vendored ref stands in');
    return;
  }
  const live = await import(pathToFileURL(found).href); // absolute + Windows/UNC-safe (was: 'file://'+path, threw on Windows)
  for (const { type } of Object.values(A4)) {
    assert.equal(hex(ref.buildView(type)[0]), hex(live.buildView(type)[0]), `buildView drift 0x${type.toString(16)}`);
  }
  assert.deepEqual(ref.ga([0x0b, 0, 0]), live.ga([0x0b, 0, 0]), 'ga drift');
  assert.deepEqual(ref.VIEW, live.VIEW, 'VIEW map drift');
});

test('al80_panel_req builds [0x4B, id] in a zero-filled 64-byte report (hotkey 0x4B signal)', () => {
  for (const id of [0x00, 0x01, 0x02, 0xf0, 0xf1]) {
    const buf = al80PanelReq(id);
    assert.equal(buf.length, RAW_EPSIZE);
    assert.equal(buf[0], AP_PANEL_REQ);
    assert.equal(buf[1], id);
    for (let i = 2; i < RAW_EPSIZE; i++) assert.equal(buf[i], 0, `byte ${i} not zero`);
  }
});

test('0x49 handler: canonical 82-LED frame covers every LED once, ACK 0x55', () => {
  // build a distinct value per byte so miscopies show up
  const src = new Uint8Array(RGB_MATRIX_LED_COUNT * 3);
  for (let i = 0; i < src.length; i++) src[i] = (i * 7 + 3) & 0xff;

  const chunks = liveFrameChunks(src);
  assert.equal(chunks.length, 5, 'expected 5 reports for 82 LEDs');
  assert.deepEqual(chunks.map((c) => c[1]), [0, 20, 40, 60, 80], 'offsets');
  assert.deepEqual(chunks.map((c) => c[2]), [20, 20, 20, 20, 2], 'counts');
  for (const c of chunks) assert.ok(c.length <= RAW_EPSIZE, `report length ${c.length} > 64`);

  const buf = new Uint8Array(RGB_MATRIX_LED_COUNT * 3);
  for (const c of chunks) assert.equal(applyLiveChunk(buf, c), ACK_OK, 'chunk not ACKed');
  assert.deepEqual([...buf], [...src], 'reassembled buffer != source (coverage/order bug)');
});

test('0x49 handler: opcode 0x49 and count cap = 20 (RAW_EPSIZE framing)', () => {
  assert.equal(AP_LIVE_LEDS, 0x49);
  assert.equal(liveFrameChunks(new Uint8Array(RGB_MATRIX_LED_COUNT * 3))[0][2], 20);
  assert.equal(Math.floor((RAW_EPSIZE - 3) / 3), 20);
});

test('0x49 handler: out-of-range chunk rejected (0x0F), buffer untouched', () => {
  const buf = new Uint8Array(RGB_MATRIX_LED_COUNT * 3).fill(0x11);
  const before = [...buf];
  // offset 80, count 3 -> 83 > 82: must reject and not write
  const bad = [AP_LIVE_LEDS, 80, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(applyLiveChunk(buf, bad), ACK_RANGE);
  assert.deepEqual([...buf], before, 'buffer mutated on out-of-range chunk');
  // exact-fit boundary: offset 80, count 2 -> 82 == 82: accepted
  assert.equal(applyLiveChunk(buf, [AP_LIVE_LEDS, 80, 2, 9, 9, 9, 9, 9, 9]), ACK_OK);
});
