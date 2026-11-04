const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summaries}=require('../monitoring-store');
test('concurrent refreshes share database work and a later refresh reads again',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return [[]];}};
 const a=summaries(db),b=summaries(db);
 assert.equal(a,b);
 assert.deepEqual(await a,[]);
 assert.equal(calls,8);
 await summaries(db);
 assert.equal(calls,16);
});
test('failed refresh is evicted and can recover',async()=>{
 let fail=true;
 const db={query:async()=>{if(fail)throw Error('database unavailable');return [[]];}};
 await assert.rejects(summaries(db),/database unavailable/);
 fail=false;
 assert.deepEqual(await summaries(db),[]);
});
