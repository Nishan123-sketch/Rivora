'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {grade,enrich}=require('../experimental-risk-grade');
function potential(pct,change,r6,r24){return {station_id:207,status:'EXPERIMENTAL_INDICATORS',level_screening:{status:'EXPERIMENTAL_SCREENING',percentile_rank:pct},observed_conditions:{previous_hour_change_m:change},regional_rainfall:{observed_6h:r6==null?{status:'INCOMPLETE'}:{status:'COMPLETE',rainfall_mm:r6},observed_24h:r24==null?{status:'INCOMPLETE'}:{status:'COMPLETE',rainfall_mm:r24}}};}
test('Low requires both complete rainfall windows',()=>{const x=grade(potential(8.4,0.02,0,0));assert.equal(x.grade,'Low');assert.equal(x.score,0);assert.equal(x.flood_probability,null);});
test('no low with missing rainfall',()=>{const x=grade(potential(8.4,0.02,0,null));assert.equal(x.grade,null);assert.equal(x.status,'PARTIAL_EVIDENCE');});
test('elevated level and observed rapid rise give moderate',()=>{const x=grade(potential(96,.11,0,0));assert.equal(x.grade,'Moderate');assert.equal(x.score,52);});
test('high level + rain + rise yields high grade',()=>{const x=grade(potential(99.2,.35,55,110));assert.equal(x.grade,'High');assert.equal(x.score,100);});
test('missing historical screen is unavailable',()=>{const x=grade({station_id:1,status:'UNAVAILABLE'});assert.equal(x.status,'UNAVAILABLE');assert.equal(x.grade,null);});
test('missing one-hour trend means unavailable',()=>{const x=grade(potential(99,null,50,120));assert.equal(x.reason,'ONE_HOUR_TREND_NOT_AVAILABLE');});
test('partial rain never turns unknown into zero rainfall',()=>{const x=grade(potential(90,.02,null,null));assert.equal(x.grade,null);assert.deepEqual(x.missing,['Complete 6-hour KMA rainfall','Complete 24-hour KMA rainfall']);});
test('all grades remain nonofficial and unvalidated',()=>{const out=enrich({success:true,data:[potential(8.4,0.02,0,0),potential(96,.11,0,0),potential(99.2,.35,55,110)]});assert.deepEqual(out.grade_counts,{Low:1,Moderate:1,High:1});assert(out.data.every(x=>x.experimental_risk.is_official_warning===false&&x.experimental_risk.is_validated_flood_risk===false));});
