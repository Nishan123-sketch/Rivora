const {test}=require('node:test');const assert=require('node:assert/strict');
const {number,stage,fresh,dateRange,history}=require('../monitoring-store');
test('nulls, zero, stale data and sourced thresholds remain distinct',()=>{
 assert.equal(number(null),null);assert.equal(number(0),0);assert.equal(stage(4,{}),null);assert.equal(fresh('2020-01-01 00:00:00'),false);
 const t={interest_level_m:1,caution_level_m:2,alert_level_m:3,severe_level_m:4,verification_status:'VERIFIED',source_url:'official',verified_at:'2026-01-01'};
 assert.equal(stage(0,t),'Low');assert.equal(stage(2,t),'Moderate');assert.equal(stage(3,t),'High');assert.equal(stage(null,t),null);
});
test('history validates dates, uses bound parameters and includes weather/risks',async()=>{
 assert.throws(()=>dateRange({start:'2026-02-30'}));assert.throws(()=>dateRange({start:'2026-11-02',end:'2026-11-01'}));
 const calls=[];const db={execute:async(sql,args)=>{calls.push({sql,args});return [[]]}};
 const data=await history('31',{start:'2025-07-17',end:'2025-07-20'},db);assert.equal(data.success,true);assert.equal(calls.length,5);assert.equal(calls[0].args[2],'31');assert.ok(calls[1].sql.includes('weather_readings'));
});
