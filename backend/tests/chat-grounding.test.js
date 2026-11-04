'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildContext, pickStationIds } = require('../chat-context');
const { monitoringAnswer } = require('../assistant-fallback');

const sampleStations = [
  { station_id: 207, station_name: 'Taehwa River - Ulsan (Taehwa Bridge)', external_station_id: '2201670', data_source: 'RIVER_GAUGE' },
  { station_id: 31, station_name: '울산', external_station_id: '152', data_source: 'KMA' }
];
const sampleLinks = [{ river_id: 'taehwa', station_id: 207 }];

function fakeDb() {
  const calls = [];
  return {
    calls,
    async execute(sql, args) {
      calls.push({ sql, args });
      if (sql.includes('FROM stations')) return [sampleStations];
      if (sql.includes('FROM river_gauge_links')) return [sampleLinks];
      if (sql.includes('FROM water_readings')) {
        if (sql.includes('observed_at=?')) return [[]];
        return [[{ observed_at: '2026-11-03 12:00:00', water_level: '0.000', flow_rate: null }]];
      }
      if (sql.includes('FROM weather_readings')) return [[]];
      if (sql.includes('FROM station_rainfall_links')) return [[]];
      if (sql.includes('FROM aws_rainfall_readings')) return [[]];
      if (sql.includes('FROM prediction_history')) return [[]];
      if (sql.includes('FROM weather_forecasts')) return [[]];
      if (sql.includes('FROM flood_thresholds')) return [[{ verification_status: 'PENDING', alert_level_m: '5.0' }]];
      return [[]];
    }
  };
}

test('river name and provider code resolve to verified WAMIS station, no invented station', () => {
  assert.deepEqual(pickStationIds('Taehwa River water level', null, [], sampleStations, sampleLinks), [207]);
  assert.deepEqual(pickStationIds('WAMIS 2201670 water level', null, [], sampleStations, sampleLinks), [207]);
  assert.deepEqual(pickStationIds('UnknownRiver 987654', null, [], sampleStations, sampleLinks), []);
});

test('grounded assistant preserves genuine zero and refuses unverified flood thresholds', async () => {
  const db = fakeDb();
  const context = await buildContext('Taehwa Bridge flood risk', 207, [], db);
  assert.deepEqual(context.selected_station_ids, [207]);
  assert.equal(context.stations[0].latest_water[0].water_level, 0);
  assert.equal(context.stations[0].threshold_status, 'UNVERIFIED_OR_UNAVAILABLE');
  const answer = monitoringAnswer('Taehwa Bridge flood risk', context);
  assert.match(answer, /0 m/);
  assert.match(answer, /Unverified\/unavailable/);
  assert.doesNotMatch(answer, /safe to travel|no flooding risk/i);
  assert.ok(db.calls.every(call => !/FROM (users|email_notifications|user_alert_preferences)/i.test(call.sql)));
});

test('exact-time request never uses latest observations to fabricate historical measurement', async () => {
  const context = await buildContext('Taehwa Bridge level at 2026-11-02 14:00', 207, [], fakeDb());
  assert.equal(context.stations[0].observations_at_requested_time.water, null);
  const answer = monitoringAnswer('level at that hour', context);
  assert.match(answer, /No observation or stored forecast matches that exact hour/);
  assert.doesNotMatch(answer, /0 m/);
});

test('stationless context provides confirmed network counts without location guesses', async () => {
  const context = await buildContext('How many gauges are monitored?', null, [], fakeDb());
  assert.deepEqual(context.selected_station_ids, []);
  const answer = monitoringAnswer('How many gauges are monitored?', context);
  assert.match(answer, /1 verified linked gauges/);
  assert.match(answer, /not proof of live data/);
});
