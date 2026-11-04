require('dotenv').config();
const pool = require('./db');
const fields = {
  precipitation_probability: 'DECIMAL(5,2) NULL',
  humidity_forecast: 'DECIMAL(5,2) NULL',
  wind_speed_forecast: 'DECIMAL(7,2) NULL'
};
async function run() {
  for (const [field, definition] of Object.entries(fields)) {
    const [rows] = await pool.execute(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='weather_forecasts' AND COLUMN_NAME=?`, [field]);
    if (!Number(rows[0].n)) { await pool.query(`ALTER TABLE weather_forecasts ADD COLUMN ${field} ${definition}`); console.log('Added', field); }
  }
  console.log('Forecast fields ready');
}
if (require.main === module) run().catch(e => {console.error(e.message); process.exitCode=1}).finally(()=>pool.end());
module.exports={run};
