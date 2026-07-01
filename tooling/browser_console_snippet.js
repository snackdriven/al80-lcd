// Paste into the browser console on the yunzii-game.com tab
// while the keyboard is connected. Keeps the LCD synced in 12hr format.
const dev = (await navigator.hid.getDevices()).find(d => d.opened);
const send = a => dev.sendReport(0, new Uint8Array(a.concat(Array(63 - a.length).fill(0))));
async function sync12hr() {
  const n = new Date(), h = (n.getHours() % 12) || 12, m = n.getMinutes(), s = n.getSeconds();
  const ck = (0x41 + 0x03 + h + m + s) & 0xff;
  await send([0x40,0,0,0x07,0xf6,0x02,0,0xa5,0x5a,0x09,0,0x03,0xc3,0xe1]);
  await new Promise(r=>setTimeout(r,60));
  await send([0x41,0,0,0x03,ck,0,0,h,m,s]);
  await new Promise(r=>setTimeout(r,60));
  await send([0x42,0,0,0x38,0x7a]);
}
sync12hr(); setInterval(sync12hr, 60000);
