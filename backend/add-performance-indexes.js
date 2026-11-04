// Adds indexes that make date-range and "latest reading" queries fast.
// Safe to re-run: an index is only created when it does not exist yet. Never changes data.
// Run once:  npm run optimize:db      (on big tables each index can take a minute or more)
require('dotenv').config();
const pool = require('./db');

const INDEXES = [
  ['weather_readings',       'idx_weather_observed',   '(observed_at)'],
  ['water_readings',         'idx_water_observed',     '(observed_at)'],
  ['aws_rainfall_readings',  'idx_aws_observed',       '(observed_at)'],
  ['prediction_history',     'idx_prediction_station_observed', '(station_id, observed_at)'],
  ['risk_assessments',       'idx_risk_assessed',      '(assessed_at)'],
  ['stations',               'idx_stations_source_ext','(data_source, external_station_id)'],
  ['river_gauge_links',      'idx_links_station',      '(station_id)'],
];

async function run() {
  for (const [table, name, cols] of INDEXES) {
    try {
      const [[t]] = await pool.query(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [table]);
      if (!t.n) { console.log(`skip   ${table} (table not found)`); continue; }
      const [[i]] = await pool.query(
        'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?', [table, name]);
      if (i.n) { console.log(`exists ${table}.${name}`); continue; }
      console.log(`create ${table}.${name} ${cols} ...`);
      await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` ${cols}`);
      await pool.query(`ANALYZE TABLE \`${table}\``);
      console.log('  done');
    } catch (e) {
      console.error(`FAILED ${table}.${name}: ${e.code || ''} ${e.message}`);
    }
  }
}
if (require.main === module) run().finally(() => pool.end());
module.exports = { run, INDEXES };
