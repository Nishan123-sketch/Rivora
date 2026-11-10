const {test}=require('node:test'),assert=require('node:assert/strict');
const {evaluate:rawEvaluate}=require('../risk-engine');
// Pure fixtures must not inherit live certificates written by background imports.
const evaluate=input=>rawEvaluate({...input,referenceEntries:{}});
const now=Date.parse('2026-11-05T03:00:00Z'),HOUR=3600000;
const kst=t=>new Date(t+9*HOUR).toISOString().slice(0,19).replace('T',' ');
const station={station_id:207,external_station_id:'2201670',station_name:'Taehwa Bridge',data_source:'RIVER_GAUGE'};
const latest={water_level:4,observed_at:kst(now)};
const threshold={interest_level_m:1,caution_level_m:2,alert_level_m:3,severe_level_m:4,verification_status:'VERIFIED',source_url:'https://www.hrfco.go.kr/web/openapiPage/reference.do',verified_at:'2026-11-01',reference_source:'WAMIS:2201670;DATUM:CONFIRMED'};
const history=Array.from({length:366*24},(_,i)=>({observed_at:kst(now-(i+1)*HOUR),water_level:(i%100)/100}));
test('legacy threshold tags do not prove observation datum compatibility',()=>{const r=evaluate({station,latest,threshold,now});assert.equal(r.tier,'C');assert.equal(r.level,null);assert.equal(r.score,null);assert.equal(r.measurement_compatibility.verified,false);});

test('verified gauges retain real trend intervals and never extend beyond the matching window',()=>{
 const before={observed_at:kst(now-80*60000),water_level:3.8};
 const r=evaluate({station,latest,threshold,history:[before],now});
 assert.ok(Math.abs(r.rise_1h-.2)<1e-9);assert.equal(r.rise_interval_1h_minutes,80);
 const missing=evaluate({station,latest,threshold,history:[{...before,observed_at:kst(now-100*60000)}],now});
 assert.equal(missing.rise_1h,null);assert.equal(missing.rise_interval_1h_minutes,null);
});
test('Tier A requires identity and datum confirmation, not just a verified flag',()=>{const r=evaluate({station,latest,threshold:{...threshold,reference_source:'WAMIS:9999999;DATUM:CONFIRMED'},now});assert.equal(r.tier,'C');assert.ok(r.reasons.includes('MEASUREMENT_REFERENCE_NOT_VERIFIED'));});
test('unvalidated historical estimates cannot replace missing verified compatibility',()=>{const r=evaluate({station,latest,history,now});assert.equal(r.tier,'C');assert.equal(r.level,null);assert.equal(r.score,null);});
test('zero is preserved but cannot bypass reference verification',()=>{const reading={...latest,water_level:0};assert.equal(evaluate({station,latest:reading,threshold,now}).level,null);assert.equal(reading.water_level,0);});
test('missing, stale, future and reservoir readings are never assigned a reassuring grade',()=>{for(const options of [{latest:{...latest,water_level:null}},{latest:{...latest,observed_at:kst(now-4*HOUR)}},{latest:{...latest,observed_at:kst(now+HOUR)}},{station:{...station,station_name:'Reservoir dam'}}]){const r=evaluate({station,latest,threshold,history,now,...options});assert.equal(r.tier,'C');assert.equal(r.level,null);assert.equal(r.score,null);}});
test('rain windows preserve true zero and do not fill missing hours',()=>{const rain=Array.from({length:6},(_,i)=>({observed_at:kst(now-i*HOUR),hourly_rainfall:0}));const r=evaluate({station,latest,history,rain,now});assert.equal(r.rain_3h,0);assert.equal(r.rain_6h,0);rain[2].hourly_rainfall=null;assert.equal(evaluate({station,latest,history,rain,now}).rain_3h,null);});
