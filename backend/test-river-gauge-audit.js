'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { observedMs, assess } = require('./audit-river-gauges');

test('KST timestamps use +09 offset', () => {
  assert.equal(new Date(observedMs('2026-11-03 00:00:00')).toISOString(), '2026-11-02T15:00:00.000Z');
  assert.equal(observedMs('2026-02-30 00:00:00'), null);
});
test('missing coordinate and dam type flagged without classifying flood risk', () => {
  const s = { station_name: '안동댐', external_station_id: '2001685', latitude: null, longitude: null, latest_observed_at: '2026-11-03 00:00:00', latest_water_level: '144.040' };
  const result = assess(s, observedMs('2026-11-03 01:00:00'));
  assert(result.issues.includes('MISSING_OR_INVALID_COORDINATES'));
  assert(result.issues.includes('CHECK_GAUGE_DATUM_AND_TYPE'));
  assert(!result.issues.includes('STALE_OBSERVATION'));
});
test('stale observations and missing readings flagged', () => {
 const s = { station_name: 'Test gauge', external_station_id: '2201670', latitude: 35.5, longitude:129.3, latest_observed_at:'2026-11-03 00:00:00', latest_water_level:null };
 const result = assess(s, observedMs('2026-11-03 09:00:00'));
 assert(result.issues.includes('STALE_OBSERVATION'));
 assert(result.issues.includes('MISSING_WATER_LEVEL'));
});
