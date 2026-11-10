const test=require('node:test');
const assert=require('node:assert/strict');
const {summarize}=require('../risk-validation-readiness');
test('historical issuance records match exact WAMIS stations but do not prove flood forecast validity',()=>{
 const s=summarize([
  {action:'ISSUE',station_id:207,prior_hourly_readings:24},
  {action:'ISSUE',station_id:null,prior_hourly_readings:0},
  {action:'ISSUE',station_id:1512,prior_hourly_readings:7},
  {action:'CANCEL',station_id:207,prior_hourly_readings:24}]);
 assert.equal(s.warning_issuances,3);
 assert.equal(s.matched_wamis_warning_issuances,2);
 assert.equal(s.issuances_with_minimum_prior_water_levels,1);
 assert.equal(s.sufficient_for_flood_model_validation,false);
 assert.equal(s.calibrated_three_hour_flood_probability_available,false);
});
