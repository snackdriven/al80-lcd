/* Keep the AL80's custom keycode bindings in place.
 *
 * Flashing wipes the dynamic keymap whenever QMK decides the EEPROM version
 * changed, which a new build often triggers. That has already cost two
 * debugging rounds: the keycode silently isn't there, you press it, nothing
 * happens, and it looks like a firmware bug.
 *
 * Reads before writing and only writes what's actually wrong -- the dynamic
 * keymap lives in emulated flash, so pointless rewrites are real wear.
 *
 *   node al80_bindings.js          check only, exit 1 if anything is missing
 *   node al80_bindings.js --apply  restore whatever is missing
 */
const HID = require('node-hid');

const VID = 0x28e9, PID = 0x30af, USAGE_PAGE = 0xff60;
const ID_GET = 0x04, ID_SET = 0x05;

/* layer, row, col, keycode, human label.
 * Layer 1 row 2 is the QWERTY row: c1=Q c2=W c3=E c4=R c5=T. */
const BINDINGS = [
  [1, 2, 1, 0x7e01, 'Fn+Q  BT1'],
  [1, 2, 2, 0x7e02, 'Fn+W  BT2'],
  [1, 2, 3, 0x7e03, 'Fn+E  BT3'],
  [1, 2, 4, 0x7e04, 'Fn+R  2.4G'],
  [1, 2, 5, 0x7e1e, 'Fn+T  USB'],
];

const APPLY = process.argv.includes('--apply');

/* The interface is exclusive, and a scheduled task (AL80BindingsRestore, every
 * 10 min) or al80-studio can hold it for a moment. Losing that race is normal,
 * not an error worth a stack trace -- so retry briefly, then explain. */
function openWithRetry(tries = 12, delayMs = 250) {
  for (let i = 0; i < tries; i++) {
    const m = HID.devices()
      .filter(d => d.vendorId === VID && d.productId === PID)
      .find(d => d.usagePage === USAGE_PAGE);
    if (m) {
      try { return new HID.HID(m.path); } catch (e) { /* busy, retry */ }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }
  console.error('');
  console.error("Could not get the keyboard 0xFF60 interface after several tries.");
  console.error('Usual causes:');
  console.error('  - al80-studio or Vial is open in a browser tab (close it)');
  console.error('  - the keyboard is in wireless mode, so raw HID is not routed over USB');
  console.error('  - the keyboard is unplugged or in DFU');
  process.exit(1);
}

function xfer(dev, bytes) {
  const buf = Buffer.alloc(33, 0);
  bytes.forEach((b, i) => (buf[i + 1] = b));
  dev.write([...buf]);
  return Buffer.from(dev.readTimeout(1000));
}

const get = (dev, l, r, c) => {
  const x = xfer(dev, [ID_GET, l, r, c]);
  return (x[4] << 8) | x[5];
};
const set = (dev, l, r, c, kc) => xfer(dev, [ID_SET, l, r, c, (kc >> 8) & 0xff, kc & 0xff]);

const dev = openWithRetry();
let missing = 0, fixed = 0;

try {
  for (const [l, r, c, kc, label] of BINDINGS) {
    const cur = get(dev, l, r, c);
    if (cur === kc) {
      console.log(`  ok      ${label}`);
      continue;
    }
    missing++;
    const curHex = '0x' + cur.toString(16).padStart(4, '0');
    if (APPLY) {
      set(dev, l, r, c, kc);
      const now = get(dev, l, r, c);
      if (now === kc) { fixed++; console.log(`  FIXED   ${label}  (was ${curHex})`); }
      else            { console.log(`  FAILED  ${label}  (still 0x${now.toString(16).padStart(4,'0')})`); }
    } else {
      console.log(`  MISSING ${label}  (is ${curHex})`);
    }
  }
} finally {
  dev.close();
}

console.log('');
if (missing === 0)      console.log('All bindings present.');
else if (APPLY)         console.log(`Restored ${fixed}/${missing}.`);
else                  { console.log(`${missing} missing. Re-run with --apply.`); process.exit(1); }
