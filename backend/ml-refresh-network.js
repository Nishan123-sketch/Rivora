'use strict';
// Backward-compatible entry point; training/inference now use saved research artifacts.
require('dotenv').config();const {refresh}=require('./level-pipeline');
if(require.main===module){const db=require('./db');refresh(db).then(r=>console.log(JSON.stringify({status:r.status||'OK',gauges:r.total_gauges,available:r.available}))).catch(e=>{console.error(e.code||e.message);process.exitCode=1}).finally(()=>db.end());}
module.exports={refresh};
