const {test}=require('node:test'),assert=require('node:assert/strict');
const {rainValue,parseAws,requestedRows}=require('../scripts/recover-priority-rainfall');
test('historical AWS parsing requires verified hourly amount, identity, origin and interval',()=>{
 const header='# RN_HR1 RN_HR1_MI';const row='202507171200 181 0 60 42.0 0 11.5 -60 12 -10 60 3 -5 60';
 assert.deepEqual(parseAws(header+'\n'+row,'202507171200','181'),[{at:'2025-07-17 12:00:00',value:11.5}]);
 assert.equal(parseAws(header+'\n'+row.replace('-60','-30'),'202507171200','181').length,0);
 assert.equal(parseAws(header+'\n'+row,'202507171200','152').length,0);
 assert.throws(()=>parseAws(row,'202507171200','181'),/SCHEMA/);
});
test('missing and sentinel rainfall stay missing while authentic zero remains zero',()=>{
 for(const value of [null,undefined,'',' ', '-99',NaN,Infinity,false,true,[],[0],{}])assert.equal(rainValue(value),null);
 assert.equal(rainValue('0.0'),0);
 const gap={from:'2025-07-17 12:00:00',to:'2025-07-17 12:00:00'};
 assert.deepEqual(requestedRows([{at:gap.from,value:0},{at:gap.from,value:null},{at:'2026-01-01 00:00:00',value:1}], [gap]),[{at:gap.from,value:0}]);
});
