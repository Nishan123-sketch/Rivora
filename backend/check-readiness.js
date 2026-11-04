// Read-only deployment diagnostics; no secrets, emails, hashes, or PII are printed.
require('dotenv').config();
const pool = require('./db');
const {canSendAlertEmail} = require('./email-queue');

async function readiness({db=pool,env=process.env}={}) {
  const info = {
    database: 'NOT VERIFIED',
    kma_stations: null,
    linked_rivers: null,
    verified_gauges: null,
    threshold_verified_gauges: null,
    recent_river_gauges: null,
    recent_weather_stations: null,
    alerts_enabled: env.ENABLE_AUTOMATIC_ALERTS === 'true',
    email_delivery_configured: canSendAlertEmail(env),
    seven_day_forecast: 'NOT IMPLEMENTED - additional official KMA mid-term service required',
    official_warning_feed: 'NOT CONNECTED',
    // Never print any value of an environment credential.
    checks: []
  };
  async function check(name,sql) {
    try { const [rows]=await db.execute(sql);info[name]=Number(rows[0]?.n ?? 0);info.checks.push({check:name,status:'PASSED',meaning:'database query completed'}); }
    catch (e) {info.checks.push({check:name,status:'FAILED',reason:e.code||'database error'});}
  }
  try {
    const [rows]=await db.execute('SELECT DATABASE() AS database_name');
    info.database=rows[0]?.database_name?'CONNECTED':'NOT CONNECTED';
  } catch (e) {info.database='FAILED: '+String(e.code||'database error');return info;}
  await check('kma_stations', "SELECT COUNT(*) AS n FROM stations WHERE data_source='KMA'");
  await check('linked_rivers', "SELECT COUNT(DISTINCT river_id) AS n FROM river_gauge_links WHERE verification_status='VERIFIED'");
  await check('verified_gauges', "SELECT COUNT(DISTINCT station_id) AS n FROM river_gauge_links WHERE verification_status='VERIFIED'");
  await check('threshold_verified_gauges', "SELECT COUNT(*) AS n FROM flood_thresholds WHERE verification_status='VERIFIED' AND interest_level_m IS NOT NULL AND caution_level_m IS NOT NULL AND alert_level_m IS NOT NULL AND severe_level_m IS NOT NULL AND source_url IS NOT NULL AND verified_at IS NOT NULL");
  await check('recent_river_gauges', "SELECT COUNT(DISTINCT station_id) AS n FROM water_readings WHERE observed_at>=DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),INTERVAL 3 HOUR)");
  await check('recent_weather_stations', "SELECT COUNT(DISTINCT station_id) AS n FROM weather_readings WHERE observed_at>=DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),INTERVAL 3 HOUR)");
  return info;
}

if(require.main===module) readiness()
  .then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(e=>{console.error('Readiness check failed:',e.code||'unknown error');process.exitCode=1})
  .finally(()=>pool.end());
module.exports={readiness};
