// Run: node river-network-expand.js
// Incremental official WAMIS discovery: verifies actual recent water-level data
// before promoting an unknown river to the active network.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { fetchStationList, linkVerifiedGauge, dateAgeHours } = require('./river-discovery');
const { getWamis, normalizeStationInfo, mapReadings, koreanDate } = require('./wamis-client');
const { getCatalog, locateRiver, registerRiver } = require('./river-network-registry');

const STATE_PATH = path.join(__dirname, 'wamis-network-expand-state.json');
const CACHE_PATH = path.join(__dirname, 'wamis-gauge-discovery-cache.json');
const MAX_REQUESTS = Math.min(100, Math.max(1, Number(process.env.WAMIS_EXPAND_REQUESTS) || 35));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function saveJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
async function expand() {
  const state = readJson(STATE_PATH, {cursor: null, completed: {}, retry: []});
  const cache = readJson(CACHE_PATH, {stations: {}});
  const [rows] = await pool.execute(`SELECT DISTINCT s.external_station_id AS code FROM river_gauge_links l JOIN stations s ON s.station_id=l.station_id WHERE l.verification_status='VERIFIED'`);
  const linked = new Set(rows.map(r => String(r.code)));
  const candidates = (await fetchStationList()).sort((a, b) => Number(a.obscd) - Number(b.obscd));
  const pending = candidates.filter(r => !linked.has(String(r.obscd)) && !state.completed[String(r.obscd)]);
  const retry = pending.filter(r => state.retry.includes(String(r.obscd)));
  const rest = pending.filter(r => !state.retry.includes(String(r.obscd)));
  const index = state.cursor ? rest.findIndex(r => Number(r.obscd) > Number(state.cursor)) : 0;
  const start = Math.max(0, index);
  const ordered = [...retry, ...rest.slice(start), ...rest.slice(0, start)];
  let requests = 0, newRivers = 0, newLinks = 0, failures = 0, consecutive = 0, examined = 0;
  console.log(`[Network] ${candidates.length} official candidate gauges; ${linked.size} already linked; ${getCatalog().length} catalog entries; resume ${state.cursor || 'start'}`);
  for (const raw of ordered) {
    if (requests >= MAX_REQUESTS || consecutive >= 3) break;
    const code = String(raw.obscd);
    examined++;
    if (!state.retry.includes(code)) state.cursor = code;
    let station = normalizeStationInfo(raw) || cache.stations?.[code]?.station;
    try {
      if (!station) {
        requests++;
        const info = await getWamis('wl_obsinfo', {obscd: code}, 12000);
        station = normalizeStationInfo(info[0]);
      }
      if (!station) {
        state.completed[code] = 'INCOMPLETE_METADATA';
        state.retry = state.retry.filter(x => x !== code);
        consecutive = 0;
        continue;
      }
      // For station names not already catalogued, require valid recent gauge observations.
      const river = locateRiver(station);
      if (river && linked.has(code)) continue;
      if (requests >= MAX_REQUESTS) { state.cursor = code; break; }
      requests++;
      const readings = mapReadings(await getWamis('wl_hrdata', {obscd: code, startdt: koreanDate(2)}, 15000));
      if (!readings.some(r => dateAgeHours(r.observedAt) >= -0.5 && dateAgeHours(r.observedAt) <= 48)) {
        state.completed[code] = 'NO_RECENT_READING';
        consecutive = 0;
        continue;
      }
      const existed = Boolean(river);
      const chosen = river || registerRiver(station);
      if (!chosen) { state.completed[code] = 'INVALID_IDENTITY'; continue; }
      await linkVerifiedGauge(station, chosen, readings);
      linked.add(code);
      state.completed[code] = 'LINKED';
      state.retry = state.retry.filter(x => x !== code);
      if (!existed) newRivers++;
      newLinks++;
      consecutive = 0;
      console.log(`[Network] ${chosen.name_ko} ← ${station.stationName} (${code})${existed ? '' : ' [NEW RIVER]'}`);
    } catch (err) {
      failures++;
      consecutive++;
      if (!state.retry.includes(code)) state.retry.push(code);
      console.warn(`[Network] ${code}: ${err.message} (${consecutive}/3 failures)`);
    } finally {
      saveJson(STATE_PATH, state);
      await sleep(800);
    }
  }
  const summary = {source_candidate_stations:candidates.length, requests, stations_examined:examined, new_rivers:newRivers, new_links:newLinks, catalog_rivers:getCatalog().length, failures, retry_queue:state.retry.length, next_scan_after:state.cursor};
  console.log('[Network] SUMMARY:', JSON.stringify(summary, null, 2));
  return summary;
}
if (require.main === module) expand().catch(e=>{console.error('[Network] ERROR:',e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports={expand};
