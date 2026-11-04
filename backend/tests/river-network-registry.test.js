const test = require('node:test');
const assert = require('node:assert/strict');
const {getCatalog, locateRiver, normalizeName} = require('../river-network-registry');

test('original 100 river identities remain present', () => {
  const all = getCatalog();
  assert.ok(all.length >= 100);
  assert.equal(new Set(all.map(r => r.river_id)).size, all.length);
  assert.ok(all.some(r => r.river_id === 'taehwa'));
});

test('names normalized without inventing a station identity', () => {
  assert.equal(normalizeName('  태화 강 '), '태화강');
  assert.equal(locateRiver({riverName:'태화강'}), null);
  assert.equal(locateRiver({riverName:'태화강',lat:35.55,lon:129.30})?.river_id, 'taehwa');
});
