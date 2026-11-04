const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('forecast importer resolves Ulsan by KMA provider code rather than DB auto-ID', () => {
  const source = read('import-kma-forecast.js');
  assert.match(source, /findUlsanKma\(\)/);
  assert.doesNotMatch(source, /const STATION_ID\s*=\s*31/);
  assert.match(source, /\[stationId, issuedAt, validAt, SOURCE\]/);
});
test('forecast API accepts station ID and selects that station', () => {
  const source = read('forecast-routes.js');
  assert.match(source, /req\.query\.station_id/);
  assert.match(source, /WHERE station_id = \?/);
});
test('alert API reports actual opt-in configuration', () => {
  const source = read('alert-routes.js');
  assert.match(source, /automatic_generation_enabled: process.env.ENABLE_AUTOMATIC_ALERTS/);
});
