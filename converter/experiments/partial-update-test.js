#!/usr/bin/env node
/*
 * Partial-update experiment for the AL80 LCD.
 *
 * Question: can we update a SUB-REGION of the panel faster than a full 548-block
 * frame? That decides whether live widgets / animation are feasible, or whether
 * we're capped at full-frame refresh (~0.5-1 fps).
 *
 * Safe: only ever emits 0x40 / 0x41 / 0x42. Never touches 0xB0-0xB7 (DFU/brick).
 * Default is DRY-RUN (prints the plan, no device writes). Add --send to write.
 * Close the yunzii-game.com tab first — only one process can hold 0xFF60.
 *
 * Usage:
 *   node partial-update-test.js full   <hex>                 [--send] [--gap N]
 *   node partial-update-test.js bare   <hex> <startBlk> <n>  [--send] [--gap N]
 *   node partial-update-test.js wrapped<hex> <startBlk> <n>  [--send] [--gap N]
 *   node partial-update-test.js timing                        [--send]
 *
 * Recommended run order (with keyboard plugged in, browser tab closed):
 *   1) node partial-update-test.js full ff0000 --send      # panel should go solid RED
 *   2) node partial-update-test.js bare 00ff00 250 10 --send
 *        WATCH: does a green band appear WITHOUT an announce/finish? (tests "lone 0x41")
 *   3) node partial-update-test.js full ff0000 --send      # reset to red
 *      node partial-update-test.js wrapped 00ff00 250 10 --send
 *        WATCH: three outcomes ->
 *          (a) red panel with a GREEN BAND  = partial update works, announce does NOT clear -> DIRTY-RECT WINS
 *          (b) mostly BLACK with a green band = announce clears the buffer -> must send full frames
 *          (c) no change                     = wrapped-partial not supported
 *   4) node partial-update-test.js timing --send            # fastest reliable full-frame refresh
 *
 * Report back what the panel actually did for 2 and 3, and the timing numbers.
 */
const path = require('path');
const conv = require(path.join(__dirname, '..', 'al80-image.js'));
const { FRAME_BYTES, BLOCK, BLOCK_COUNT, ANNOUNCE, FINISH, buildDataBlock, padForSend, parseHexColor } = conv;

const VID = 0x28E9, PID = 0x30AF, USAGE_PAGE = 0xFF60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- args ---
const argv = process.argv.slice(2);
const cmd = argv[0];
const SEND = argv.includes('--send');
const gapArg = argv.indexOf('--gap');
const GAP = gapArg >= 0 ? Number(argv[gapArg + 1]) : 3;
const positional = argv.filter((a, i) => i > 0 && !a.startsWith('--') && !(argv[i - 1] === '--gap'));

// rgb565 big-endian bytes for a hex color, e.g. "ff0000" -> [0xF8,0x00]
function color565BE(hex) {
  const { r, g, b } = parseHexColor(hex);
  const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  return [(v >> 8) & 0xFF, v & 0xFF];
}
function solidFrame(hex) {
  const [hi, lo] = color565BE(hex);
  const f = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i += 2) { f[i] = hi; f[i + 1] = lo; }
  return f;
}

function openDevice() {
  const HID = require('node-hid');
  const matches = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  if (!matches.length) throw new Error('No AL80 found (VID 0x28e9 PID 0x30af). Plugged in?');
  const m = matches.find((d) => d.usagePage === USAGE_PAGE) || matches[0];
  if (!m.path) throw new Error('Found device but no usable path.');
  return new HID.HID(m.path);
}

async function send(packets, gap) {
  if (!SEND) {
    console.log(`  [dry-run] would send ${packets.length} packets at ${gap}ms gap (add --send to run)`);
    return 0;
  }
  const dev = openDevice();
  const t0 = Date.now();
  try {
    for (const pkt of packets) {
      const n = dev.write(padForSend(pkt));
      if (n <= 0) throw new Error('dev.write <= 0 — close the yunzii-game.com tab and retry (single-opener).');
      if (gap > 0) await sleep(gap);
    }
  } finally { dev.close(); }
  const ms = Date.now() - t0;
  console.log(`  sent ${packets.length} packets in ${ms}ms (${(1000 / ms).toFixed(2)} full-frame fps equiv)`);
  return ms;
}

function partialBlocks(hex, startBlk, n) {
  const frame = solidFrame(hex);
  const blocks = [];
  for (let k = startBlk; k < startBlk + n && k < BLOCK_COUNT; k++) blocks.push(buildDataBlock(frame, k));
  return blocks;
}

async function main() {
  console.log(`AL80 partial-update experiment — cmd=${cmd || '(none)'} send=${SEND} gap=${GAP}ms\n`);
  if (cmd === 'full') {
    const hex = positional[0] || 'ff0000';
    const frame = solidFrame(hex);
    const stream = [ANNOUNCE.slice(), ...Array.from({ length: BLOCK_COUNT }, (_, k) => buildDataBlock(frame, k)), FINISH.slice()];
    console.log(`FULL solid #${hex}: announce + ${BLOCK_COUNT} blocks + finish`);
    await send(stream, GAP);
  } else if (cmd === 'bare') {
    const [hex, s, n] = [positional[0], Number(positional[1]), Number(positional[2])];
    const blocks = partialBlocks(hex, s, n);
    console.log(`BARE partial #${hex}: ${blocks.length} data blocks at block ${s} (offset 0x${(s * BLOCK).toString(16)}), NO announce/finish`);
    console.log('  WATCH: does that band change with a lone 0x41 stream? (KB says a lone 0x41 did nothing)');
    await send(blocks, GAP);
  } else if (cmd === 'wrapped') {
    const [hex, s, n] = [positional[0], Number(positional[1]), Number(positional[2])];
    const blocks = partialBlocks(hex, s, n);
    const stream = [ANNOUNCE.slice(), ...blocks, FINISH.slice()];
    console.log(`WRAPPED partial #${hex}: announce + ${blocks.length} blocks at block ${s} + finish`);
    console.log('  WATCH: (a) prior image survives + band changes = DIRTY-RECT WORKS');
    console.log('         (b) rest goes black = announce clears the buffer');
    console.log('         (c) no change = wrapped-partial unsupported');
    await send(stream, GAP);
  } else if (cmd === 'timing') {
    const frame = solidFrame('0000ff');
    const stream = [ANNOUNCE.slice(), ...Array.from({ length: BLOCK_COUNT }, (_, k) => buildDataBlock(frame, k)), FINISH.slice()];
    console.log('TIMING: full-frame send at decreasing inter-packet gaps');
    for (const g of [5, 2, 1, 0]) { console.log(`  gap=${g}ms:`); await send(stream, g); }
    console.log('  -> the lowest gap that still renders cleanly is your max full-frame refresh.');
  } else {
    console.log('Unknown command. See the header of this file for usage and the recommended run order.');
    process.exit(1);
  }
}
main().catch((e) => { console.error('fatal: ' + (e && e.stack || e)); process.exit(1); });
