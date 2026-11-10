'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {grade}=require('../experimental-risk-grade');
const {display}=require('../hybrid-flood-risk');
const {reduceBulletins}=require('../hrfco-station-bulletins');
const {calculate}=require('../experimental-flood-potential');
const {kstTime}=require('../verified-risk-evidence');

function data(complete){
  return {station_id:207,wamis_code:'2201670',status:'EXPERIMENTAL_INDICATORS',
    observed_at:'2026-11-05 10:00:00',water_level_m:4.79,
    level_screening:{status:'EXPERIMENTAL_SCREENING',percentile_rank:8.4},
    observed_conditions:{previous_hour_change_m:0.02},
    regional_rainfall:{observed_6h:complete?{status:'COMPLETE',rainfall_mm:0}:{status:'INCOMPLETE'},
      observed_24h:complete?{status:'COMPLETE',rainfall_mm:0}:{status:'INCOMPLETE'}}};
}
test('missing rainfall cannot be reported as numerical 0/100 risk',()=>{
  const partial=grade(data(false));
  assert.equal(partial.score,null);
  assert.equal(partial.grade,null);
  assert.equal(partial.status,'PARTIAL_EVIDENCE');
  const row={...data(false),experimental_risk:partial};
  const out=display(row);
  assert.equal(out.label,'Insufficient rainfall evidence');
  assert.equal(out.score,null);
  assert.equal(out.flood_probability,null);
});
test('complete evidence yields experimental low only, never official flood probability',()=>{
  const row=data(true);row.experimental_risk=grade(row);
  const out=display(row);
  assert.equal(out.source,'EXPERIMENTAL_WAMIS_KMA');
  assert.equal(out.grade,'Low');
  assert.equal(out.is_official_warning,false);
  assert.equal(out.model_validation,'NOT_VALIDATED_FOR_FLOOD_EVENTS');
});
test('verified stage takes precedence over experimental high',()=>{
  const row={...data(true),official_risk_basis:'VERIFIED_STAGE',official_flood_risk:'Moderate'};
  row.experimental_risk={status:'EXPERIMENTAL_GRADE',grade:'High',score:100};
  const out=display(row);
  assert.equal(out.source,'VERIFIED_STATION_STAGE');
  assert.equal(out.grade,'Moderate');
  assert.equal(out.score,null);
});
test('stale observations always suppress grades',()=>{
  const row={...data(true),status:'UNAVAILABLE',reason:'WATER_LEVEL_NOT_FRESH',
    experimental_risk:{status:'EXPERIMENTAL_GRADE',grade:'Low',score:0}};
  assert.equal(display(row).grade,null);
});
test('exact HRFCO code matches Taehwa, and cancellation is not a live active warning',()=>{
  const m=reduceBulletins([{station_code:'2201670',issued_at:'2025-07-19 21:00:00',
    action:'CANCEL',severity:'ADVISORY',kind:'홍수주의보 해제',station_name:'울산시(태화교)',bulletin_no:'2025-37'}],
    kstTime('2026-11-05 12:00:00'));
  assert.equal(m.get('2201670').recency,'HISTORICAL_BULLETIN');
  assert.equal(m.get('2201670').is_active_warning,null);
  assert.equal(m.get('2201670').action,'CANCEL');
});
test('same-code AWS hourly rain fills missing ASOS hours, but ASOS wins an exact duplicate',async()=>{
  const now=kstTime('2026-11-05 11:10:00');
  const start=new Date(now-24*3600000);
  const utcToKstString=ms=>new Date(ms+9*3600000).toISOString().slice(0,19).replace('T',' ');
  const aws=[];
  for(let h=0;h<24;h++){
    const ms=now-25*3600000+h*3600000;
    aws.push({aws_station_code:'152',observed_at:utcToKstString(ms),hourly_rainfall:2});
  }
  // Exactly the latest hour is 10:00 KST. Its ASOS value 4 replaces AWS value 2.
  aws.push({aws_station_code:'152',observed_at:'2026-11-05 10:00:00',hourly_rainfall:2});
  const fakeDb={
    query:async q=>{
      if(q.includes('FROM stations s'))return [[{station_id:207,station_name:'Taehwa Bridge',
        external_station_id:'2201670',observed_at:'2026-11-05 10:00:00',water_level:4.79,
        previous_observed_at:'2026-11-05 09:00:00',previous_water_level:4.77,
        verification_status:'UNVERIFIED'}]];
      if(q.includes('FROM stations WHERE latitude'))return [[
        {station_id:207,station_name:'Taehwa Bridge',latitude:35.55,longitude:129.31,data_source:'RIVER_GAUGE',external_station_id:'2201670'},
        {station_id:31,station_name:'Ulsan',latitude:35.54,longitude:129.31,data_source:'KMA',external_station_id:'152'}]];
      throw Error('unexpected SQL query');
    },
    execute:async sql=>{
      if(sql.includes('FROM weather_readings'))return [[{station_id:31,observed_at:'2026-11-05 10:00:00',rainfall:4}]];
      if(sql.includes('FROM aws_rainfall_readings'))return [aws];
      throw Error('unexpected SQL execute');
    }
  };
  const r=await calculate(fakeDb,now,async()=>({data:[{station_id:207,status:'EXPERIMENTAL_SCREENING',
    percentile_rank:80,screening_level:'BELOW_HISTORICAL_90TH_PERCENTILE'}]}));
  const level=r.data[0];
  assert.equal(level.wamis_code,'2201670');
  // 24h input from 11:00 Nov 4 through 10:00 Nov 5; 23*2+4 = 50.
  assert.equal(level.regional_rainfall.observed_24h.status,'COMPLETE');
  assert.equal(level.regional_rainfall.observed_24h.rainfall_mm,50);
  assert.deepEqual(level.regional_rainfall.observed_24h.measurement_sources.sort(),
    ['KMA_ASOS','KMA_AWS_SAME_STATION']);
  assert.equal(level.regional_rainfall.observed_6h.rainfall_mm,14);
});
