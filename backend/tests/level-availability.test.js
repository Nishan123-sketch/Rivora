'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {stationState,warningEvidence}=require('../level-availability');const {missingWindows}=require('../repair-level-history');
const now=Date.parse('2026-11-08T06:00:00Z');const h={horizon_hours:1,forecast_status:'AVAILABLE',predicted_level_m:0,observed_at:'2026-11-08 14:30:00',valid_at:'2026-11-08 15:30:00'};
test('only an explicitly accepted live horizon counts Ready; a baseline stays separate',()=>{assert.equal(stationState({horizons:[h]},now).status,'BASELINE_ONLY');const s=stationState({horizons:[{...h,advanced_accepted:true}]},now);assert.equal(s.status,'READY');assert.deepEqual(s.ready_horizons,[1]);assert.equal(s.horizons[0].predicted_level_m,0);});
test('expired or missing forecasts never count Ready',()=>{const s=stationState({horizons:[{...h,advanced_accepted:true,valid_at:'2026-11-08 14:59:00'}]},now);assert.equal(s.status,'STALE_INPUT');assert.equal(s.ready_horizons.length,0);assert.equal(s.horizons[0].predicted_level_m,null);assert.equal(stationState({horizons:[]},now).status,'INSUFFICIENT_DATA');});
test('warning evidence reports a one-event calibration deficit without enabling a percentage',()=>{const e=warningEvidence({status:'INSUFFICIENT_VALIDATION_DATA',validation_blocks:{calibration:{events:1},thresholds:{events:2}}});assert.equal(e.requirements.calibration_additional_events,1);assert.equal(e.requirements.threshold_additional_events,0);assert.equal(e.probability_enabled,false);assert.equal(warningEvidence({}).requirements.calibration_events,null);});
test('history requests skip full verified days and remain at most 90 days',()=>{const w=missingWindows('2026-01-01','2026-04-30',new Set(['2026-01-02']));assert.equal(w[0].from,'2026-01-01');assert.equal(w[1].from,'2026-01-03');assert.ok(w.every(x=>x.days<=90));assert.equal(w.reduce((n,x)=>n+x.days,0),119);});

test('sufficient event counts cannot override failed final accuracy gates',()=>{const e=warningEvidence({status:'INDEPENDENT_TEST_ACCEPTANCE_FAILED',probability_available:false,validation_blocks:{calibration:{events:13},thresholds:{events:3}},test:{precision:.01876,event_detection_rate:.90476,brier_score:.0001532},baseline_climatology:{brier_score:.0001491}});assert.equal(e.requirements.calibration_additional_events,0);assert.equal(e.probability_enabled,false);assert.equal(e.acceptance.precision_passed,false);assert.equal(e.acceptance.brier_passed,false);assert.equal(e.acceptance.event_recall_passed,true);});

test('coverage counts intersect the monitored catalog and never count duplicate or unrelated codes',()=>{const {coverageCount}=require('../level-availability');assert.equal(coverageCount([{station_code:'1'},{station_code:'2'}],[{station_code:'1'},{station_code:'1'},{station_code:'outside'}]),1);assert.equal(coverageCount([],[]),0);});

test('accepted evidence stays stable when live advanced forecasts fall back or expire',()=>{
 const {overviewCounts}=require('../level-availability');
 const training={generated_at:'2026-11-08',stations:[{station_id:1,horizons:[{horizon_hours:3,advanced_accepted:true},{horizon_hours:6,advanced_accepted:true}]},{station_id:2,horizons:[{horizon_hours:1,advanced_accepted:true}]}]};
 const rows=[{station_id:1,station_code:'a',level_output_available:true,level_forecast_available:true,ready_horizons:[3,6]},{station_id:2,station_code:'b',level_output_available:true,level_forecast_available:false,ready_horizons:[]}];
 const first=overviewCounts(rows,[],training,{probability_enabled:false});
 const later=overviewCounts(rows.map(r=>({...r,level_forecast_available:false,ready_horizons:[]})),[],training,{probability_enabled:false});
 for(const c of [first,later]){assert.equal(c.accepted_model_stations,2);assert.equal(c.accepted_station_horizon_models,3);assert.equal(c.active_advanced_stations+c.baseline_only,c.level_outputs);assert.equal(c.level_outputs+c.unavailable,c.gauges);}
 assert.equal(first.active_advanced_stations,1);assert.equal(later.active_advanced_stations,0);
});
test('acceptance pairs are deduplicated and constrained to the monitored catalog',()=>{
 const {acceptanceCounts}=require('../level-availability');const station={station_id:1,horizons:[{horizon_hours:3,advanced_accepted:true},{horizon_hours:3,advanced_accepted:true}]};
 const c=acceptanceCounts({stations:[station,station,{...station,station_id:99}]},[{station_id:1}]);assert.equal(c.accepted_model_stations,1);assert.equal(c.accepted_station_horizon_models,1);
 assert.equal(acceptanceCounts(null,[]).accepted_model_stations,null);
});
test('one validated shared warning model is not counted once per eligible gauge',()=>{
 const {overviewCounts}=require('../level-availability');const rows=[1,2].map(id=>({station_id:id,station_code:String(id),level_output_available:false,level_forecast_available:false,warning_forecast_available:true,ready_horizons:[]}));
 const c=overviewCounts(rows,[],{stations:[]},{probability_enabled:true});assert.equal(c.validated_warning_models,1);assert.equal(c.warning_forecast_stations,2);assert.equal(c.unavailable,2);
});
test('a successful status flag cannot override failing warning evidence',()=>{
 const e=warningEvidence({status:'VALIDATED_WARNING_FORECAST',probability_available:true,calibration_method:'Sigmoid',validation_blocks:{calibration:{events:13},thresholds:{events:3}},test:{positive_warning_events:21,precision:.019,event_detection_rate:.9,brier_score:.00015},baseline_climatology:{brier_score:.00014}});
 assert.equal(e.probability_enabled,false);assert.match(e.disabled_reasons.join(' '),/Precision/);assert.match(e.disabled_reasons.join(' '),/Brier/);
});
