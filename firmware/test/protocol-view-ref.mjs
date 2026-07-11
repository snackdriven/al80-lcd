// Vendored reference — the VIEW-switch slice of al80-studio's src/protocol.js, copied VERBATIM
// so the firmware wire-bytes test is self-contained (al80-lcd has no dependency on the al80-studio
// checkout). These are the exact functions that build the host-relayed PK_GO view announce; the
// firmware's al80_screen_send_view must emit the same 7 payload bytes (bytes 7..14 of buildView()[0]).
//
// Provenance: al80-studio/src/protocol.js — ga (:33), yne (:25), build (:58), announce (:70),
//   finish (:77), VIEW (:207), buildView (:210). REPORT = 64.
// A drift guard in firmware-wire.test.mjs re-checks these against the live protocol.js when the
// al80-studio checkout is resolvable, so a future protocol change can't silently desync this copy.

const REPORT = 64;

/** 16-bit additive checksum, little-endian [low, high]. (yne) */
export function yne(bytes) {
  let n = 0;
  for (const b of bytes) n += b;
  n &= 0xffff;
  return [n & 0xff, (n >> 8) & 0xff];
}

/** CRC16-MODBUS (init 0xFFFF, poly 0xA001), big-endian [high, low]. (ga) */
export function ga(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return [(crc >> 8) & 0xff, crc & 0xff];
}

function padTo64(pkt) {
  const out = new Uint8Array(REPORT);
  out.set(pkt.slice(0, REPORT));
  return out;
}

export function build(op, payload = [], offset = [0, 0], reqLen = 63) {
  if (![0x40, 0x41, 0x42, 0x55].includes(op)) {
    throw new Error(`protocol.build: refusing opcode 0x${op.toString(16)} (whitelist 40/41/42/55)`);
  }
  const pkt = [op, offset[0] & 0xff, offset[1] & 0xff, (reqLen - 7) & 0xff, 0, 0, 0, ...payload];
  const c = yne(pkt);
  pkt[4] = c[0];
  pkt[5] = c[1];
  return padTo64(pkt);
}

/** 0x40 announce: A5 5A type flag subcmd crcHi crcLo ...extra. */
export function announce(type, flag, subcmd, extra = []) {
  const crc = ga([type, flag, subcmd]);
  const payload = [0xa5, 0x5a, type, flag, subcmd, crc[0], crc[1], ...extra];
  return build(0x40, payload, [0, 0], 7 + payload.length);
}

/** 0x42 finish. */
export function finish() {
  return build(0x42, [], [0, 0], 63);
}

export const VIEW = { HOMEPAGE: 0x0b, PICTURE: 0x0d, GIF: 0x0f };

/** Switch the LCD view. type = VIEW.HOMEPAGE / PICTURE / GIF. */
export function buildView(type) {
  return [announce(type, 0, 0), finish()];
}
