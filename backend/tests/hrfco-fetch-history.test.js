'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validDate,fetchDay}=require('../hrfco-fetch-history');
test('HRFCO date format is strict and calendar-valid',()=>{
  assert.equal(validDate('20250719'),true);
  assert.equal(validDate('202507191100'),false);
  assert.equal(validDate('20250230'),false);
});
test('ambiguous code 990 cannot be reported as zero active flood warnings',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({code:'990'})});
  await assert.rejects(()=>fetchDay('11111111-1111-1111-1111-111111111111','20250719',fetchImpl),/no usable data/);
});
test('a real content array is accepted and a key is required',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({content:[]})});
  const result=await fetchDay('11111111-1111-1111-1111-111111111111','20250719',fetchImpl);
  assert.deepEqual(result,{content:[]});
  await assert.rejects(()=>fetchDay('','20250719',fetchImpl),/HRFCO_SERVICE_KEY/);
});
