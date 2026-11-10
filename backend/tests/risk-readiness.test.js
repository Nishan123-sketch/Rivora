'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {summarize}=require('../risk-readiness');
const NOW=Date.parse('2026-11-05T02:00:00Z');
const base={station_id:207,wamis_code:'2201670',observed_at:'2026-11-05 10:00:00',observation_status:'FRESH',stage_evidence_verified:false,stage_evidence_reason:'OFFICIAL_STAGES_NOT_VERIFIED'};
test('fresh observation does not imply verified flood-stage risk',()=>{
  const out=summarize([base],{gauges:{}},NOW);
  assert.equal(out.counts.fresh,1);assert.equal(out.counts.missing_stage,1);
  assert.equal(out.counts.verified_stage,0);assert.equal(out.stale_or_missing_gauges.length,0);
});
test('recent upstream attempt with stale reading is identified separately',()=>{
  const out=summarize([{...base,observation_status:'STALE'}],{gauges:{207:{last_attempt_at_ms:NOW-1800000,last_error:'UPSTREAM_DELAY'}}},NOW);
  assert.equal(out.counts.recent_attempt_but_old_observation,1);
  assert.equal(out.stale_or_missing_gauges[0].importer_error,'UPSTREAM_DELAY');
});
test('missing attempt gets honest importer diagnostic',()=>{
  const out=summarize([{...base,observation_status:'MISSING',observed_at:null}],{gauges:{}},NOW);
  assert.equal(out.counts.no_recent_attempt,1);
  assert.equal(out.stale_or_missing_gauges[0].diagnosis,'IMPORT_NOT_ATTEMPTED_RECENTLY');
});
