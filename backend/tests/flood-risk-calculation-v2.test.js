'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {grade}=require('../experimental-risk-grade');
const {rainfallContext,forecastRainContext}=require('../experimental-flood-potential');
const {evaluateHistory}=require('../experimental-gauge-screening');
const H=3600000;
const at=Date.UTC(2026,10,5,2,15); // 2026-11-05 11:15 KST
function date(ms){return new Date(ms+9*H).toISOString().slice(0,19).replace('T',' ');}
const full=mm=>({status:'COMPLETE',rainfall_mm:mm});
function potential({pct=85,rise1=0,rise3=null,observed3=0,observed6=0,observed12=0,observed24=0,forecast=null}={}) {
  return {station_id:207,status:'EXPERIMENTAL_INDICATORS',
    observed_conditions:{previous_hour_change_m:rise1},
    level_screening:{status:'EXPERIMENTAL_SCREENING',percentile_rank:pct,previous_3_hour_change_m:rise3},
    regional_rainfall:{observed_3h:full(observed3),observed_6h:full(observed6),observed_12h:full(observed12),observed_24h:full(observed24)},
    forecast_rainfall:forecast};
}
test('long-duration rainfall and 3h rises change V2 grade with actual complete data',()=>{
  const old=grade(potential({pct:85,rise1:0}));
  const changed=grade(potential({pct:85,rise1:0,rise3:0.95,observed12:112,observed24:165}));
  assert.equal(old.grade,'Low');
  assert.equal(changed.grade,'Moderate');
  assert.equal(changed.components.rise,20);
  assert.equal(changed.components.long_rainfall,20);
  assert.equal(changed.score,50);
  assert.equal(changed.is_validated_flood_risk,false);
});
test('short overlapping 3h and 6h rainfall windows do not double-count',()=>{
  const r=grade(potential({pct:70,observed3:55,observed6:58}));
  assert.equal(r.components.short_rainfall,25);
  assert.equal(r.score,25);
});
test('complete issued future rainfall contributes limited points but never a probability',()=>{
  const baseline=grade(potential({pct:95,rise1:0,observed6:0,observed24:0}));
  const forecast={status:'COMPLETE',rainfall_min_mm:60,rainfall_max_mm:95};
  const updated=grade(potential({pct:95,rise1:0,observed6:0,observed24:0,forecast}));
  assert.equal(baseline.grade,'Moderate');
  assert.equal(updated.grade,'Moderate');
  assert.equal(updated.score-baseline.score,15);
  assert.equal(updated.flood_probability,null);
});
test('a missing 24h rain window cannot create an apparently safe Low grade',()=>{
  const p=potential({pct:2});p.regional_rainfall.observed_24h={status:'INCOMPLETE',rainfall_mm:null};
  const result=grade(p);assert.equal(result.grade,null);assert.equal(result.score,null);
});
test('KMA forecast uses only data issued before evaluation and preserves rainfall ranges',()=>{
  const kma={station_id:31,station_name:'Ulsan',distance_km:6};
  const start=Math.floor(at/H)*H+H;
  const rows=Array.from({length:6},(_,i)=>({issued_at:date(at-3*H),valid_at:date(start+i*H),
    rainfall_forecast:null,precipitation_min_mm:2,precipitation_max_mm:5}));
  rows.push({issued_at:date(at+H),valid_at:date(start),rainfall_forecast:900});
  const r=forecastRainContext(kma,rows,at);
  assert.equal(r.status,'COMPLETE');assert.equal(r.rainfall_min_mm,12);assert.equal(r.rainfall_max_mm,30);
});
test('missing KMA forecast hour is UNKNOWN, not an assumed dry hour',()=>{
  const start=Math.floor(at/H)*H+H;
  const rows=Array.from({length:5},(_,i)=>({issued_at:date(at-3*H),valid_at:date(start+i*H),rainfall_forecast:0}));
  const r=forecastRainContext({station_id:31},rows,at);
  assert.equal(r.status,'INCOMPLETE');assert.equal(r.rainfall_min_mm,null);
});
test('all observed rainfall durations are calculated from actual hourly records',()=>{
  const station={station_id:31,station_name:'Ulsan',distance_km:4};
  const readings=Array.from({length:24},(_,i)=>({observed_at:date(at-(i+1)*H),rainfall:1}));
  const r=rainfallContext(station,readings,at);
  assert.equal(r.observed_3h.rainfall_mm,3);
  assert.equal(r.observed_6h.rainfall_mm,6);
  assert.equal(r.observed_12h.rainfall_mm,12);
  assert.equal(r.observed_24h.rainfall_mm,24);
});
test('3h river-rise calculation uses exactly matching earlier station observation',()=>{
  const now=at;
  const readings=Array.from({length:800},(_,i)=>({observed_at:date(now-(800-i)*H),water_level:1}));
  const gauge={station_id:207,observed_at:date(now-H),water_level_m:1.8};
  const prior3=readings.find(x=>x.observed_at===date(now-4*H));
  assert(prior3);
  const r=evaluateHistory(gauge,readings,now);
  assert.equal(r.previous_3_hour_change_m,0.8);
});
test('live hybrid input wiring selects matched regional KMA forecast only, never forecast issued in future',async()=>{
  const {calculate}=require('../experimental-flood-potential');
  const recent=date(at-H);
  const start=Math.floor(at/H)*H+H;
  const weather=Array.from({length:24},(_,i)=>({station_id:31,observed_at:date(at-(i+1)*H),rainfall:3}));
  const forecasts=Array.from({length:6},(_,i)=>({station_id:31,issued_at:date(at-H),valid_at:date(start+i*H),
    rainfall_forecast:null,precipitation_min_mm:6,precipitation_max_mm:9}));
  forecasts.push({station_id:31,issued_at:date(at+H),valid_at:date(start),rainfall_forecast:200});
  const fake={
    query: async sql => {
      if(sql.includes('FROM stations s'))return [[{
        station_id:207,station_name:'Taehwa Bridge',external_station_id:'2201670',
        observed_at:recent,water_level:4.7,previous_observed_at:date(at-2*H),previous_water_level:4.5,
        verification_status:'UNVERIFIED'}]];
      if(sql.includes('FROM stations WHERE latitude'))return [[
        {station_id:207,latitude:35.55,longitude:129.30,data_source:'RIVER_GAUGE',external_station_id:'2201670'},
        {station_id:31,latitude:35.54,longitude:129.31,data_source:'KMA',external_station_id:'152'}]];
      throw Error(`Unexpected SQL query: ${sql}`);
    },
    execute:async sql=>{
      if(sql.includes('FROM weather_readings'))return [weather];
      if(sql.includes('FROM aws_rainfall_readings'))return [[]];
      if(sql.includes('FROM weather_forecasts'))return [forecasts];
      throw Error(`Unexpected SQL execute: ${sql}`);
    }
  };
  const result=await calculate(fake,at,async()=>({data:[{station_id:207,status:'EXPERIMENTAL_SCREENING',
    percentile_rank:98,screening_level:'UNUSUALLY_HIGH_RELATIVE_LEVEL',previous_3_hour_change_m:0.55}]}));
  assert.equal(result.data.length,1);
  assert.equal(result.data[0].forecast_rainfall.status,'COMPLETE');
  assert.equal(result.data[0].forecast_rainfall.rainfall_min_mm,36);
  assert.equal(result.data[0].forecast_rainfall.rainfall_max_mm,54);
  assert.equal(result.data[0].regional_rainfall.observed_12h.rainfall_mm,36);
  const gradeResult=grade(result.data[0]);
  assert.equal(gradeResult.grade,'High');
  assert.equal(gradeResult.grade_type,'EXPERIMENTAL_FLOOD_POTENTIAL_V2');
});
