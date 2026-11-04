const pool=require('./db');
const allowed=new Set(['weather_readings','weather_forecasts']);
async function columnsFor(table){
 if(!allowed.has(table))throw new Error('Unsupported weather table');
 const [rows]=await pool.query(`SHOW COLUMNS FROM ${table}`);
 return new Set(rows.map(row=>row.Field));
}
module.exports={columnsFor};
