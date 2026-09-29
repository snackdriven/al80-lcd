/* Read / write the AL80's dynamic keymap over raw HID (VIA protocol).
 *
 * Vial Web is a canvas app with no DOM, so it can't be automated. This talks the
 * same VIA dynamic-keymap commands its UI uses underneath.
 *
 *   node al80_keymap.js read <layer>
 *   node al80_keymap.js set <layer> <row> <col> <keycode-hex>
 *
 * e.g. node al80_keymap.js set 1 0 14 0x7E01     -> CUSTOM(1) = BT slot 1
 */
const HID = require('node-hid');

const VID = 0x28e9, PID = 0x30af, USAGE_PAGE = 0xff60;
const ROWS = 6, COLS = 15;

const ID_GET = 0x04; // id_dynamic_keymap_get_keycode
const ID_SET = 0x05; // id_dynamic_keymap_set_keycode

function open() {
  const all = HID.devices().filter(d => d.vendorId === VID && d.productId === PID);
  const m = all.find(d => d.usagePage === USAGE_PAGE);
  if (!m) throw new Error('0xFF60 interface not found -- is al80-studio or Vial holding it?');
  return new HID.HID(m.path);
}

/* VIA frames are 32 bytes of payload; node-hid wants a leading report-id byte. */
function xfer(dev, bytes) {
  const buf = Buffer.alloc(33, 0);
  bytes.forEach((b, i) => (buf[i + 1] = b));
  dev.write([...buf]);
  return Buffer.from(dev.readTimeout(1000));
}

function getKeycode(dev, layer, row, col) {
  const r = xfer(dev, [ID_GET, layer, row, col]);
  return (r[4] << 8) | r[5];
}

function setKeycode(dev, layer, row, col, kc) {
  xfer(dev, [ID_SET, layer, row, col, (kc >> 8) & 0xff, kc & 0xff]);
}

const [, , cmd, ...rest] = process.argv;
const dev = open();

try {
  if (cmd === 'read') {
    const layer = parseInt(rest[0] ?? '0', 10);
    console.log(`layer ${layer}:`);
    for (let r = 0; r < ROWS; r++) {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        cells.push('0x' + getKeycode(dev, layer, r, c).toString(16).padStart(4, '0'));
      }
      console.log(`  row ${r}: ${cells.join(' ')}`);
    }
  } else if (cmd === 'set') {
    const [layer, row, col, kcs] = rest;
    const kc = parseInt(kcs, 16);
    const before = getKeycode(dev, +layer, +row, +col);
    setKeycode(dev, +layer, +row, +col, kc);
    const after = getKeycode(dev, +layer, +row, +col);
    console.log(
      `layer ${layer} row ${row} col ${col}: 0x${before.toString(16).padStart(4, '0')}` +
      ` -> 0x${after.toString(16).padStart(4, '0')}` +
      (after === kc ? '  OK' : '  MISMATCH -- write rejected?')
    );
  } else {
    console.log('usage: read <layer> | set <layer> <row> <col> <keycode-hex>');
  }
} finally {
  dev.close();
}
