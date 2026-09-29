/* Read the AL80's wireless diagnostic over raw HID (command 0x4C).
 *
 * Reports the USART1 peripheral's OWN registers, not our beliefs about them.
 * Expected values were read out of stock RIPPLE.bin by disassembly, so a
 * mismatch here is the bug rather than a guess.
 *
 *   node al80_wldebug.js
 */
const HID = require('node-hid');
const VID = 0x28e9, PID = 0x30af, USAGE_PAGE = 0xff60;

const m = HID.devices()
  .filter(d => d.vendorId === VID && d.productId === PID)
  .find(d => d.usagePage === USAGE_PAGE);
if (!m) { console.error('0xFF60 interface not found -- is al80-studio or Vial holding it?'); process.exit(1); }

const dev = new HID.HID(m.path);
try {
  const buf = Buffer.alloc(33, 0);
  buf[1] = 0x4c;
  dev.write([...buf]);
  const r = Buffer.from(dev.readTimeout(1000));

  const u16 = i => (r[i] << 8) | r[i + 1];
  const hex = (v, w = 4) => '0x' + v.toString(16).toUpperCase().padStart(w, '0');

  const MODES  = ['USB', 'BT1', 'BT2', 'BT3', '2.4G'];
  const STATES = { 0: 'UNINIT', 1: 'STOP', 2: 'READY', 3: 'READY' };

  const mode = r[1], connected = r[2];
  const tx = u16(3), rx = u16(5);
  const sdState = r[11];
  const brr = u16(12), cr1 = u16(14), cr2 = u16(16), cr3 = u16(18), sr = u16(20);
  const crh = (r[22] << 24 | r[23] << 16 | r[24] << 8 | r[25]) >>> 0;
  const pa9 = (crh >> 4) & 0xf;   // PA9 = nibble 1 of CRH
  const pa10 = (crh >> 8) & 0xf;  // PA10 = nibble 2

  console.log(`mode        : ${MODES[mode] ?? mode}`);
  console.log(`connected   : ${connected ? 'yes' : 'no'}`);
  console.log(`bytes TX    : ${tx}   (accepted by the driver)`);
  console.log(`bytes RX    : ${rx}`);
  console.log(`last RX     : ${[r[7], r[8], r[9], r[10]].map(b => hex(b, 2)).join(' ')}`);
  console.log('');

  /* Expected values read out of stock RIPPLE.bin. */
  const checks = [
    ['SD1.state', sdState, 3, v => v, 'driver READY'],
    ['USART1->BRR', brr, 0x004e, hex, '460800 @ PCLK2 36MHz'],
    ['USART1->CR1', cr1, 0x212c, hex, 'UE|PEIE|RXNEIE|TE|RE'],
    ['USART1->CR2', cr2, 0x0040, hex, '1 stop bit'],
    ['USART1->CR3', cr3, 0x0001, hex, 'EIE, no flow control'],
    ['GPIOA CRH.PA9', pa9, 0xb, v => hex(v, 1), 'AF push-pull 50MHz'],
  ];

  let bad = 0;
  for (const [name, got, want, fmt, note] of checks) {
    const ok = got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK  ' : 'BAD '} ${name.padEnd(14)} ${fmt(got)}  expected ${fmt(want)}   ${note}`);
  }
  console.log(`  --   ${'GPIOA CRH'.padEnd(14)} ${hex(crh, 8)}   (PA10 = ${hex(pa10, 1)}, want 0x4 floating in)`);
  console.log(`  --   ${'USART1->SR'.padEnd(14)} ${hex(sr)}   TXE=${(sr >> 7) & 1} TC=${(sr >> 6) & 1} RXNE=${(sr >> 5) & 1} ORE=${(sr >> 3) & 1} FE=${(sr >> 1) & 1}`);
  console.log('');

  if (bad)            console.log(`>> ${bad} register(s) wrong -- that IS the bug. Fix before looking downstream.`);
  else if (tx === 0)  console.log('>> Registers correct but nothing accepted. Driver refused the writes.');
  else if (rx === 0)  console.log('>> Registers correct, bytes accepted, module silent. Fault is downstream of the MCU: wiring or the module itself.');
  else                console.log('>> Two-way traffic. Protocol-level problem.');
} finally {
  dev.close();
}
