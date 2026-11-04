// Resolves the project's default stations by their provider codes, never by
// auto-increment database IDs (which differ between installations).
const pool = require('./db');

const KMA_EXTERNAL_ID = '152';        // KMA Ulsan
const RIVER_EXTERNAL_ID = '2201670';  // WAMIS Taehwa Bridge

async function findStation(dataSource, externalId, nameHints) {
  const [byCode] = await pool.query(
    `SELECT station_id, station_name, external_station_id
     FROM stations WHERE data_source = ? AND external_station_id = ? LIMIT 1`,
    [dataSource, externalId]
  );
  if (byCode.length) return byCode[0];
  for (const hint of nameHints) {
    const [byName] = await pool.query(
      `SELECT station_id, station_name, external_station_id
       FROM stations WHERE data_source = ? AND station_name LIKE ? LIMIT 1`,
      [dataSource, `%${hint}%`]
    );
    if (byName.length) return byName[0];
  }
  return null;
}

const findUlsanKma = () => findStation('KMA', KMA_EXTERNAL_ID, ['울산', 'Ulsan']);
const findTaehwaRiver = () => findStation('RIVER_GAUGE', RIVER_EXTERNAL_ID, ['태화', 'Taehwa']);

module.exports = { findUlsanKma, findTaehwaRiver, KMA_EXTERNAL_ID, RIVER_EXTERNAL_ID };
