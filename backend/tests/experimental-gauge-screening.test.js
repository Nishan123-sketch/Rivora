'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {evaluateHistory} = require('../experimental-gauge-screening');
const HOUR = 3600000;
function kst(ms) {return new Date(ms + 9 * HOUR).toISOString().slice(0, 19).replace('T',' ');}
const now = Date.UTC(2026, 10, 5, 0, 0); // 2026-11-05 09:00 KST
const latest = kst(now - HOUR);
const gauge = {station_id: 2398, observed_at: latest, water_level_m: 10};
const history = Array.from({length: 800}, (_, i) => ({
  observed_at: kst(now - (800-i) * HOUR), water_level: i < 700 ? 1 : 2
}));
test('high relative level is not called an official flood warning or flood risk', () => {
  const r = evaluateHistory(gauge, history, now);
  assert.equal(r.screening_level, 'UNUSUALLY_HIGH_RELATIVE_LEVEL');
  assert.equal(r.official_flood_risk, null);
  assert.equal(r.flood_probability, null);
});
test('stale water cannot receive screening', () => {
  const r = evaluateHistory({...gauge, observed_at: kst(now - 6 * HOUR)}, history, now);
  assert.equal(r.status, 'UNAVAILABLE');
});
test('insufficient history does not receive screening', () => {
  const r = evaluateHistory(gauge, history.slice(-50), now);
  assert.equal(r.status, 'UNAVAILABLE');
});
test('a stable station below its historical 90th percentile is descriptive only', () => {
  const r = evaluateHistory({...gauge, water_level_m: 1}, history, now);
  assert.equal(r.screening_level, 'BELOW_HISTORICAL_90TH_PERCENTILE');
  assert.equal(r.official_flood_risk, null);
});

test('flat long-term data must never be flagged unusually high', () => {
  const rows = history.map(r => ({...r, water_level: 1}));
  const r = evaluateHistory({...gauge, water_level_m: 1}, rows, now);
  assert.equal(r.screening_level, 'BELOW_HISTORICAL_90TH_PERCENTILE');
});
