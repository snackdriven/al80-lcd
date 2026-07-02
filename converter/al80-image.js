#!/usr/bin/env node
/**
 * al80-image — convert a still image into a forged AL80 LCD HID transfer.
 *
 * Panel: YUNZII AL80 LCD, 112x137, RGB565 BIG-ENDIAN, 2 bytes/px, row-major, top-left origin.
 * Frame: 30,688 bytes == 548 data blocks of 56 bytes (still image: ALL 56 bytes, no tail).
 * Sequence: 0x40 announce -> 548x 0x41 data -> 0x42 finish.
 *
 * v1 is STILL-IMAGES ONLY. GIF is deferred (bank-base encoding undecoded; see design brief 7).
 *
 * The packet-build / checksum / RGB565-pack logic is pure and dependency-free so it can be
 * unit-tested WITHOUT sharp or node-hid (see test/frame_encoder.test.js). sharp and node-hid
 * are required lazily, only in the paths that actually need them (image decode / device send).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---- protocol constants ----------------------------------------------------
const WIDTH = 112;
const HEIGHT = 137;
const FRAME_BYTES = 30688;          // 112*137*2 == 548*56 exactly
const BLOCK = 56;                   // every still block is 56 bytes; NO 16-byte tail
const BLOCK_COUNT = FRAME_BYTES / BLOCK;   // 548
const PACKET_PAYLOAD = 64;          // HID data bytes per report (report id excluded)
const REPORT_SIZE = 65;             // report id byte + 64 data bytes

// Announce is a known-good captured constant, valid ONLY for 112x137 (type[9]=0x10 = image).
const ANNOUNCE = [0x40, 0, 0, 0x08, 0xCF, 0x02, 0, 0xA5, 0x5A, 0x10, 0, 0x01, 0xC5, 0xB1, 0x01];
const FINISH   = [0x42, 0, 0, 0x38, 0x7A];

// AL80 HID identity (matches tooling/al80_clock.js)
const VID = 0x28E9, PID = 0x30AF, USAGE_PAGE = 0xFF60;

// ===========================================================================
// PURE LOGIC (no sharp, no node-hid) — unit-testable with a hand-made buffer
// ===========================================================================

/**
 * Pack a raw RGB888 buffer (WIDTH*HEIGHT*3, row-major) into RGB565 BIG-ENDIAN.
 * Big-endian: high byte first. Solid red (255,0,0) -> 0xF800 -> bytes F8 00.
 * Optional Floyd-Steinberg dither reduces 565 banding on gradients.
 * Returns a Buffer of exactly FRAME_BYTES.
 */
function packRGB565BE(rgb, opts = {}) {
  const dither = !!opts.dither;
  const px = WIDTH * HEIGHT;
  if (rgb.length !== px * 3) {
    throw new Error(`packRGB565BE: expected ${px * 3} RGB bytes, got ${rgb.length}`);
  }
  const frame = Buffer.alloc(FRAME_BYTES);

  if (!dither) {
    for (let i = 0; i < px; i++) {
      const R = rgb[3 * i], G = rgb[3 * i + 1], B = rgb[3 * i + 2];
      const v = ((R >> 3) << 11) | ((G >> 2) << 5) | (B >> 3);
      frame[2 * i] = (v >> 8) & 0xFF;   // BIG-ENDIAN: high byte first
      frame[2 * i + 1] = v & 0xFF;
    }
    return frame;
  }

  // Floyd-Steinberg over a float working copy, quantizing to 5/6/5 bits.
  const work = Float32Array.from(rgb);
  const clamp = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);
  // per-channel quantize: round to nearest representable 8-bit value for N bits
  const q = (val, bits) => {
    const levels = (1 << bits) - 1;
    const step = 255 / levels;
    return Math.round(Math.round(clamp(val) / step) * step);
  };
  const spread = (x, y, er, eg, eb, f) => {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const j = (y * WIDTH + x) * 3;
    work[j] += er * f; work[j + 1] += eg * f; work[j + 2] += eb * f;
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x, j = i * 3;
      const oR = work[j], oG = work[j + 1], oB = work[j + 2];
      const nR = q(oR, 5), nG = q(oG, 6), nB = q(oB, 5);
      const eR = oR - nR, eG = oG - nG, eB = oB - nB;
      spread(x + 1, y, eR, eG, eB, 7 / 16);
      spread(x - 1, y + 1, eR, eG, eB, 3 / 16);
      spread(x, y + 1, eR, eG, eB, 5 / 16);
      spread(x + 1, y + 1, eR, eG, eB, 1 / 16);
      const v = ((nR >> 3) << 11) | ((nG >> 2) << 5) | (nB >> 3);
      frame[2 * i] = (v >> 8) & 0xFF;
      frame[2 * i + 1] = v & 0xFF;
    }
  }
  return frame;
}

/**
 * One data block from a frame offset. Returns a logical (unpadded) byte array:
 *   [0x41, offLo, offHi, len, cksumLo, cksumHi, 0x00] + 56 payload bytes  (63 bytes)
 * cksum = (0x41 + offLo + offHi + len + Sum(payload)) & 0xFFFF, stored little-endian.
 */
function buildDataBlock(frame, k) {
  const off = k * BLOCK;
  const len = BLOCK;
  const offLo = off & 0xFF;
  const offHi = (off >> 8) & 0xFF;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += frame[off + i];
  const cksum = (0x41 + offLo + offHi + len + sum) & 0xFFFF;
  const out = [0x41, offLo, offHi, len, cksum & 0xFF, (cksum >> 8) & 0xFF, 0x00];
  for (let i = 0; i < len; i++) out.push(frame[off + i]);
  return out;
}

/** 548 data blocks, all 56-byte payload. */
function buildDataBlocks(frame) {
  const blocks = [];
  for (let k = 0; k < BLOCK_COUNT; k++) blocks.push(buildDataBlock(frame, k));
  return blocks;
}

/**
 * Full logical packet stream: [ANNOUNCE] + 548 data blocks + [FINISH].
 * Each entry is an unpadded byte array. Callers pad for JSON (64) or for send (65).
 * Takes a raw FRAME_BYTES buffer so it is testable with a hand-made buffer.
 */
function buildPacketStream(frame) {
  if (frame.length !== FRAME_BYTES) {
    throw new Error(`buildPacketStream: frame must be ${FRAME_BYTES} bytes, got ${frame.length}`);
  }
  return [ANNOUNCE.slice(), ...buildDataBlocks(frame), FINISH.slice()];
}

/** Pad a logical packet to a 64-byte data payload (NO report id) — the JSON/capture form. */
function padTo64(bytes) {
  if (bytes.length > PACKET_PAYLOAD) throw new Error('packet exceeds 64 data bytes');
  const out = new Array(PACKET_PAYLOAD).fill(0);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i];
  return out;
}

/** Pad a logical packet for HID write: prepend 0x00 report id, zero-fill to 65. */
function padForSend(bytes) {
  if (bytes.length > PACKET_PAYLOAD) throw new Error('packet exceeds 64 data bytes');
  const out = new Array(REPORT_SIZE).fill(0);   // [0] = 0x00 report id
  for (let i = 0; i < bytes.length; i++) out[i + 1] = bytes[i];
  return out;
}

const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** dry-run JSON records: [{ "i": n, "hex": "40 00 00 08 cf ..." }] — 64-byte payloads. */
function streamToRecords(stream) {
  return stream.map((pkt, i) => ({ i, hex: toHex(padTo64(pkt)) }));
}

// ---- offline self-check (design brief 6, layer 1) --------------------------
/**
 * Recompute and assert everything offline, before any emit or send.
 * Throws on the first violation. Returns a small stats object on success.
 */
function selfCheck(frame, stream) {
  const errs = [];
  if (frame.length !== FRAME_BYTES) errs.push(`frame length ${frame.length} != ${FRAME_BYTES}`);

  const blocks = stream.slice(1, stream.length - 1);
  if (blocks.length !== BLOCK_COUNT) errs.push(`block count ${blocks.length} != ${BLOCK_COUNT}`);

  // announce / finish constants
  const ann = stream[0], fin = stream[stream.length - 1];
  if (toHex(ann) !== toHex(ANNOUNCE)) errs.push('announce != constant');
  if (toHex(fin) !== toHex(FINISH)) errs.push('finish != constant');

  // offsets 0..30632 step 56, len 56, checksum recompute
  let expOff = 0, totalPayload = 0;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b[0] !== 0x41) { errs.push(`block ${k} opcode 0x${b[0].toString(16)}`); continue; }
    const off = b[1] | (b[2] << 8);
    const len = b[3];
    if (off !== expOff) errs.push(`block ${k} offset ${off} != ${expOff}`);
    if (len !== BLOCK) errs.push(`block ${k} len ${len} != ${BLOCK}`);
    const payload = b.slice(7, 7 + len);
    let sum = 0; for (const p of payload) sum += p;
    const want = (0x41 + b[1] + b[2] + len + sum) & 0xFFFF;
    const got = b[4] | (b[5] << 8);
    if (want !== got) errs.push(`block ${k} checksum got 0x${got.toString(16)} want 0x${want.toString(16)}`);
    totalPayload += payload.length;
    expOff += BLOCK;
  }
  const lastOff = (BLOCK_COUNT - 1) * BLOCK;   // 30632
  if (totalPayload !== FRAME_BYTES) errs.push(`total payload ${totalPayload} != ${FRAME_BYTES}`);

  if (errs.length) {
    throw new Error('SELF-CHECK FAILED:\n  - ' + errs.slice(0, 10).join('\n  - ') +
      (errs.length > 10 ? `\n  - (+${errs.length - 10} more)` : ''));
  }
  return { blocks: blocks.length, firstOffset: 0, lastOffset: lastOff, step: BLOCK, totalBytes: totalPayload };
}

// ===========================================================================
// IMAGE PIPELINE (needs sharp) — lazy require
// ===========================================================================

function parseHexColor(hex) {
  const m = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(m)) throw new Error(`bad --pad-color "${hex}" (want #RRGGBB)`);
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}

const FIT_MAP = { cover: 'cover', contain: 'contain', stretch: 'fill', pad: 'contain' };

/** decode -> fit/resize to 112x137 -> bake look -> flatten -> raw RGB888 buffer. */
async function decodeToRGB(inputPath, opts) {
  let sharp;
  try { sharp = require('sharp'); }
  catch (e) { throw new Error('sharp is not installed. Run `npm install` in converter/.'); }

  const bg = opts.padColor;
  const fit = FIT_MAP[opts.fit];
  if (!fit) throw new Error(`unknown --fit "${opts.fit}"`);

  let img = sharp(inputPath).resize(WIDTH, HEIGHT, {
    fit, position: 'centre', background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 },
    kernel: 'lanczos3',
  });

  const mod = {};
  if (opts.brightness !== 1) mod.brightness = opts.brightness;
  if (opts.grayscale) mod.saturation = 0;
  else if (opts.saturation !== null && opts.saturation !== undefined) mod.saturation = opts.saturation;
  if (Object.keys(mod).length) img = img.modulate(mod);

  if (opts.contrast !== 1) img = img.linear(opts.contrast, 128 * (1 - opts.contrast));

  // flatten alpha onto pad color (RGB565 has no alpha), force 3-channel sRGB
  img = img.flatten({ background: { r: bg.r, g: bg.g, b: bg.b } }).toColourspace('srgb');

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.width !== WIDTH || info.height !== HEIGHT) {
    throw new Error(`resize produced ${info.width}x${info.height}, expected ${WIDTH}x${HEIGHT}`);
  }
  if (info.channels !== 3) throw new Error(`expected 3 channels after flatten, got ${info.channels}`);
  if (data.length !== WIDTH * HEIGHT * 3) {
    throw new Error(`raw buffer ${data.length} != ${WIDTH * HEIGHT * 3}`);
  }
  return data;
}

/** Write a 112x137 PNG reconstructed from the packed 565 frame (what the panel will show). */
async function writePreview(frame, outPath) {
  const sharp = require('sharp');
  const px = WIDTH * HEIGHT;
  const rgb = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) {
    const v = (frame[2 * i] << 8) | frame[2 * i + 1];
    const r5 = (v >> 11) & 0x1F, g6 = (v >> 5) & 0x3F, b5 = v & 0x1F;
    rgb[3 * i] = (r5 * 255 / 31) | 0;
    rgb[3 * i + 1] = (g6 * 255 / 63) | 0;
    rgb[3 * i + 2] = (b5 * 255 / 31) | 0;
  }
  await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(outPath);
}

// ===========================================================================
// DEVICE SEND (needs node-hid) — lazy require, single-opener guarded
// ===========================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findPath(HID) {
  const matches = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  if (matches.length === 0) throw new Error('No AL80 found (VID 0x28e9 PID 0x30af). Is it plugged in?');
  const match = matches.find((d) => d.usagePage === USAGE_PAGE) || matches[0];
  if (!match.path) throw new Error('Found device but it has no usable path.');
  return match.path;
}

async function sendStream(stream, verbose) {
  let HID;
  try { HID = require('node-hid'); }
  catch (e) { throw new Error('node-hid is not installed. Run `npm install` in converter/.'); }

  const dev = new HID.HID(findPath(HID));
  try {
    for (let i = 0; i < stream.length; i++) {
      const written = dev.write(padForSend(stream[i]));
      if (written <= 0) {
        // single-opener: the yunzii-game.com tab likely holds the 0xFF60 interface.
        throw new Error('dev.write returned ' + written +
          ' — close the yunzii-game.com tab (single-opener on 0xFF60) and retry. Not looping.');
      }
      if (verbose && (i === 0 || i === stream.length - 1 || i % 100 === 0)) {
        process.stderr.write(`  wrote packet ${i + 1}/${stream.length}\r`);
      }
      await sleep(3);   // ~2-5ms gap between packets
    }
    if (verbose) process.stderr.write('\n');
  } finally {
    dev.close();
  }
}

// ===========================================================================
// CLI
// ===========================================================================

const HELP = `al80-image — convert a still image into a forged AL80 LCD HID transfer (112x137 RGB565 BE)

Usage:
  al80-image <input> [options]

Mode (default: --dry-run):
  --send                 Write the stream to the device over HID (0xFF60)
  --dry-run [<file>]     Emit packet stream to a file + validate; no hardware
                         (default file: <input>.al80.json / .al80.bin)

Fitting:
  --fit <mode>           cover | contain | stretch | pad   (default cover)
  --pad-color <hex>      #RRGGBB  (default #000000)

Look bake-in (client-side only — no device opcode):
  --brightness <f>       1.0 = unchanged
  --contrast <f>         1.0 = unchanged
  --saturation <f>       0 = grayscale
  --grayscale            = --saturation 0
  --dither               Floyd-Steinberg before RGB565 quant (reduces banding)

Output / verify:
  --emit-format <fmt>    json | bin   (json matches the capture schema; default json)
  --verify               Run converter/al80_verify.py on the emitted JSON (default on for dry-run)
  --preview <png>        Write a 112x137 PNG of the post-565 result
  -v, --verbose
  -h, --help

Notes:
  v1 is STILL-IMAGES ONLY. GIF is not yet supported.
  --send fails if the yunzii-game.com tab is open (single-opener on 0xFF60). Close it and retry.
`;

function parseArgs(argv) {
  const opts = {
    input: null,
    mode: null,                 // 'send' | 'dry-run' (null -> default dry-run)
    dryRunFile: null,
    fit: 'cover',
    padColor: parseHexColor('#000000'),
    brightness: 1,
    contrast: 1,
    saturation: null,
    grayscale: false,
    dither: false,
    emitFormat: 'json',
    verify: null,               // null -> default (on for dry-run)
    preview: null,
    verbose: false,
  };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${name} needs a number, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '--send': opts.mode = 'send'; break;
      case '--dry-run':
        opts.mode = 'dry-run';
        if (argv[i + 1] && !argv[i + 1].startsWith('-')) opts.dryRunFile = argv[++i];
        break;
      case '--fit': opts.fit = argv[++i]; break;
      case '--pad-color': opts.padColor = parseHexColor(argv[++i]); break;
      case '--brightness': opts.brightness = num(argv[++i], 'brightness'); break;
      case '--contrast': opts.contrast = num(argv[++i], 'contrast'); break;
      case '--saturation': opts.saturation = num(argv[++i], 'saturation'); break;
      case '--grayscale': opts.grayscale = true; break;
      case '--dither': opts.dither = true; break;
      case '--emit-format': opts.emitFormat = argv[++i]; break;
      case '--verify': opts.verify = true; break;
      case '--preview': opts.preview = argv[++i]; break;
      case '-v': case '--verbose': opts.verbose = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option "${a}" (try --help)`);
        if (opts.input) throw new Error(`unexpected extra argument "${a}"`);
        opts.input = a;
    }
  }
  return opts;
}

function defaultOutPath(input, ext) {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, `${base}.al80.${ext}`);
}

function runVerify(jsonPath) {
  const { spawnSync } = require('child_process');
  const script = path.join(__dirname, 'al80_verify.py');
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(py, [script, jsonPath], { encoding: 'utf8' });
  if (r.error) {
    return { ok: false, output: `could not run ${py}: ${r.error.message}`, skipped: true };
  }
  return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') };
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('error: ' + e.message); process.exit(2); }

  if (opts.help || !opts.input) {
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : (opts.input ? 0 : 2));
  }

  const mode = opts.mode || 'dry-run';
  const log = (m) => { if (opts.verbose) console.error(m); };

  // ---- warn on wild aspect ratios (design brief 8) ----
  try {
    const sharp = require('sharp');
    const meta = await sharp(opts.input).metadata();
    if (meta.width && meta.height) {
      const target = WIDTH / HEIGHT;              // ~0.817
      const src = meta.width / meta.height;
      const ratio = src / target;
      if (ratio > 2 || ratio < 0.5) {
        console.error(`warning: input aspect ${src.toFixed(2)} deviates >2x from panel ${target.toFixed(2)}; heavy crop/pad expected.`);
      }
    }
  } catch (_) { /* sharp missing or unreadable metadata — decode step will report clearly */ }

  // ---- pipeline: decode -> pack -> stream -> self-check ----
  let frame, stream;
  try {
    log(`decoding ${opts.input} (fit=${opts.fit}, dither=${opts.dither})`);
    const rgb = await decodeToRGB(opts.input, opts);
    frame = packRGB565BE(rgb, { dither: opts.dither });
    stream = buildPacketStream(frame);
  } catch (e) {
    console.error('error: ' + e.message);
    process.exit(1);
  }

  // ---- always-on offline self-check (before emit AND before send) ----
  let stats;
  try {
    stats = selfCheck(frame, stream);
    log(`self-check ok: ${stats.blocks} blocks, offsets ${stats.firstOffset}..${stats.lastOffset} step ${stats.step}, ${stats.totalBytes} bytes`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (opts.preview) {
    try { await writePreview(frame, opts.preview); log(`preview -> ${opts.preview}`); }
    catch (e) { console.error('warning: preview failed: ' + e.message); }
  }

  if (mode === 'send') {
    console.error(`self-check passed (${stats.blocks} blocks). Sending ${stream.length} packets over HID...`);
    try {
      await sendStream(stream, opts.verbose);
      console.error('done. Sent announce + ' + stats.blocks + ' data blocks + finish.');
    } catch (e) {
      console.error('error: ' + e.message);
      process.exit(1);
    }
    return;
  }

  // ---- dry-run: emit + verify ----
  const doVerify = opts.verify === null ? true : opts.verify;   // default on for dry-run
  if (opts.emitFormat === 'json') {
    const out = opts.dryRunFile || defaultOutPath(opts.input, 'json');
    const records = streamToRecords(stream);
    fs.writeFileSync(out, JSON.stringify(records, null, 1));
    console.error(`dry-run: wrote ${records.length} records -> ${out}`);
    console.error(`  self-check: ${stats.blocks} blocks, offsets ${stats.firstOffset}..${stats.lastOffset} step ${stats.step}, ${stats.totalBytes} bytes OK`);
    if (doVerify) {
      const v = runVerify(out);
      if (v.skipped) console.error('  --verify skipped: ' + v.output);
      else {
        process.stderr.write(v.output);
        console.error('  al80_verify.py: ' + (v.ok ? 'PASS' : 'FAIL'));
        if (!v.ok) process.exit(1);
      }
    }
  } else if (opts.emitFormat === 'bin') {
    const out = opts.dryRunFile || defaultOutPath(opts.input, 'bin');
    // bin = concatenation of the 64-byte data payloads (wire form minus report id)
    const buf = Buffer.concat(stream.map((p) => Buffer.from(padTo64(p))));
    fs.writeFileSync(out, buf);
    console.error(`dry-run: wrote ${stream.length} packets (${buf.length} bytes) -> ${out}`);
    console.error(`  self-check: ${stats.blocks} blocks, ${stats.totalBytes} frame bytes OK`);
    if (doVerify) console.error('  (--verify runs on json only; re-emit with --emit-format json to cross-check)');
  } else {
    console.error(`error: unknown --emit-format "${opts.emitFormat}" (json|bin)`);
    process.exit(2);
  }
}

// export pure logic for tests; run CLI only when invoked directly
module.exports = {
  WIDTH, HEIGHT, FRAME_BYTES, BLOCK, BLOCK_COUNT, ANNOUNCE, FINISH,
  packRGB565BE, buildDataBlock, buildDataBlocks, buildPacketStream,
  padTo64, padForSend, streamToRecords, selfCheck, toHex, parseHexColor,
};

if (require.main === module) {
  main().catch((e) => { console.error('fatal: ' + (e && e.stack || e)); process.exit(1); });
}
