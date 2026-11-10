const fs=require('node:fs');const path=require('node:path');
async function migrate(db=require('./db')){
 await require('./hrfco-warning-history').setup(db);
 const sql=fs.readFileSync(path.join(__dirname,'migrations/advanced-ml.sql'),'utf8').replace(/^--.*$/gm,'');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
}
if(require.main===module){require('dotenv').config();const db=require('./db');migrate(db).then(()=>console.log('Advanced ML tables ready; existing data preserved.')).catch(e=>{console.error(e.code||e.message);process.exitCode=1}).finally(()=>db.end());}
module.exports={migrate};
