// Pure-JS mirror of the AL80 custom-firmware wire builders (firmware/al80-keyboard-src/al80.c).
// Device-free. This is the "announce builder extracted as a pure fn" the view-switch SPARC C2 asks
// for, plus the hotkey 0x4B panel-request buffer and the per-key 0x49 stream handler semantics.
// Each function transcribes the exact C so the test can assert the on-wire bytes without a board.

export const RAW_EPSIZE = 64;
export const RGB_MATRIX_LED_COUNT = 82;

// --- al80_crc16(d, n): CRC16-MODBUS, init 0xFFFF, poly 0xA001 (al80.c) ---------------------------
export function al80Crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc & 0xffff;
}

// --- al80_screen_send_view(type): the 7-byte PK_GO view announce over USART3 --------------------
// C: hdr={type,0x00,0x00}; crc=al80_crc16(hdr,3); pkt={0xA5,0x5A,type,0x00,0x00,crc>>8,crc}.
export function al80ScreenSendView(type) {
  const crc = al80Crc16([type, 0x00, 0x00]);
  return Uint8Array.from([0xa5, 0x5a, type & 0xff, 0x00, 0x00, (crc >> 8) & 0xff, crc & 0xff]);
}

// --- al80_panel_req(id): unsolicited keyboard->host raw-HID report [0x4B, id, 0...] --------------
export const AP_PANEL_REQ = 0x4b;
export function al80PanelReq(id) {
  const buf = new Uint8Array(RAW_EPSIZE); // zero-filled, like the C `buf[RAW_EPSIZE]={0}`
  buf[0] = AP_PANEL_REQ;
  buf[1] = id & 0xff;
  return buf;
}

// --- raw_hid_receive_kb AP_LIVE_LEDS (0x49) handler semantics ------------------------------------
// C: off=data[1]; cnt=data[2]; if (off+cnt <= RGB_MATRIX_LED_COUNT) { memcpy(&g_live_rgb[off*3],
//    &data[3], cnt*3); ack=0x55 } else ack=0x0F. Applies to the shared g_live_rgb[82*3] buffer.
export const AP_LIVE_LEDS = 0x49;
export const ACK_OK = 0x55;
export const ACK_RANGE = 0x0f;

export const RAW_EPSIZE = 64; // fixed HID report size — the C `length` is always this for 0x49

/** Apply one 0x49 report `data` (Uint8Array/[]) into `buf` (Uint8Array length 246). Returns ack.
 * `length` mirrors the C handler's report length: cnt is bounded by BOTH the destination (off+cnt<=82)
 * and the source ((length-3)/3 == 20), so a cnt>20 can't read past the 64-byte report. */
export function applyLiveChunk(buf, data, length = RAW_EPSIZE) {
  const off = data[1] & 0xff;
  const cnt = data[2] & 0xff;
  if (off + cnt <= RGB_MATRIX_LED_COUNT && cnt <= (length - 3) / 3) {
    for (let i = 0; i < cnt * 3; i++) buf[off * 3 + i] = data[3 + i] & 0xff;
    return ACK_OK;
  }
  return ACK_RANGE;
}

/** Build the canonical wire chunking for a full 82-LED frame: <=20 LEDs/chunk (RAW_EPSIZE cap),
 *  offsets 0/20/40/60/80, counts 20/20/20/20/2. Mirrors what the host per-key streamer must send
 *  for the firmware handler above to cover the whole board. rgb = 246-length source field. */
export function liveFrameChunks(rgb) {
  const MAX = Math.floor((RAW_EPSIZE - 3) / 3); // 20 LEDs/chunk
  const chunks = [];
  for (let off = 0; off < RGB_MATRIX_LED_COUNT; off += MAX) {
    const cnt = Math.min(MAX, RGB_MATRIX_LED_COUNT - off);
    const rep = [AP_LIVE_LEDS, off, cnt];
    for (let i = 0; i < cnt * 3; i++) rep.push(rgb[off * 3 + i] & 0xff);
    chunks.push(rep);
  }
  return chunks;
}
