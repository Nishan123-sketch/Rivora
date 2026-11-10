'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluatePublishedReferences} = require('../published-stage-reference');
test('Taehwa source disagreement blocks automatic risk', () => {
 const x = evaluatePublishedReferences({station_id:207,wamis_code:'2201670',water_level_m:4.77});
 assert.equal(x.status,'CONFLICTING_PUBLISHED_STAGE_CRITERIA');
 assert.equal(x.verified,false);
 assert.equal(x.risk_level,null);
 assert.deepEqual(x.published_references.map(r=>r.comparison),['BELOW_PUBLISHED_ADVISORY_STAGE','AT_OR_ABOVE_PUBLISHED_ADVISORY_STAGE']);
});
test('Gauge identity mismatch prevents applying Taehwa values elsewhere', () => {
 const x=evaluatePublishedReferences({station_id:1544,wamis_code:'2201670',water_level_m:4.77});
 assert.equal(x.status,'NO_RECONCILED_REFERENCE');
});
test('No invented risk when level is missing',()=>{
 const x=evaluatePublishedReferences({station_id:207,wamis_code:'2201670',water_level_m:null});
 assert.equal(x.risk_level,null);
 assert.equal(x.published_references[0].comparison,'NO_CURRENT_OBSERVATION');
});
