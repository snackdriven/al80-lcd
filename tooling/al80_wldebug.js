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

const dev = openWithRetry();
try {
  const buf = Buffer.alloc(33, 0);
  buf[1] = 0x4c;
  dev.write([...buf]);
  const r = Buffer.from(dev.readTimeout(1000));

  const u16 = i => (r[i] << 8) | r[i + 1];
  const hex = (v, w = 4) => '0x' + v.toString(16).toUpperCase().padStart(w, '0');

  const MODES  = ['USB', 'BT1', 'BT2', 'BT3', '2.4G'];

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
    ['SD1.state', sdState, 2, v => v, 'SD_READY (ChibiOS: UNINIT=0 STOP=1 READY=2)'],
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

  /* Decoded frame ring: what the module actually said. */
  const CMDS = { 0: 'connection-status', 1: 'host-lock-LED', 2: 'power' };
  const fCount = r[26], fHead = r[27];
  if (fCount) {
    console.log(`  frames received (${fCount}, oldest first):`);
    for (let n = 0; n < fCount; n++) {
      const i = (fHead - fCount + n + 6) % 6;
      const b = 28 + i * 3;
      const [cmd, mode, data] = [r[b], r[b + 1], r[b + 2]];
      let note = CMDS[cmd] ?? `cmd ${cmd}?`;
      if (cmd === 0) note += data ? '  -> CONNECTED' : '  -> disconnected';
      if (cmd === 2) note += data === 0xaa ? '  -> suspend' : data === 0xbb ? '  -> resume' : '';
      console.log(`    cmd=${hex(cmd,2)} mode=${hex(mode,2)} data=${hex(data,2)}   ${note}`);
    }
    console.log('');
  }

  /* Boot mode. out[45..47] -> r[46..48]. */
  const bootByte = r[46], moduleMode = r[47], flags = r[48];
  const bootMode = (bootByte & 0xf0) === 0xa0 ? (bootByte & 0x0f) : null;
  console.log(`  boot mode     : ${bootMode === null ? 'unset (boots USB)' : MODES[bootMode] ?? bootMode}`);
  console.log(`  module says   : ${moduleMode ? MODES[moduleMode] ?? moduleMode : 'nothing yet'}   (follows the switch on the back)`);
  console.log(`  boot decided  : ${flags & 1 ? 'yes' : 'not yet'}${flags & 2 ? '   (restored, USB can reclaim)' : ''}`);
  console.log('');

  if (bad)            console.log(`>> ${bad} register(s) wrong -- that IS the bug. Fix before looking downstream.`);
  else if (tx === 0)  console.log('>> Registers correct but nothing accepted. Driver refused the writes.');
  else if (rx === 0)  console.log('>> Registers correct, bytes accepted, module silent. Fault is downstream of the MCU: wiring or the module itself.');
  else if (!connected) console.log('>> Module is talking but has not reported a connection (cmd 0 with data!=0). See the frames above.');
  else                console.log('>> Two-way traffic. Protocol-level problem.');
} finally {
  dev.close();
}
