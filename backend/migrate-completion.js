'use strict';
require('dotenv').config();
const pool=require('./db');
async function migrate(db=pool){
 await db.query('ALTER TABLE stations MODIFY latitude DECIMAL(9,6) NULL, MODIFY longitude DECIMAL(9,6) NULL');
 const additions=[['water_readings','source_url','VARCHAR(1000) NULL'],['risk_assessments','evidence_json','JSON NULL'],['station_rainfall_links','distance_km','DECIMAL(9,3) NULL'],['station_rainfall_links','gauge_name','VARCHAR(200) NULL'],['stations','coordinate_source_url','VARCHAR(1000) NULL']];
 for(const [table,column,type] of additions){const [[r]]=await db.execute('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',[table,column]);if(!Number(r.n))await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);}
 await db.query("ALTER TABLE risk_assessments MODIFY risk_score DECIMAL(5,2) NULL, MODIFY risk_level ENUM('Low','Moderate','High','Severe','Unknown') NOT NULL, MODIFY input_observed_at DATETIME NULL");
 await db.query(`CREATE TABLE IF NOT EXISTS water_daily(station_id INT UNSIGNED NOT NULL,day DATE NOT NULL,min_level DOUBLE,max_level DOUBLE,mean_level DOUBLE,samples INT NOT NULL,PRIMARY KEY(station_id,day))`);
 await db.query(`CREATE TABLE IF NOT EXISTS rain_daily(aws_station_code VARCHAR(50) NOT NULL,day DATE NOT NULL,total_mm DOUBLE,samples INT NOT NULL,PRIMARY KEY(aws_station_code,day))`);
 await db.query(`CREATE TABLE IF NOT EXISTS unified_alert_state(station_id INT UNSIGNED PRIMARY KEY,last_observed_at DATETIME,consecutive_high INT NOT NULL DEFAULT 0,below_since DATETIME,last_alert_at DATETIME,active_alert_id BIGINT UNSIGNED NULL)`);
 await db.query(`CREATE TABLE IF NOT EXISTS rainfall_stations(aws_station_code VARCHAR(50) PRIMARY KEY,gauge_name VARCHAR(200) NOT NULL,latitude DECIMAL(9,6) NOT NULL,longitude DECIMAL(9,6) NOT NULL,source_url VARCHAR(1000) NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
 await db.query(`CREATE TABLE IF NOT EXISTS oauth_identities(provider VARCHAR(255) NOT NULL,subject VARCHAR(255) NOT NULL,user_id BIGINT UNSIGNED NOT NULL,PRIMARY KEY(provider,subject),INDEX(user_id)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
 await db.query(require('./reconcile-official-network').SCHEMA);
 console.log('Completion schema ready.');
}
if(require.main===module)migrate().catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports={migrate};
