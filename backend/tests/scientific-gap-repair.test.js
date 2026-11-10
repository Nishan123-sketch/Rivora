const {test}=require('node:test');
const assert=require('node:assert/strict');
const {within}=require('../scripts/repair-scientific-gaps');
test('scientific gap repair retains only finite observations inside the requested pre-2026 gap',()=>{
 const gap={from:'2025-12-31 22:00:00',to:'2026-01-01 01:00:00'};
 const rows=[{at:'2025-12-31 21:00:00',value:1},{at:'2025-12-31 22:00:00',value:0},{at:'2025-12-31 23:00:00',value:NaN},{at:'2026-01-01 00:00:00',value:2}];
 assert.deepEqual(within(rows,gap),[{at:'2025-12-31 22:00:00',value:0}]);
 assert.equal(rows.length,4);
});
