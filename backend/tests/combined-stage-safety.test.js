'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCombinedStageSafety } = require('../combined-stage-safety');
const NOW = Date.UTC(2026,10,3,0,0,0);
function input() {
  return {
    station: { station_id: 207, station_name: 'Taehwa Bridge' },
    river: {
      station_id:207,
      latest_observed_at:'2026-11-03 08:00:00',
      latest_water_level:4.86,
      risk_status:'ASSESSED',
      thresholds: { verification_status:'VERIFIED', source_url:'https://example.org/gauge', verified_at:'2026-10-15' }
    },
    floodPrediction: { stage_thresholds_available:true, assessment_status:'ASSESSED' },
    nowMs: NOW
  };
}
test('recent same-gauge verified comparison may be displayed',()=>{
 assert.equal(evaluateCombinedStageSafety(input()).stage_comparison_allowed,true);
});
test('unverified threshold blocks stage assessment',()=>{
 const x=input(); x.river.thresholds.verification_status='PENDING';
 assert.equal(evaluateCombinedStageSafety(x).stage_comparison_allowed,false);
});
test('stale observation blocks stage assessment',()=>{
 const x=input();x.river.latest_observed_at='2026-11-02 20:00:00';
 assert.equal(evaluateCombinedStageSafety(x).stage_comparison_allowed,false);
});
test('dam/reservoir gauge blocks ordinary river-stage assessment',()=>{
 const x=input();x.station.station_name='안동댐';
 assert.equal(evaluateCombinedStageSafety(x).stage_comparison_allowed,false);
});
test('station ID mismatch blocks assessment',()=>{
 const x=input();x.river.station_id=208;
 assert.equal(evaluateCombinedStageSafety(x).stage_comparison_allowed,false);
});
test('flood endpoint must independently report assessed',()=>{
 const x=input();x.floodPrediction.assessment_status='NOT_ASSESSED';
 assert.equal(evaluateCombinedStageSafety(x).stage_comparison_allowed,false);
});
