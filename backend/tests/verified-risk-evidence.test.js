'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, coverage, stageEvidence, officialUrl } = require('../verified-risk-evidence');
const HOUR = 3600000;
const kst = t => new Date(t + 9*HOUR).toISOString().slice(0,19).replace('T',' ');
function gauge(overrides={}) {
  return {station_id:207,station_name:'Taehwa Bridge',external_station_id:'2201670',
    observed_at:kst(Date.now()-HOUR),water_level:'3.4',
    interest_level_m:'1.0',caution_level_m:'2.0',alert_level_m:'3.0',severe_level_m:'4.0',
    verification_status:'PENDING',verified_at:null,source_url:null,reference_source:null,...overrides};
}
function verified() { return {verification_status:'VERIFIED',verified_at:'2026-11-03 00:00:00',
  source_url:'https://www.hrfco.go.kr/sumun/waterlevelList.do',
  reference_source:'WAMIS:2201670;DATUM:CONFIRMED'}; }
test('unverified gauge never becomes green Low risk',()=>{
  const result=evaluate(gauge());
  assert.equal(result.assessment_status,'NOT_ASSESSED');
  assert.equal(result.risk_level,null);
  assert.equal(result.official_warning_issued,null);
});
test('source URL must have known official host and specific path',()=>{
  assert.equal(officialUrl('https://evil.example/hrfco.go.kr/'),false);
  assert.equal(officialUrl('https://www.hrfco.go.kr/sumun/waterlevelList.do'),true);
  assert.equal(officialUrl('https://www.hrfco.go.kr/'),false);
});
test('verified flags without matching gauge code or datum cannot classify',()=>{
  assert.equal(stageEvidence(gauge({...verified(),reference_source:'WAMIS:1015640;DATUM:CONFIRMED'})).verified,false);
  assert.equal(stageEvidence(gauge({...verified(),reference_source:'WAMIS:2201670'})).verified,false);
});
test('legacy metadata confirmation does not establish observation reference compatibility',()=>{
  const result=evaluate(gauge(verified()));
  assert.equal(result.assessment_status,'NOT_ASSESSED');
  assert.equal(result.threshold_stage,null);
  assert.equal(result.risk_level,null);
  assert.equal(result.risk_basis,null);
  assert.equal(result.official_warning_status,'NOT_CHECKED');
});
test('stale data and dam names block all stage comparison',()=>{
  assert.equal(evaluate(gauge({...verified(),observed_at:kst(Date.now()-5*HOUR)})).risk_level,null);
  assert.equal(evaluate(gauge({...verified(),station_name:'청평댐'})).risk_level,null);
});
test('coverage counts all gauges even when no station has verified risk',()=>{
  const results=[evaluate(gauge()),evaluate(gauge({station_id:208}))];
  assert.deepEqual([coverage(results).total_gauges,coverage(results).not_assessed],[2,2]);
});

test('fresh successive WAMIS readings show trend without inventing flood grade',()=>{
  const observedAt=kst(Date.now()-HOUR);
  const previousAt=kst(Date.now()-2*HOUR);
  // Avoid non-hour-aligned now comparisons: supplied timestamps are hour-aligned KST strings.
  const prevMs=Date.parse(observedAt.replace(' ','T')+'+09:00')-HOUR;
  const row=gauge({observed_at:observedAt, previous_observed_at:kst(prevMs),previous_water_level:'3.2'});
  const r=evaluate(row);
  assert.equal(r.observed_conditions.water_level_trend,'RISING');
  assert.equal(r.observed_conditions.previous_hour_change_m,0.2);
  assert.equal(r.risk_level,null);
  assert.equal(r.assessment_status,'NOT_ASSESSED');
});

test('missing prior hour cannot be misrepresented as stable',()=>{
  const now=Date.now();
  const observed_at=kst(now-HOUR);
  const prev=kst(Date.parse(observed_at.replace(' ','T')+'+09:00')-2*HOUR);
  const r=evaluate(gauge({observed_at, previous_observed_at:prev,previous_water_level:'3.4'}));
  assert.equal(r.observed_conditions.water_level_trend,'UNKNOWN');
  assert.equal(r.observed_conditions.previous_hour_change_m,null);
});
