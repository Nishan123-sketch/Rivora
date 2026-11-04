// Verified, source-derived river additions. Never invent names or station codes.
const fs = require('fs');
const path = require('path');
const { catalog: priorities, matchRiver } = require('./river-catalog');
const FILE = path.join(__dirname, 'wamis-river-registry.json');

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').replace(/[()（）]/g, '');
}
function loadRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(r => r && /^wamis_[0-9a-f]+$/.test(r.river_id)) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
function saveRegistry(records) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, FILE);
}
function riverId(name) {
  return `wamis_${Buffer.from(normalizeName(name), 'utf8').toString('hex')}`;
}
function getCatalog() {
  const ids = new Set(priorities.map(r => r.river_id));
  return [...priorities, ...loadRegistry().filter(r => !ids.has(r.river_id))];
}
function locateRiver(station) {
  if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return null;
  const exact = matchRiver(station);
  if (exact) return exact;
  const normalized = normalizeName(station.riverName);
  if (!normalized) return null;
  // A new registry entry is created only after current official readings are verified.
  return getCatalog().find(r => r.river_id.startsWith('wamis_') && normalizeName(r.name_ko) === normalized) || null;
}
function registerRiver(station) {
  const existing = locateRiver(station);
  if (existing) return existing;
  const name = normalizeName(station.riverName);
  if (!name || name.length > 80 || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return null;
  const row = {
    region_id: 'wamis', region: 'WAMIS Nationwide',
    river_id: riverId(name), name_ko: name, name_en: name,
    catalog_source: 'WAMIS_VERIFIED_STATION',
    first_station_code: String(station.code)
  };
  const rows = loadRegistry();
  if (!rows.some(r => r.river_id === row.river_id)) saveRegistry([...rows, row]);
  return row;
}
module.exports = { getCatalog, locateRiver, registerRiver, normalizeName, loadRegistry };
