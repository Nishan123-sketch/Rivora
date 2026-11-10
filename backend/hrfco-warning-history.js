'use strict';
// HRFCO flood-forecast issuance is real government evidence. This module never
// converts historic notices into a current warning or an official stage threshold.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function parseKoreanTimestamp(value) {
  const x = String(value || '').trim();
  if (!/^\d{12}$/.test(x)) return null;
  const [y,m,d,h,min] = [Number(x.slice(0,4)),Number(x.slice(4,6)),Number(x.slice(6,8)),Number(x.slice(8,10)),Number(x.slice(10,12))];
  const check = new Date(Date.UTC(y,m-1,d,h,min));
  if (check.getUTCFullYear()!==y || check.getUTCMonth()!==m-1 || check.getUTCDate()!==d || check.getUTCHours()!==h || check.getUTCMinutes()!==min) return null;
  return `${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6,8)} ${x.slice(8,10)}:${x.slice(10,12)}:00`;
}
function classifyNotice(kind) {
  const v = String(kind || '');
  const severity = v.includes('경보') ? 'WARNING' : v.includes('주의보') ? 'ADVISORY' : null;
  const action = v.includes('해제') ? 'CANCEL' : v.includes('발령') ? 'ISSUE' : null;
  if (!severity || !action) return null;
  return {severity, action};
}
function normalize(raw) {
  const stationCode=String(raw?.sttnm||'').trim();
  const issuedAt=parseKoreanTimestamp(raw?.ancdt);
  const type=classifyNotice(raw?.kind);
  if (!/^\d{7,15}$/.test(stationCode) || !issuedAt || !type) return null;
  const bulletin=String(raw.no||'').slice(0,120);
  const originalKind=String(raw.kind||'').slice(0,80);
  const id=crypto.createHash('sha256').update([stationCode,issuedAt,originalKind,bulletin].join('|')).digest('hex');
  return {event_id:id,station_code:stationCode,issued_at:issuedAt,...type,kind:originalKind,
    bulletin_no:bulletin,station_name:String(raw.obsnm||'').slice(0,120),
    river_name:String(raw.rvrnm||'').slice(0,120),warning_areas:String(raw.wrnaranm||'').slice(0,1000),
    observed_at:parseKoreanTimestamp(raw.sttcurdt),
    observed_level_m:raw.sttcurhgt!==''&&raw.sttcurhgt!=null&&Number.isFinite(Number(raw.sttcurhgt))?Number(raw.sttcurhgt):null};
}
function normalizeResponse(body) {
  if (!body || !Array.isArray(body.content)) throw new Error('Expected HRFCO JSON response with a content array; code 990 is not a historical archive.');
  const events = body.content.map(normalize).filter(Boolean);
  const unique=[...new Map(events.map(e=>[e.event_id,e])).values()];
  return unique.sort((a,b)=>a.issued_at.localeCompare(b.issued_at));
}
async function setup(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS hr_flood_warning_history (
    event_id CHAR(64) PRIMARY KEY,
    station_code VARCHAR(20) NOT NULL,
    issued_at DATETIME NOT NULL,
    severity VARCHAR(16) NOT NULL,
    action VARCHAR(16) NOT NULL,
    kind VARCHAR(80) NOT NULL,
    bulletin_no VARCHAR(120),
    station_name VARCHAR(120),
    river_name VARCHAR(120),
    warning_areas VARCHAR(1000),
    observed_at DATETIME NULL,
    observed_level_m DECIMAL(10,3) NULL,
    source VARCHAR(64) NOT NULL DEFAULT 'HRFCO_FLOOD_FORECAST_ISSUANCE',
    INDEX idx_hrfco_station_time (station_code, issued_at),
    INDEX idx_hrfco_issued (issued_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
async function importResponse(db, body) {
  const rows=normalizeResponse(body);
  await setup(db);
  for(const r of rows) {
    // Public office archives and the national API can spell bulletin text differently.
    // Match the issuance itself before considering its source-specific hash.
    const [existing]=await db.execute('SELECT event_id FROM hr_flood_warning_history WHERE station_code=? AND issued_at=? AND severity=? AND action=? LIMIT 1',[r.station_code,r.issued_at,r.severity,r.action]);
    if(existing.length)continue;
    await db.execute(`INSERT INTO hr_flood_warning_history
      (event_id,station_code,issued_at,severity,action,kind,bulletin_no,station_name,river_name,warning_areas,observed_at,observed_level_m)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event_id=VALUES(event_id)`,
      [r.event_id,r.station_code,r.issued_at,r.severity,r.action,r.kind,r.bulletin_no,r.station_name,r.river_name,r.warning_areas,r.observed_at,r.observed_level_m]);
  }
  return {records:rows.length,stations:new Set(rows.map(r=>r.station_code)).size,coverage:'SINGLE_HISTORICAL_RESPONSE_NOT_COMPLETE_ARCHIVE'};
}
async function importFile(db, filename) {
  const doc=JSON.parse(await fs.readFile(filename,'utf8'));
  return importResponse(db,doc);
}
async function historyForGauge(db,stationId) {
  const [gauge]=await db.execute(`SELECT station_id,station_name,external_station_id FROM stations
    WHERE station_id=? AND data_source='RIVER_GAUGE' LIMIT 1`,[stationId]);
  if(!gauge.length)return null;
  const [events]=await db.execute(`SELECT DATE_FORMAT(issued_at,'%Y-%m-%d %H:%i:%s') AS issued_at,
    severity, action, kind, bulletin_no, station_name, river_name,warning_areas,
    DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at,observed_level_m
    FROM hr_flood_warning_history WHERE station_code=? ORDER BY issued_at DESC LIMIT 100`,[gauge[0].external_station_id]);
  return {station_id:stationId,wamis_station_code:gauge[0].external_station_id,
    historical_event_count:events.length,events,
    current_official_warning:'NOT_DETERMINED_FROM_HISTORICAL_ARCHIVE',
    historical_coverage:'NOT_VERIFIED_COMPLETE',
    reminder:'An issuance or cancellation from 2025 is not a live 2026 warning. Observed levels in bulletins are NOT advisory thresholds.'};
}
async function main() {
  require('dotenv').config();
  const db=require('./db');
  try {
    const file=process.argv[2]||path.join(__dirname,'data','hrfco-20250719-historical.json');
    console.log(await importFile(db,path.resolve(file)));
  } finally {await db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={parseKoreanTimestamp,classifyNotice,normalize,normalizeResponse,setup,importResponse,importFile,historyForGauge};
