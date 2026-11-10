const {test}=require('node:test'),assert=require('node:assert/strict');
const {classifyNotice,normalize}=require('../hrfco-warning-history');
const {futureLabel,currentOfficial,prioritize}=require('../warning-timeline');
const {featureSnapshot}=require('../advanced-ml-features');
const {validateCoverage}=require('../advanced-hrfco-import');
const {validProbability,warningPrediction}=require('../advanced-ml-service');
const {evaluateHorizon,kstString}=require('../ai-water-level-outlook');
const {configuredKey}=require('../hrfco-fetch-history');
const H=3600000,t=Date.parse('2026-11-07T02:00:00+09:00');
const event=(action,severity,h,id='e')=>({action,severity,issued_at:kstString(t+h*H),event_id:id});
const coverage=[{status:'COMPLETE',start_at:kstString(t-24*H),end_at:kstString(t+4*H),initial_state:'NONE',checked_at:new Date(t).toISOString().slice(0,19).replace('T',' ')}];
test('HRFCO configuration supports an official endpoint URL without accepting another host',()=>{
 const fixture='a'.repeat(32);assert.equal(configuredKey(fixture),fixture);
 assert.equal(configuredKey('https://api.hrfco.go.kr/'+fixture+'/fldfct/list/20250719.json'),fixture);
 assert.throws(()=>configuredKey('https://example.com/'+fixture));
});
test('issuance, cancellation and upgrades preserve actual station identity',()=>{
 assert.deepEqual(classifyNotice('홍수주의보 발령'),{action:'ISSUE',severity:'ADVISORY'});
 assert.deepEqual(classifyNotice('홍수경보 해제'),{action:'CANCEL',severity:'WARNING'});
 assert.equal(normalize({sttnm:'wrong',ancdt:'202507191000',kind:'홍수경보 발령'}),null);
 assert.equal(futureLabel([event('CANCEL','WARNING',1)],coverage,t).label,0);
 assert.equal(futureLabel([event('ISSUE','ADVISORY',1)],[],t).label,1);
 assert.equal(futureLabel([],[],t).label,null);
 assert.equal(futureLabel([event('ISSUE','ADVISORY',-1),event('ISSUE','WARNING',1)],coverage,t).label,1);
 assert.equal(futureLabel([event('ISSUE','ADVISORY',-1),event('ISSUE','ADVISORY',1)],coverage,t).label,0);
});
test('target excludes the current instant, includes exactly +3h and cannot invent negatives',()=>{
 assert.equal(futureLabel([event('ISSUE','WARNING',0)],[],t).label,null);
 assert.equal(futureLabel([event('ISSUE','WARNING',3)],[],t).label,1);
 assert.equal(futureLabel([event('ISSUE','WARNING',3.1)],[],t).label,null);
 assert.equal(futureLabel([],[{...coverage[0],end_at:kstString(t+2*H)}],t).label,null);
});
test('historical bulletins cannot become active warnings without fresh complete coverage',()=>{
 const events=[event('ISSUE','WARNING',-2)];assert.equal(currentOfficial(events,[],t).status,'UNKNOWN');
 const currentCoverage=coverage.map(c=>({...c,end_at:kstString(t)}));
 const current=currentOfficial(events,currentCoverage,t);assert.equal(current.level,'High');
 assert.equal(currentOfficial([...events,event('CANCEL','WARNING',-1)],currentCoverage,t).status,'NONE');
 assert.equal(prioritize({official:current,stage:{tier:'A',level:'Low',data_status:'FRESH'}}).source,'Official warning');
 assert.equal(prioritize({official:{status:'UNKNOWN'},stage:{tier:'A',level:'Low',data_status:'STALE'}}).level,null);
 assert.equal(prioritize({warning:{status:'VALIDATED_WARNING_FORECAST',data_quality_status:'FRESH',probability:2,level:'High'}}).level,null);
});
test('coverage cannot be promoted merely by an empty API response',()=>{
 assert.throws(()=>validateCoverage({station_code:'2201670',start_at:kstString(t-H),end_at:kstString(t+H),status:'COMPLETE',source_url:'https://www.hrfco.go.kr/web/openapiPage/reference.do'}));
 assert.throws(()=>validateCoverage({...coverage[0],station_code:'2201670',source_url:'https://example.com',reviewed_complete:true,evidence:'checked'}));
});
test('hourly feature windows exclude future readings and preserve missing rain and true zero',()=>{
 const water=Array.from({length:80},(_,i)=>({observed_at:kstString(t-i*H),water_level:1+i*.001}));
 const rain=Array.from({length:24},(_,i)=>({observed_at:kstString(t-i*H),hourly_rainfall:0}));
 let result=featureSnapshot(water,rain,t,5);assert.equal(result.features.rain_24h,0);assert.equal(result.quality.status,'FRESH');
 result=featureSnapshot(water,[...rain,{observed_at:kstString(t+H),hourly_rainfall:999}],t,5);assert.equal(result.features.rain_24h,0);
 result=featureSnapshot(water,rain.slice(1),t,5);assert.equal(result.features.rain_24h,null);assert.ok(result.quality.issues.includes('INCOMPLETE_RAINFALL_WINDOWS'));
 result=featureSnapshot(water,rain,t+4*H,5);assert.ok(result.quality.issues.includes('STALE_WATER'));
});
test('ten-minute updates use a genuine recent hourly window; expired forecasts remain unavailable',()=>{
 const water=Array.from({length:1000},(_,i)=>({observed_at:kstString(t-(999-i)*H),water_level:1+Math.sin(i/30)*.1}));water.push({observed_at:kstString(t+H/6),water_level:1.02});
 const r=evaluateHorizon(water,[],1,t+H/2);assert.equal(r.forecast_status,'AVAILABLE');assert.equal(r.observed_at,kstString(t));assert.equal(r.valid_at,kstString(t+H));
 assert.equal(evaluateHorizon(water,[],1,t+1.5*H).forecast_status,'UNAVAILABLE');
});
test('a genuine persistence forecast needs a fresh current level, not missing Ridge lag features',()=>{
 const water=Array.from({length:1000},(_,i)=>({observed_at:kstString(t-(999-i)*H),water_level:1+Math.sin(i/30)*.1}));water.push({observed_at:kstString(t+H/6),water_level:1.02});
 // The old whole-hour +1h forecast has expired, but the new ten-minute observation has not.
 const r=evaluateHorizon(water,[],1,t+1.05*H);assert.equal(r.forecast_status,'AVAILABLE');assert.equal(r.model_kind,'PERSISTENCE');assert.equal(r.predicted_level_m,1.02);assert.equal(r.fallback_reason,'CURRENT_LAG_GAPS_PERSISTENCE_BASELINE_USED');
});
test('unvalidated inference never returns a numeric probability',async()=>{
 for(const v of [null,undefined,NaN,-.1,1.1,'0.5'])assert.equal(validProbability(v),false);
 assert.equal(validProbability(0),true);assert.equal(validProbability(1),true);
 const r=await warningPrediction({station_id:207,external_station_id:'2201670'},{quality:{status:'FRESH'}},{status:'UNKNOWN'},{status:'INSUFFICIENT_VALIDATION_DATA',reason:'NO_COMPLETE_WARNING_ARCHIVE_COVERAGE'});
 assert.equal(r.probability,null);assert.equal(r.prediction_value,null);assert.equal(r.status,'INSUFFICIENT_VALIDATION_DATA');
});

test('flood stage outlook calculates proximity and detects below-threshold, advisory crossing and warning crossing', () => {
  const { evaluateFloodStageOutlook } = require('../flood-stage-outlook');
  const station = {
    station_id: 207,
    external_station_id: '2201670',
    threshold_verified: true, measurement_compatibility: {verified:true}, observed_at:'2026-11-09 12:00:00',
    caution_level_m: 8.20,
    alert_level_m: 9.20
  };
  const forecasts = [
    { horizon_hours: 1, forecast_status: 'AVAILABLE', predicted_level_m: 4.50 },
    { horizon_hours: 3, forecast_status: 'AVAILABLE', predicted_level_m: 8.30 },
    { horizon_hours: 6, forecast_status: 'AVAILABLE', predicted_level_m: 9.50 }
  ];
  const current=Date.parse('2026-11-09T12:00:00+09:00');
  const dated=forecasts.map(h=>({...h,observed_at:'2026-11-09 12:00:00',valid_at:'2026-11-09 '+String(12+h.horizon_hours).padStart(2,'0')+':00:00',model_kind:'RIDGE',advanced_accepted:true}));
  const outlook = evaluateFloodStageOutlook(station, dated, current);
  assert.equal(outlook.status, 'ASSESSED');
  assert.equal(outlook.horizons[0].crossing_status, 'BELOW_THRESHOLDS');
  assert.equal(outlook.horizons[0].proximity_to_advisory_m, 3.70);
  assert.equal(outlook.horizons[1].crossing_status, 'PREDICTED_ADVISORY_STAGE_CROSSING');
  assert.equal(outlook.horizons[2].crossing_status, 'PREDICTED_WARNING_STAGE_CROSSING');
  assert.equal(outlook.overall_outlook, 'WARNING_CROSSING_PREDICTED');
});

test('flood stage outlook enforces datum/measurement review hold for Yongdam Bridge and returns NOT_ASSESSED', () => {
  const { evaluateFloodStageOutlook } = require('../flood-stage-outlook');
  const station = {
    station_id: 3009,
    external_station_id: '1022640',
    caution_level_m: 13.70,
    alert_level_m: 18.00
  };
  const forecasts = [
    { horizon_hours: 1, forecast_status: 'AVAILABLE', predicted_level_m: 89.92 }
  ];
  const outlook = evaluateFloodStageOutlook(station, forecasts);
  assert.equal(outlook.status, 'NOT_ASSESSED');
  assert.equal(outlook.reason, 'REFERENCE_OR_MEASUREMENT_REVIEW_REQUIRED');
  assert.equal(outlook.reference_compatibility, 'UNVERIFIED_DATUM_HOLD');
});
