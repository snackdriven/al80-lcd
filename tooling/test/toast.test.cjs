'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute only the toast function with a captured exec. Never import the HID
// module, run the clock loop, launch PowerShell, or display a notification.
const source = fs.readFileSync(path.join(__dirname, '../al80_clock.js'), 'utf8');
const functionSource = source.match(/function toast\(title, message\) \{[\s\S]*?\n\}/)[0];

for (const [title, message] of [
  ['AL80 Clock', 'Keyboard unavailable'],
  ['quotes \' " & | > %PATH%', '$(Invoke-Command); `whoami`\nsecond line'],
  ['雪 ❄️ {{MESSAGE}}', "🌙 apostrophe's message"]
]) {
  test(`toast transports ${JSON.stringify(title)} as encoded text`, () => {
    let command;
    const context = vm.createContext({ Buffer, exec: value => { command = value; }, log: () => {} });
    vm.runInContext(functionSource, context);
    context.toast(title, message);
    const prefix = 'powershell -NoProfile -WindowStyle Hidden -EncodedCommand ';
    assert.ok(command.startsWith(prefix));
    const encoded = command.slice(prefix.length);
    assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    const payloads = [...script.matchAll(/FromBase64String\('([A-Za-z0-9+/=]*)'\)/g)];
    assert.equal(payloads.length, 2);
    assert.equal(Buffer.from(payloads[0][1], 'base64').toString('utf8'), title);
    assert.equal(Buffer.from(payloads[1][1], 'base64').toString('utf8'), message);
    assert.ok(script.includes('CreateTextNode($title)'));
    assert.ok(script.includes('CreateTextNode($msg)'));
  });
}
