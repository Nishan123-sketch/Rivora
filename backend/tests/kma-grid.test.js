const test = require('node:test');
const assert = require('node:assert/strict');
const { toKmaGrid } = require('../kma-grid');
test('Ulsan forecast grid matches existing project grid', () => {
  assert.deepEqual(toKmaGrid(35.5384, 129.3114), {nx:102, ny:84});
});
test('Gangneung produces a different Korean forecast grid', () => {
  const result = toKmaGrid(37.7519,128.8761);
  assert.ok(result.nx > 0 && result.ny > 0);
  assert.notDeepEqual(result,{nx:102,ny:84});
});
test('invalid coordinates rejected', () => assert.throws(() => toKmaGrid(0,0), RangeError));
