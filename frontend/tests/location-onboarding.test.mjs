import {test} from 'node:test';import assert from 'node:assert/strict';
import {monitoringDestination} from '../src/lib/auth.js';
test('first login needs onboarding while returning login reuses saved location even with emails off',()=>{
 assert.equal(monitoringDestination([]).page,'Onboarding');
 for(const flood_enabled of [true,false]){const preference={station_id:207,flood_enabled};assert.deepEqual(monitoringDestination([preference]),{page:'Overview Dashboard',preference});}
});
test('changing location selects the newly saved station and invalid preferences cannot select a dashboard',()=>{
 assert.equal(monitoringDestination([{station_id:2912,flood_enabled:false}]).preference.station_id,2912);
 assert.equal(monitoringDestination([{station_id:null}]).page,'Onboarding');
});
