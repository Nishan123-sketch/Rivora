'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {assess,rainfallContext,distanceKm,calculate}=require('../experimental-flood-potential');
const now=Date.UTC(2026,10,4,17,30); // 2026-11-05 02:30 KST
const stamp=ms=>new Date(ms+9*3600000).toISOString().slice(0,19).replace('T',' ');
const gauge={station_id:207,observation_status:'FRESH',observed_at:stamp(now-3600000),water_level_m:4.77,
  observed_conditions:{previous_hour_change_m:0.02}};
const screening=(screening_level)=>({status:'EXPERIMENTAL_SCREENING',screening_level});
const rain=(mm)=>({status:'REGIONAL_PROXY_NOT_CATCHMENT_RAINFALL',observed_6h:{status:'COMPLETE',rainfall_mm:mm},observed_24h:{status:'INCOMPLETE',rainfall_mm:null}});
test('no historical evidence never returns a risk grade',()=>{
 const result=assess(gauge,{status:'UNAVAILABLE',reason:'INSUFFICIENT_HISTORICAL_LEVEL_DATA'},rain(10));
 assert.equal(result.status,'UNAVAILABLE'); assert.equal(result.category,null);assert.equal(result.flood_probability,null);
});
test('high historical level plus rising trend produces multiple evidence signals, not official risk',()=>{
 const result=assess(gauge,screening('UNUSUALLY_HIGH_RELATIVE_LEVEL'),rain(0));
 assert.equal(result.category,'MULTIPLE_ELEVATED_INDICATORS');assert.equal(result.is_official_warning,false);assert.equal(result.official_flood_risk,null);
});
test('no elevated indicator is explicitly not a low-flood-risk grade',()=>{
 const result=assess({...gauge,observed_conditions:{previous_hour_change_m:0}},screening('BELOW_HISTORICAL_90TH_PERCENTILE'),rain(0));
 assert.equal(result.category,'NO_ELEVATED_INDICATORS_DETECTED');assert.equal(result.flood_probability,null);
});
test('stale river data cannot be assessed',()=>{
 assert.equal(assess({...gauge,observation_status:'STALE'},screening('UNUSUALLY_HIGH_RELATIVE_LEVEL'),rain(50)).status,'UNAVAILABLE');
});
test('missing rainfall hours are unknown and never treated as dry',()=>{
 const row={station_id:31,station_name:'Ulsan',distance_km:8};
 const rows=[{observed_at:stamp(now-3600000),rainfall:0}];
 const result=rainfallContext(row,rows,now);
 assert.equal(result.observed_6h.status,'INCOMPLETE');assert.equal(result.observed_6h.rainfall_mm,null);
});
test('complete six-hour hourly observations are summed from source readings',()=>{
 const row={station_id:31,station_name:'Ulsan',distance_km:8};
 const rows=Array.from({length:6},(_,i)=>({observed_at:stamp(now-(i+1)*3600000),rainfall:2}));
 const result=rainfallContext(row,rows,now);
 assert.equal(result.observed_6h.status,'COMPLETE'); assert.equal(result.observed_6h.rainfall_mm,12);
});
test('coordinate distance near zero and missing coordinates',()=>{
 assert.equal(distanceKm(35,129,35,129),0); assert.equal(distanceKm(null,129,35,129),Infinity);
});
