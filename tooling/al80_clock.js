const HID = require('node-hid');   // npm install node-hid
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const VID = 0x28E9, PID = 0x30AF;
const USAGE_PAGE = 0xFF60;         // raw/VIA interface, NOT the keyboard interface
const SYNC_EVERY_MS = 60000;
const LOG_FILE = path.join(__dirname, 'al80_clock.log');
const ONCE = process.argv.includes('--once');

// ---- loud logging ---------------------------------------------------------
function log(level, msg) {
  const line = '[' + new Date().toISOString() + '] ' + level + ': ' + msg;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// Native Windows toast notification (works even when running hidden).
function toast(title, message) {
  const esc = (s) => String(s).replace(/'/g, "''");
  const ps = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$t = $xml.GetElementsByTagName('text')",
    "$t.Item(0).AppendChild($xml.CreateTextNode('" + esc(title) + "')) | Out-Null",
    "$t.Item(1).AppendChild($xml.CreateTextNode('" + esc(message) + "')) | Out-Null",
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AL80 Clock').Show($toast)"
  ].join('; ');
  exec('powershell -NoProfile -WindowStyle Hidden -Command "' + ps.replace(/"/g, '\\"') + '"',
    (err) => { if (err) log('ERROR', 'toast failed: ' + err.message); });
}

let consecutiveFailures = 0;
function reportFailure(msg) {
  consecutiveFailures++;
  log('ERROR', msg + '  (consecutive failures: ' + consecutiveFailures + ')');
  if (consecutiveFailures === 3) {
    const alert = 'Clock is NOT updating. Check: browser tab open? keyboard asleep/unplugged? wrong interface?';
    log('ERROR', '*** ' + alert + ' ***');
    toast('AL80 clock sync failed', alert);
  }
}

// ---- device / packets -----------------------------------------------------
function findPath() {
  const all = HID.devices();
  const matches = all.filter(d => d.vendorId === VID && d.productId === PID);
  if (matches.length === 0) {
    throw new Error('No AL80 found (VID 0x28e9 PID 0x30af). Is it plugged in?');
  }
  const match = matches.find(d => d.usagePage === USAGE_PAGE) || matches[0];
  if (!match.usagePage) {
    log('WARN', 'usagePage not reported; falling back to interface ' + match.interface +
                '. If sync fails, inspect: node -e "console.log(require(\'node-hid\').devices().filter(d=>d.productId===0x30af))"');
  }
  if (!match.path) throw new Error('Found device but it has no usable path.');
  return match.path;
}

function buildPackets() {
  const now = new Date();
  const h = (now.getHours() % 12) || 12;   // 0->12, 13->1, 12->12
  const m = now.getMinutes();
  const s = now.getSeconds();
  const cksum = (0x41 + 0x03 + h + m + s) & 0xFF;
  const pad = (b) => [0x00].concat(b, new Array(64 - b.length).fill(0)); // 0x00 = report ID
  const packets = [
    pad([0x40, 0, 0, 0x07, 0xF6, 0x02, 0, 0xA5, 0x5A, 0x09, 0, 0x03, 0xC3, 0xE1]),
    pad([0x41, 0, 0, 0x03, cksum, 0, 0, h, m, s]),
    pad([0x42, 0, 0, 0x38, 0x7A]),
  ];
  return { packets, display: h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function syncOnce() {
  const devPath = findPath();
  const dev = new HID.HID(devPath);
  try {
    const { packets, display } = buildPackets();
    for (const pkt of packets) {
      const written = dev.write(pkt);
      if (written <= 0) throw new Error('dev.write returned ' + written + ' - device rejected the packet.');
      await sleep(60);
    }
    consecutiveFailures = 0;
    log('INFO', 'synced ' + display + ' (12hr)');
    return true;
  } finally {
    dev.close();
  }
}

async function main() {
  log('INFO', 'al80_clock starting (mode: ' + (ONCE ? 'once' : 'loop') + ', log: ' + LOG_FILE + ')');
  if (ONCE) {
    try { await syncOnce(); process.exit(0); }
    catch (e) { log('ERROR', 'single sync failed: ' + e.message); process.exit(1); }
  }
  for (;;) {
    try { await syncOnce(); }
    catch (e) { reportFailure(e.message); }
    await sleep(SYNC_EVERY_MS);
  }
}

process.on('uncaughtException',  (e) => { log('ERROR', 'uncaughtException: ' + (e.stack || e)); });
process.on('unhandledRejection', (e) => { log('ERROR', 'unhandledRejection: ' + ((e && e.stack) || e)); });

main();
