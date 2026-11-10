import {test} from 'node:test';import assert from 'node:assert/strict';
import {nearestRegistrationStation,registrationPosition} from '../src/lib/registrationLocation.js';
test('nearest selection ignores an unsourced closer gauge and never filters by a chosen province',()=>{
 const position={coords:{latitude:35.55,longitude:129.3}};
 const stations=[{station_id:1,latitude:35.55,longitude:129.3,coordinate_verified:false},{station_id:207,latitude:35.551,longitude:129.3,coordinate_verified:true,province:'Ulsan'},{station_id:208,latitude:36,longitude:129.3,coordinate_verified:true,province:'Other'}];
 const result=nearestRegistrationStation(position,stations);assert.equal(result.station_id,207);assert.ok(result.distance_km>0&&result.distance_km<1);
 assert.throws(()=>nearestRegistrationStation(position,[]),/No eligible monitoring station/);
 assert.throws(()=>nearestRegistrationStation({coords:{latitude:null,longitude:129}},stations),/valid coordinates/);
});
test('location is requested once on explicit invocation with no cached fixes or tracking',async()=>{
 let calls=0;const fix={coords:{latitude:35.55,longitude:129.3},timestamp:Date.now()};
 const geo={getCurrentPosition(ok,fail,options){calls++;assert.equal(options.maximumAge,0);assert.equal(options.timeout,12000);ok(fix);}};
 assert.equal(calls,0);assert.equal(await registrationPosition(geo),fix);assert.equal(calls,1);
});
test('denied, unavailable and timed-out location requests expose understandable retry errors',async()=>{
 await assert.rejects(registrationPosition(null),/unavailable/);
 for(const code of [1,2,3])await assert.rejects(registrationPosition({getCurrentPosition(ok,fail){fail({code});}}),/denied|unavailable|timed out/);
});
