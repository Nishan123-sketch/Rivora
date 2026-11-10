import {test} from 'node:test';import assert from 'node:assert/strict';
import {analysisState,warningPercentage,stageResult} from '../src/lib/mlAnalysisState.js';
test('ML loading, error, empty and ready states stay distinct',()=>{
 assert.equal(analysisState({loading:true,data:null}),'loading');
 assert.equal(analysisState({loading:false,error:'offline'}),'error');
 assert.equal(analysisState({loading:false,data:null}),'empty');
 assert.equal(analysisState({loading:false,data:{station:{}}}),'ready');
});
test('a present measurement with unverified reference is not labelled missing data',()=>{assert.equal(stageResult({water_level:4.62,data_status:'FRESH',measurement_compatibility:{verified:false}}).label,'Comparison not verified');assert.equal(stageResult({water_level:null,data_status:'MISSING'}).label,'Awaiting observation');assert.equal(stageResult({water_level:4,data_status:'STALE'}).label,'Reading out of date');});
test('warning percentage requires a validated finite probability; a real zero is valid',()=>{
 assert.equal(warningPercentage({status:'INSUFFICIENT_VALIDATION_DATA',probability:.9}),'Not available');
 for(const probability of [null,undefined,NaN,-1,2,'0.5'])assert.equal(warningPercentage({status:'VALIDATED_WARNING_FORECAST',probability}),'Not available');
 assert.equal(warningPercentage({status:'VALIDATED_WARNING_FORECAST',probability:0}),'0.0%');
 assert.equal(warningPercentage({status:'VALIDATED_WARNING_FORECAST',probability:.23}),'23.0%');
});
import {warningScopeLabel,stageOutlookLabel} from '../src/lib/mlAnalysisState.js';
import {warningCardState} from '../src/lib/mlAnalysisState.js';
import {networkWarningStationLabel} from '../src/lib/mlAnalysisState.js';
test('warning table labels describe a shared model and preserve scope restrictions',()=>{
 assert.equal(networkWarningStationLabel({warning_forecast_available:false},{probability_enabled:false}),'Network model not validated');
 assert.equal(networkWarningStationLabel({warning_forecast_available:false},{probability_enabled:true}),'Outside validated network scope');
 assert.equal(networkWarningStationLabel({warning_forecast_available:true},{probability_enabled:true}),'Eligible for validated network model');
});

test('complete live inputs cannot turn failed independent validation into a probability',()=>{
 const view=warningCardState({validation_status:'INDEPENDENT_TEST_ACCEPTANCE_FAILED',probability:.9},{status:'FRESH',rainfall_coverage:{required_hours:24,available_hours:24}});
 assert.match(view.headline,/validation failed/);assert.equal(view.inputLabel,'Ready');assert.equal(view.coverageLabel,'24/24 observed rainfall hours');
 assert.match(view.explanation,/Complete current inputs do not validate/);
});
test('the warning card distinguishes missing live inputs from model validation',()=>{
 const view=warningCardState({validation_status:'INDEPENDENT_TEST_ACCEPTANCE_FAILED'},{status:'INCOMPLETE',rainfall_coverage:{required_hours:24,available_hours:23}});
 assert.equal(view.inputLabel,'Incomplete');assert.equal(view.coverageLabel,'23/24 observed rainfall hours');assert.match(view.headline,/validation failed/);
});
test('network warning failure is explicitly separate from station level forecasts',()=>{assert.match(warningScopeLabel('INDEPENDENT_TEST_ACCEPTANCE_FAILED'),/Network-wide warning classifier/);assert.doesNotMatch(warningScopeLabel('INDEPENDENT_TEST_ACCEPTANCE_FAILED'),/station.*failed/i);assert.match(stageOutlookLabel({overall_outlook:'NORMAL'}),/available forecasts/);});
