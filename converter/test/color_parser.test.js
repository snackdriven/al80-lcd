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
  assert.deepStrictEqual(parseHexColor('#ff0000'), [ 255, 0, 0 ]);
  assert.deepStrictEqual(parseHexColor('#00ff00'), [ 0, 255, 0 ]);
  assert.deepStrictEqual(parseHexColor('#0000ff'), [ 0, 0, 255 ]);
  assert.deepStrictEqual(parseHexColor('#ffffff'), [ 255, 255, 255 ]);
  assert.deepStrictEqual(parseHexColor('#000000'), [ 0, 0, 0 ]);
  assert.deepStrictEqual(parseHexColor('#123456'), [ 18, 52, 86 ]);
});

ok('parseHexColor valid hex without #', () => {
  assert.deepStrictEqual(parseHexColor('ff0000'), [ 255, 0, 0 ]);
});

ok('parseHexColor mixed case', () => {
  assert.deepStrictEqual(parseHexColor('#aBcDeF'), [ 171, 205, 239 ]);
});

ok('parseHexColor handles spaces in input', () => {
  assert.deepStrictEqual(parseHexColor('  #ff0000  '), [ 255, 0, 0 ]);
});

ok('parseHexColor 3 character hex', () => {
  assert.deepStrictEqual(parseHexColor('#fff'), [ 255, 255, 255 ]);
  assert.deepStrictEqual(parseHexColor('f00'), [ 255, 0, 0 ]);
});

ok('parseHexColor invalid formats throw errors', () => {
  assert.throws(() => parseHexColor('red'), /invalid hex color: red/);
  assert.throws(() => parseHexColor('#ffffffff'), /invalid hex color: #ffffffff/);
  assert.throws(() => parseHexColor(''), /invalid hex color: /);
  assert.throws(() => parseHexColor('#gghhii'), /invalid hex color: #gghhii/);
});

console.log(`\nAll ${passed} checks passed.`);
