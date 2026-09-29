/* Read the AL80's wireless diagnostic counters over raw HID (command 0x4C).
 *
 * The SmartBLE module is a black box. Without counters there is no way to tell
 * "the STM32 never transmitted" from "it transmitted and the module ignored it",
 * which are completely different bugs.
 *
 *   node al80_wldebug.js
 */
const HID = require('node-hid');
const VID = 0x28e9, PID = 0x30af, USAGE_PAGE = 0xff60;

const all = HID.devices().filter(d => d.vendorId === VID && d.productId === PID);
const m = all.find(d => d.usagePage === USAGE_PAGE);
if (!m) {
  console.error('0xFF60 interface not found -- is al80-studio or Vial holding it?');
  process.exit(1);
}

const dev = new HID.HID(m.path);
try {
  const buf = Buffer.alloc(33, 0);
  buf[1] = 0x4c;
  dev.write([...buf]);
  const r = Buffer.from(dev.readTimeout(1000));

  const MODES = ['USB', 'BT1', 'BT2', 'BT3', '2.4G'];
  const mode = r[1], connected = r[2];
  const tx = (r[3] << 8) | r[4];
  const rx = (r[5] << 8) | r[6];
  const last4 = [r[7], r[8], r[9], r[10]].map(b => '0x' + b.toString(16).padStart(2, '0'));

  console.log(`mode       : ${MODES[mode] ?? mode}`);
  console.log(`connected  : ${connected ? 'yes' : 'no'}`);
  console.log(`bytes TX   : ${tx}   (STM32 -> module)`);
  console.log(`bytes RX   : ${rx}   (module -> STM32)`);
  console.log(`last RX    : ${last4.join(' ')}`);
  console.log('');
  if (tx === 0)       console.log('>> Nothing ever transmitted. SD1 is not sending -- pin/clock/driver problem.');
  else if (rx === 0)  console.log('>> We transmit, module never answers. It is unpowered, deaf, or expects a different handshake.');
  else                console.log('>> Two-way traffic exists. Protocol-level problem, not wiring.');
} finally {
  dev.close();
}
