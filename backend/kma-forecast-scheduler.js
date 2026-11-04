const INTERVAL_MS = 60 * 60 * 1000;

// Default: update a limited rotating batch of cities hourly. All other KMA
// stations can still be imported on demand from Weather & Forecast.
// Explicit KMA_FORECAST_STATION_IDS overrides the auto-discovered catalog.
function createForecastScheduler({
  db,
  importForecast,
  findDefault,
  getConfiguredIds = () => process.env.KMA_FORECAST_STATION_IDS || '',
  batchSize = 8,
  logger = console
} = {}) {
  db ??= require('./db');
  importForecast ??= require('./import-kma-forecast').importKmaForecast;
  let running = false;
  let nextIndex = 0;
  const batchLimit = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 8;

  async function runKmaForecastImport() {
    if (running) return { skipped: true };
    running = true;
    try {
      const configured = String(getConfiguredIds()).split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isSafeInteger(id) && id > 0);
      let ids;
      if (configured.length) {
        ids = [...new Set(configured)];
      } else {
        findDefault ??= require('./station-defaults').findUlsanKma;
        const [rows] = await db.execute(
          "SELECT station_id FROM stations WHERE data_source = 'KMA' ORDER BY station_id"
        );
        ids = [...new Set(rows.map(row => Number(row.station_id))
          .filter(id => Number.isSafeInteger(id) && id > 0))];
        const ulsan = await findDefault();
        const defaultId = Number(ulsan?.station_id);
        if (Number.isSafeInteger(defaultId) && ids.includes(defaultId)) {
          ids = [defaultId, ...ids.filter(id => id !== defaultId)];
        }
      }
      if (!ids.length) return { attempted: 0, succeeded: 0 };
      nextIndex %= ids.length;
      const batch = Array.from({ length: Math.min(ids.length, batchLimit) }, (_, i) =>
        ids[(nextIndex + i) % ids.length]
      );
      nextIndex = (nextIndex + batch.length) % ids.length;
      let succeeded = 0;
      for (const id of batch) {
        try { await importForecast(id); succeeded++; }
        catch (error) { logger.error('[KMA forecast]', id, error.message); }
      }
      return { attempted: batch.length, succeeded };
    } catch (error) {
      logger.error('[KMA forecast scheduler]', error.message);
      return { attempted: 0, succeeded: 0, error: true };
    } finally {
      running = false;
    }
  }

  return { runKmaForecastImport };
}

let defaultScheduler;
function getDefaultScheduler() {
  defaultScheduler ??= createForecastScheduler();
  return defaultScheduler;
}
function startKmaForecastScheduler() {
  const runner = getDefaultScheduler();
  runner.runKmaForecastImport();
  return setInterval(runner.runKmaForecastImport, INTERVAL_MS);
}
module.exports = {
  startKmaForecastScheduler,
  runKmaForecastImport: () => getDefaultScheduler().runKmaForecastImport(),
  createForecastScheduler
};
