import test from 'node:test';
import assert from 'node:assert/strict';
import {floodRiskPresentation} from '../src/lib/floodRiskPresentation.js';

const experimental = grade => ({source:'EXPERIMENTAL_WAMIS_KMA', grade});

test('verified stage is preferred to an experimental result', () => {
  const display = floodRiskPresentation({fresh:true, officialGrade:'High', hybrid:experimental('Low')});
  assert.deepEqual([display.grade,display.method],['High','Verified stage']);
});

test('known experimental Low/Moderate/High grades appear as concise indicators', () => {
  for (const grade of ['Low','Moderate','High']) {
    const display=floodRiskPresentation({fresh:true,hybrid:experimental(grade)});
    assert.equal(display.label,grade);
    assert.equal(display.grade,grade);
    assert.equal(display.method,'Experimental');
  }
});

test('a verified stage from the combined endpoint is recognized', () => {
  const x=floodRiskPresentation({fresh:true,hybrid:{source:'VERIFIED_STATION_STAGE',grade:'Moderate'}});
  assert.equal(x.grade,'Moderate');
  assert.equal(x.method,'Verified stage');
});

test('missing rainfall or a partial screening is not displayed as Low', () => {
  for (const hybrid of [undefined,{source:'DATA_QUALITY',grade:'Low'},{source:'EXPERIMENTAL_WAMIS_KMA',score:0}, {source:'EXPERIMENTAL_WAMIS_KMA',grade:'Not assessed'}]) {
    const x=floodRiskPresentation({fresh:true,hybrid});
    assert.equal(x.grade,null);
    assert.equal(x.label,'No data');
  }
});

test('an outdated observation never retains a grade',()=>{
  const x=floodRiskPresentation({fresh:false,officialGrade:'High',hybrid:experimental('High')});
  assert.equal(x.grade,null);
  assert.equal(x.label,'No data');
});

test('historical warnings cannot automatically create a current grade',()=>{
  const x=floodRiskPresentation({fresh:true,hybrid:{source:'HISTORICAL_HRFCO',grade:'High'}});
  assert.equal(x.grade,null);
  assert.equal(x.label,'No data');
});

test('loading is a distinct interim state',()=>{
  assert.equal(floodRiskPresentation({fresh:true,loading:true}).label,'Loading');
});
