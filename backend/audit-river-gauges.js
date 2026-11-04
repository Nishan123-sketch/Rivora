'use strict';
// Read-only quality audit of the existing river catalog API.
// No WAMIS calls, database writes, migrations, or catalog expansion.
const fs = require('node:fs');
const path = require('node:path');

const API = process.env.RIVER_CATALOG_URL || 'http://localhost:5000/api/river-catalog';
const OUT = path.join(__dirname, 'river-gauge-quality-report.csv');
const STALE_AFTER_HOURS = Number(process.env.RIVER_STALE_HOURS || 3);
const DAM_HINT = /댐|저수지|reservoir|\bdam\b|방수로|조정지/i;

function observedMs(value) {
  // API MySQL DATETIME is a Korean local time without a timezone suffix.
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  if (hour > 23 || minute > 59 || second > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
  // Reject date rollover caused by an invalid calendar day.
  const check = new Date(utc + 9 * 3600000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return utc;
}

function assess(station, nowMs = Date.now()) {
  const issues = [];
  const lat = station.latitude == null || String(station.latitude).trim() === '' ? null : Number(station.latitude);
  const lon = station.longitude == null || String(station.longitude).trim() === '' ? null : Number(station.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 33 || lat > 39.5 || lon < 124 || lon > 132) {
    issues.push('MISSING_OR_INVALID_COORDINATES');
  }
  const timeMs = observedMs(station.latest_observed_at);
  const ageHours = timeMs === null ? null : (nowMs - timeMs) / 3600000;
  if (timeMs === null) issues.push('MISSING_OR_INVALID_TIMESTAMP');
  else if (ageHours < -0.5) issues.push('FUTURE_TIMESTAMP');
  else if (ageHours > STALE_AFTER_HOURS) issues.push('STALE_OBSERVATION');
  const level = station.latest_water_level;
  if (level == null || String(level).trim() === '' || !Number.isFinite(Number(level))) issues.push('MISSING_WATER_LEVEL');
  const stationType = DAM_HINT.test(String(station.station_name || '')) ? 'POSSIBLE_DAM_OR_RESERVOIR' : 'UNCLASSIFIED_RIVER_GAUGE';
  if (stationType === 'POSSIBLE_DAM_OR_RESERVOIR') issues.push('CHECK_GAUGE_DATUM_AND_TYPE');
  if (!/^[0-9]{5,12}$/.test(String(station.external_station_id || ''))) issues.push('INVALID_WAMIS_CODE');
  return { issues, stationType, ageHours };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

async function main() {
  if (!Number.isFinite(STALE_AFTER_HOURS) || STALE_AFTER_HOURS <= 0) throw new Error('RIVER_STALE_HOURS must be positive');
  const response = await fetch(API, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Catalog API returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('Unexpected catalog API response');
  const entries = [];
  const codeToRivers = new Map();
  for (const river of payload.data) {
    for (const station of Array.isArray(river.stations) ? river.stations : []) {
      const code = String(station.external_station_id || '');
      if (!codeToRivers.has(code)) codeToRivers.set(code, new Set());
      codeToRivers.get(code).add(river.river_id);
      entries.push({ river, station, code, check: assess(station) });
    }
  }
  const headers = ['river_id', 'river_name', 'station_id', 'station_name', 'wamis_code', 'observed_at_kst', 'observation_age_hours', 'water_level_m_as_reported', 'latitude', 'longitude', 'station_type_review', 'quality_flags'];
  const rows = [headers.map(csvCell).join(',')];
  const flagged = new Set();
  const times = new Map();
  const typeCounts = { possible_dam_or_reservoir: 0, unclassified_river_gauge: 0 };
  for (const item of entries) {
    const { river, station, code, check } = item;
    const issues = [...check.issues];
    if ((codeToRivers.get(code)?.size || 0) > 1) issues.push('CODE_LINKED_TO_MULTIPLE_RIVERS');
    if (issues.length) flagged.add(station.station_id);
    if (check.stationType === 'POSSIBLE_DAM_OR_RESERVOIR') typeCounts.possible_dam_or_reservoir++;
    else typeCounts.unclassified_river_gauge++;
    const time = station.latest_observed_at || '(missing)';
    times.set(time, (times.get(time) || 0) + 1);
    rows.push([
      river.river_id, river.name_en || river.name_ko, station.station_id, station.station_name,
      code, station.latest_observed_at, check.ageHours == null ? '' : check.ageHours.toFixed(2),
      station.latest_water_level, station.latitude, station.longitude, check.stationType, issues.join(';')
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(OUT, '\uFEFF' + rows.join('\r\n') + '\r\n', 'utf8');
  const multi = [...codeToRivers.entries()].filter(([code, rivers]) => code && rivers.size > 1);
  const popularTime = [...times.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(JSON.stringify({
    status: 'READ_ONLY_AUDIT_COMPLETE', catalog_rivers: payload.candidate_rivers ?? null,
    visible_rivers: payload.data.length, gauge_records: entries.length,
    unique_wamis_codes: [...codeToRivers.keys()].filter(Boolean).length,
    flagged_gauges: flagged.size, duplicate_codes_across_rivers: multi.length,
    most_common_observation_time: popularTime?.[0] ?? null,
    gauges_at_most_common_time: popularTime?.[1] ?? 0,
    ...typeCounts, stale_after_hours: STALE_AFTER_HOURS, csv: OUT,
    notes: ['Possible dam/reservoir is a name-based review flag, not verified gauge classification.',
      'A common hourly timestamp is not itself a failure.',
      'Do not compare absolute water-level measurements across distinct gauges or datum references.']
  }, null, 2));
}
if (require.main === module) main().catch(e => { console.error('[River Audit]', e.message); process.exitCode = 1; });
module.exports = { assess, observedMs };
