// Loads YOUR sourced reference data from CSV files into the monitoring tables.
// Nothing is invented: every row needs a real source URL and is checked before it is written.
//   npm run import:reference -- thresholds reference-data/flood_thresholds.csv
//   npm run import:reference -- rainfall    reference-data/station_rainfall_links.csv
//   npm run import:reference -- locations   reference-data/river_locations.csv
//   add --dry-run to validate without writing

const fs = require('fs');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  const [head, ...body] = rows; const keys = (head || []).map(h => h.trim());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
const isUrl = v => { try { return ['http:', 'https:'].includes(new URL(v).protocol) && !/example\.(org|com)/.test(new URL(v).hostname); } catch { return false; } };
const num = v => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN);

function validateThreshold(r) {
  const e = []; const id = num(r.station_id);
  if (!Number.isInteger(id) || id <= 0) e.push('station_id must be a positive integer');
  const lv = ['interest_level_m', 'caution_level_m', 'alert_level_m', 'severe_level_m'].map(k => num(r[k]));
  if (lv.some(Number.isNaN)) e.push('all four levels must be numbers');
  else if (!(lv[0] < lv[1] && lv[1] < lv[2] && lv[2] < lv[3])) e.push('levels must be strictly increasing: interest < caution < alert < severe');
  if (!isUrl(r.source_url)) e.push('source_url must be the real official source (not a placeholder)');
  return { errors: e, value: e.length ? null : [id, ...lv, r.source_url] };
}
function validateRainfall(r) {
  const e = []; const id = num(r.station_id);
  if (!Number.isInteger(id) || id <= 0) e.push('station_id must be a positive integer');
  if (!r.aws_station_code) e.push('aws_station_code is required');
  if (!isUrl(r.reference_url)) e.push('reference_url must be a real source (not a placeholder)');
  return { errors: e, value: e.length ? null : [id, r.aws_station_code, r.reference_url] };
}
function validateLocation(r, knownRivers) {
  const e = []; const lat = num(r.latitude), lon = num(r.longitude);
  if (!r.river_id || (knownRivers && !knownRivers.has(r.river_id))) e.push('river_id is not in the river catalog');
  if (!(lat >= 33 && lat <= 39)) e.push('latitude outside South Korea range 33–39');
  if (!(lon >= 124 && lon <= 132)) e.push('longitude outside South Korea range 124–132');
  if (!isUrl(r.source_url)) e.push('source_url must be a real source (not a placeholder)');
  return { errors: e, value: e.length ? null : [r.river_id, lat, lon, r.source_url] };
}

const SQL = {
  thresholds: `INSERT INTO flood_thresholds (station_id,interest_level_m,caution_level_m,alert_level_m,severe_level_m,source_url,verification_status,verified_at)
    VALUES (?,?,?,?,?,?, 'VERIFIED', NOW()) ON DUPLICATE KEY UPDATE interest_level_m=VALUES(interest_level_m),caution_level_m=VALUES(caution_level_m),
    alert_level_m=VALUES(alert_level_m),severe_level_m=VALUES(severe_level_m),source_url=VALUES(source_url),verification_status='VERIFIED',verified_at=NOW()`,
  rainfall: `INSERT INTO station_rainfall_links (station_id,aws_station_code,reference_url,verification_status) VALUES (?,?,?, 'VERIFIED')
    ON DUPLICATE KEY UPDATE aws_station_code=VALUES(aws_station_code),reference_url=VALUES(reference_url),verification_status='VERIFIED'`,
  locations: `INSERT INTO river_locations (river_id,latitude,longitude,source_url) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),source_url=VALUES(source_url)`,
};

async function run(kind, file, dryRun) {
  if (!SQL[kind] || !file) throw Error('Usage: import:reference -- <thresholds|rainfall|locations> <file.csv> [--dry-run]');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const known = kind === 'locations' ? new Set(require('./river-catalog').catalog.map(r => r.river_id)) : null;
  const check = { thresholds: validateThreshold, rainfall: validateRainfall, locations: r => validateLocation(r, known) }[kind];
  const good = [], bad = [];
  rows.forEach((r, i) => { const v = check(r); (v.errors.length ? bad.push(`row ${i + 2}: ${v.errors.join('; ')}`) : good.push(v.value)); });
  bad.forEach(m => console.error('REJECTED ' + m));
  if (dryRun) return console.log(`${good.length} valid, ${bad.length} rejected (dry run, nothing written)`);
  require('dotenv').config();const pool = require('./db');
  try { for (const v of good) await pool.execute(SQL[kind], v); console.log(`${good.length} written, ${bad.length} rejected`); }
  finally { await pool.end(); }
}
if (require.main === module) {
  const args = process.argv.slice(2).filter(a => a !== '--dry-run');
  run(args[0], args[1], process.argv.includes('--dry-run')).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { parseCsv, validateThreshold, validateRainfall, validateLocation };
