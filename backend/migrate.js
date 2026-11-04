require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');
async function migrate() {
  await require('./setup-monitoring').setup();
  const sql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  // Use the configured DB; never silently change an existing deployment's database.
  for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) {
    if (/^(CREATE DATABASE|USE )/i.test(statement)) continue;
    await pool.query(statement);
  }
  const columns = {
    stations: {external_station_id:'VARCHAR(50) NULL'},
    email_verification_tokens: {created_at:'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'},
    email_notifications: {attempt_count:'INT UNSIGNED NOT NULL DEFAULT 0'},
    weather_readings: {rainfall_day:'DECIMAL(8,2) NULL', hourly_rainfall:'DECIMAL(8,2) NULL', rainfall_method:'VARCHAR(40) NULL',humidity:'DECIMAL(5,2) NULL',wind_speed:'DECIMAL(6,2) NULL'},
    weather_forecasts: {precipitation_probability:'DECIMAL(5,2) NULL',humidity_forecast:'DECIMAL(5,2) NULL',wind_speed_forecast:'DECIMAL(6,2) NULL',precipitation_raw:'VARCHAR(80) NULL',precipitation_min_mm:'DECIMAL(8,2) NULL',precipitation_max_mm:'DECIMAL(8,2) NULL',precipitation_max_exclusive:'TINYINT(1) NULL'},
    river_gauge_links: {source_river_name:'VARCHAR(100) NULL',last_verified_observation_at:'DATETIME NULL',verification_method:'VARCHAR(100) NULL'},
    flood_thresholds: {
      advisory_level_m:'DECIMAL(8,3) NULL', warning_level_m:'DECIMAL(8,3) NULL', danger_level_m:'DECIMAL(8,3) NULL',
      interest_level_m:'DECIMAL(8,3) NULL', caution_level_m:'DECIMAL(8,3) NULL', alert_level_m:'DECIMAL(8,3) NULL', severe_level_m:'DECIMAL(8,3) NULL',
      verification_status:"VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED'", verified_at:'DATETIME NULL',source_url:'VARCHAR(1000) NULL',reference_source:'VARCHAR(255) NULL'
    }
  };
  for(const [table, fields] of Object.entries(columns)) for(const [column, type] of Object.entries(fields)) {
    const [rows] = await pool.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
    if(!rows.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // 'sending' is an intentional non-retry state after an interrupted SMTP call.
  // Existing 'queued', 'sent', 'failed' statuses remain unchanged.
  await pool.query("ALTER TABLE email_notifications MODIFY COLUMN status ENUM('queued','sending','sent','failed') NOT NULL DEFAULT 'queued'");
  // Link only the already user-confirmed WAMIS Taehwa Bridge gauge (2201670).
  await pool.execute(`INSERT INTO river_gauge_links (river_id,station_id,verification_status,reference_url,verified_at,source_river_name,verification_method)
    SELECT 'taehwa', station_id,'VERIFIED',
      'https://www.hrfco.go.kr/sumun/wlpopup.do?obscd=2201670', NOW(), '태화강','EXISTING_VERIFIED_GAUGE'
    FROM stations WHERE data_source='RIVER_GAUGE' AND external_station_id='2201670'
    ON DUPLICATE KEY UPDATE river_id=VALUES(river_id)`);
  console.log('Additive migration complete. Existing data and threshold verification are preserved.');
}
if(require.main===module) migrate().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
module.exports={migrate};
