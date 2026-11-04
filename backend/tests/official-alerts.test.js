const {test}=require('node:test');const assert=require('node:assert/strict');const {parseWarnings}=require('../official-alerts');
test('warning parser requires provider header and preserves area and codes',()=>{
 const rows=parseWarnings('# REG_UP REG_UP_KO REG_ID REG_KO TM_FC TM_EF WRN LVL CMD\n10 울산 101 울산 202611021400 202611021500 R 2 1\n#END');assert.equal(rows[0].area,'울산');assert.equal(rows[0].type,'R');assert.throws(()=>parseWarnings('<html>Error</html>'));assert.throws(()=>parseWarnings('#unknown\n'));
});
