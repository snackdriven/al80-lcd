#!/usr/bin/env node
'use strict';


const assert = require('assert');
const { parseHexColor } = require('../al80-image.js');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

console.log('al80-image parseHexColor test\n');

ok('parseHexColor valid hex with #', () => {
  assert.deepStrictEqual(parseHexColor('#ff0000'), { r: 255, g: 0, b: 0 });
  assert.deepStrictEqual(parseHexColor('#00ff00'), { r: 0, g: 255, b: 0 });
  assert.deepStrictEqual(parseHexColor('#0000ff'), { r: 0, g: 0, b: 255 });
  assert.deepStrictEqual(parseHexColor('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepStrictEqual(parseHexColor('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepStrictEqual(parseHexColor('#123456'), { r: 18, g: 52, b: 86 });
});

ok('parseHexColor valid hex without #', () => {
  assert.deepStrictEqual(parseHexColor('ff0000'), { r: 255, g: 0, b: 0 });
});

ok('parseHexColor mixed case', () => {
  assert.deepStrictEqual(parseHexColor('#aBcDeF'), { r: 171, g: 205, b: 239 });
});

ok('parseHexColor handles spaces in input', () => {
  assert.deepStrictEqual(parseHexColor('  #ff0000  '), { r: 255, g: 0, b: 0 });
});

ok('parseHexColor rejects shorthand outside the documented six-digit contract', () => {
  assert.throws(() => parseHexColor('#fff'), /bad --pad-color/);
  assert.throws(() => parseHexColor('f00'), /bad --pad-color/);
});

ok('parseHexColor invalid formats throw errors', () => {
  for (const invalid of ['red', '#ffffffff', '', '#gghhii', '#12345', '#1234567', null, undefined]) {
    assert.throws(() => parseHexColor(invalid), /bad --pad-color/);
  }
});

console.log(`\nAll ${passed} checks passed.`);
