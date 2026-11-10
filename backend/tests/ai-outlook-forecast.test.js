'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseKst,kstString,makeRows,evaluateHorizon}=require('../ai-water-level-outlook');
test('model rain inputs use linked hourly rainfall rather than cumulative weather totals',async()=>{
 const readings=Array.from({length:1000},(_,i)=>({observed_at:kstString(Date.UTC(2026,8,1)+i*3600000),water_level:1+Math.sin(i/30)*.1}));const sqls=[];
 const db={query:async()=>[[]],execute:async(sql)=>{sqls.push(sql);if(sql.includes('FROM stations s'))return [[{station_id:1,station_name:'Test Bridge',external_station_id:'1234567',latitude:37,longitude:127}]];if(sql.includes('FROM water_readings'))return [[...readings].reverse()];if(sql.includes('FROM hr_rainfall_links'))return [[]];if(sql.includes('FROM station_rainfall_links'))return [[{aws_station_code:'95',distance_km:3}]];if(sql.includes('FROM aws_rainfall_readings'))return [readings.map(r=>({observed_at:r.observed_at,rainfall:0}))];throw Error('Unexpected SQL');}};
 const r=await require('../ai-water-level-outlook').analyzeGauge(db,1,parseKst(readings.at(-1).observed_at)+1800000);assert.equal(r.rainfall_context.aws_station_code,'95');assert.ok(sqls.some(s=>s.includes('hourly_rainfall AS rainfall')));assert.ok(!sqls.some(s=>s.includes('FROM weather_readings')));
});
const HOUR=3600000;
const BASE=Date.UTC(2026,8,1,0,0)-9*HOUR;
function series(n=1000){
  const readings=[];
  for(let i=0;i<n;i++){
    readings.push({observed_at:kstString(BASE+i*HOUR),water_level:1+Math.sin(i/34)*0.25+(i/16000)});
  }
  return readings;
}
test('Korean timestamps roundtrip without a host-local timezone shift',()=>{
  assert.equal(kstString(parseKst('2026-09-01 09:00:00')),'2026-09-01 09:00:00');
  assert.equal(parseKst('2026-13-01 09:00:00'),NaN);
});
test('samples use only strictly future target levels and lagged historical observations',()=>{
  const vals=series(70).map(r=>({time:parseKst(r.observed_at),level:r.water_level}));
  const rows=makeRows(vals,new Map(),3);
  assert.equal(rows.length,61);
  assert.equal(rows[0].actual,vals[9].level);
});
for(const horizon of [1,3,6])test(`${horizon}h forecast uses chronological holdout and never claims flood probability`,()=>{
  const readings=series();const now=parseKst(readings.at(-1).observed_at)+HOUR/2;
  const result=evaluateHorizon(readings,[],horizon,now);
  assert.equal(result.forecast_status,'AVAILABLE');
  assert.ok(result.holdout.test_samples>=40);
  assert.ok(result.holdout.validation_samples>=40);
  assert.ok(result.holdout.train_samples>=150);
  assert.ok(Number.isFinite(result.predicted_level_m));
  assert.equal(result.prediction_type,'RIVER_WATER_LEVEL_NOT_FLOOD_PROBABILITY');
  assert.equal(result.validation_status,'CHRONOLOGICAL_HOLDOUT_LEVEL_ONLY');
});
test('outdated river observations cannot produce a forecast',()=>{
  const readings=series();const now=parseKst(readings.at(-1).observed_at)+6*HOUR;
  assert.equal(evaluateHorizon(readings,[],1,now).reason,'STALE_OR_FUTURE_RIVER_LEVEL');
});
test('no sufficient dataset returns unavailable instead of invented forecast',()=>{
  assert.equal(evaluateHorizon(series(10),[],1,Date.now()).forecast_status,'UNAVAILABLE');
});
