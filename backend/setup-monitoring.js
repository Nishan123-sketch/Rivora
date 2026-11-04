require('dotenv').config();
const fs=require('fs');const path=require('path');const pool=require('./db');
async function setup(){for(const sql of fs.readFileSync(path.join(__dirname,'../database/monitoring.sql'),'utf8').split(';').map(x=>x.trim()).filter(Boolean))await pool.query(sql);console.log('Monitoring tables ready; existing observations preserved.');}
if(require.main===module)setup().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
module.exports={setup};
