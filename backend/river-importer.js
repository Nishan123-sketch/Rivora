
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const pool = require('./db');
const {
  getWamis,
  koreanDate,
  mapReadings
} = require('./wamis-client');

// Prevent overlapping imports within this Node.js process.
let activeImport = null;

async function getActiveGauges() {
  const [rows] = await pool.execute(`
    SELECT DISTINCT
      s.station_id,
      s.station_name,
      s.external_station_id
    FROM stations s
    JOIN river_gauge_links l
      ON l.station_id = s.station_id
    WHERE s.data_source = 'RIVER_GAUGE'
      AND l.verification_status = 'VERIFIED'
    ORDER BY s.station_id
  `);

  return rows;
}

async function importGauge(
  station,
  startDate = koreanDate(2)
) {
  if (!/^\d{8}$/.test(startDate)) {
    throw new Error('Start date must be YYYYMMDD');
  }

  const code = String(station.external_station_id);

  if (!/^\d{5,12}$/.test(code)) {
    throw new Error('Invalid WAMIS gauge ID');
  }

  const readings = mapReadings(
    await getWamis(
      'wl_hrdata',
      {
        obscd: code,
        startdt: startDate
      },
      30000
    )
  );

  let saved = 0;
  let latest = null;

  // Write actual WAMIS records in bounded batches instead of executing a
  // separate SQL request for every hour. Reduces database pressure substantially.
  for (let offset = 0; offset < readings.length; offset += 150) {
    const batch = readings.slice(offset, offset + 150);
    if (!batch.length) continue;
    const values = batch.map(() => '(?, ?, ?, NULL, ?)' ).join(',');
    const params = batch.flatMap(row => [
      station.station_id,
      row.observedAt,
      row.waterLevel,
      `http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata?obscd=${code}&startdt=${startDate}&output=json`
    ]);
    await pool.execute(
      `INSERT INTO water_readings
         (station_id, observed_at, water_level, flow_rate, source_url)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE
         water_level = VALUES(water_level), source_url = VALUES(source_url)`,
      params
    );
    saved += batch.length;
    for (const row of batch) {
      if (!latest || row.observedAt > latest) latest = row.observedAt;
    }
  }

  return {
    station_id: station.station_id,
    code,
    station_name: station.station_name,
    saved,
    latest
  };
}

async function runImport(
  startDate,
  concurrency
) {
  const gauges = await getActiveGauges();

  if (!gauges.length) {
    return {
      gauges: 0,
      saved: 0,
      failed: 0,
      results: [],
      message: 'No verified river gauges linked.'
    };
  }

  const workerCount = Math.max(
    1,
    Math.min(
      2,
      Math.floor(Number(concurrency) || 1),
      gauges.length
    )
  );

  console.log(
    `WAMIS import started: ${gauges.length} gauges; ` +
    `${workerCount} concurrent workers`
  );

  let next = 0;
  let consecutiveFailures = 0;
  let circuitOpened = false;

  const results = new Array(gauges.length);

  async function worker() {
    while (next < gauges.length) {
      // Avoid hundreds of identical retry storms during a WAMIS outage.
      if (circuitOpened) break;
      const index = next++;
      const station = gauges[index];

      try {
        results[index] = await importGauge(
          station,
          startDate
        );
        consecutiveFailures = 0;
      } catch (error) {
        results[index] = {
          station_id: station.station_id,
          code: station.external_station_id,
          saved: 0,
          error: error.message
        };
        consecutiveFailures++;
        if (consecutiveFailures >= 12) {
          circuitOpened = true;
          console.warn('WAMIS unavailable for 12 consecutive stations; ending this import early. The next scheduled run will retry.');
        }
      }
      // Respect public-service capacity even when one gauge returns quickly.
      if (!circuitOpened) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker()
    )
  );

  for (let index = 0; index < gauges.length; index++) {
    if (!results[index]) {
      results[index] = {
        station_id: gauges[index].station_id,
        code: gauges[index].external_station_id,
        saved: 0,
        error: 'SKIPPED_WAMIS_UNAVAILABLE_RETRY_NEXT_RUN'
      };
    }
  }
  const saved = results.reduce((total, result) => total + result.saved, 0);
  const failed = results.filter(result => result.error);

  console.log(
    `WAMIS multi-river import: ` +
    `${gauges.length} gauges; ` +
    `${saved} readings; ` +
    `${failed.length} failures`
  );

  failed.slice(0, 10).forEach(result => {
    console.warn(
      `Gauge ${result.code}: ${result.error}`
    );
  });

  return {
    gauges: gauges.length,
    saved,
    failed: failed.length,
    results
  };
}

function importRiverData(
  startDate = koreanDate(2),
  { concurrency = 1 } = {}
) {
  if (!/^\d{8}$/.test(startDate)) {
    return Promise.reject(
      new Error('Start date must be YYYYMMDD')
    );
  }

  if (activeImport) {
    console.log(
      'WAMIS import already running; reusing active import.'
    );

    return activeImport;
  }

  const job = runImport(startDate, concurrency);

  activeImport = job;

  // Release the lock after success or failure.
  void job.finally(() => {
    if (activeImport === job) {
      activeImport = null;
    }
  }).catch(() => {});

  return job;
}



// The scheduled live sync is deliberately separate from importRiverData(),
// which remains available for historical recovery and manual full imports.
const LIVE_STATE_PATH = path.join(__dirname, 'reports', 'wamis-live-sync-state.json');
let activeLiveBatch = null;

function readLiveState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LIVE_STATE_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.gauges && typeof parsed.gauges === 'object') {
      return parsed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[WAMIS live] Sync checkpoint cannot be read:', error.message);
    }
  }
  return { version: 1, gauges: {} };
}

function saveLiveState(state) {
  fs.mkdirSync(path.dirname(LIVE_STATE_PATH), { recursive: true });
  const temp = `${LIVE_STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
  try {
    fs.renameSync(temp, LIVE_STATE_PATH);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

async function getLiveGauges() {
  // uq_water_station_time (station_id, observed_at) supports each latest lookup.
  const [rows] = await pool.execute(`
    SELECT
      s.station_id,
      s.station_name,
      s.external_station_id,
      (SELECT MAX(w.observed_at)
         FROM water_readings w
        WHERE w.station_id = s.station_id) AS latest_observed_at
    FROM stations s
    WHERE s.data_source = 'RIVER_GAUGE'
      AND s.external_station_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM river_gauge_links l
        WHERE l.station_id = s.station_id
          AND l.verification_status = 'VERIFIED'
      )
    ORDER BY s.station_id
  `);
  return rows.filter(row => /^\d{5,12}$/.test(String(row.external_station_id)));
}

function selectLiveBatch(gauges, state, batchSize, now = Date.now()) {
  const eligible = gauges.filter(gauge => {
    const info = state.gauges[String(gauge.station_id)] || {};
    return !Number.isFinite(info.next_retry_at_ms) || info.next_retry_at_ms <= now;
  });

  // Least recently ATTEMPTED first is fair even during long WAMIS outages.
  // On a tie, attempt the stalest source observation first.
  eligible.sort((a, b) => {
    const la = state.gauges[String(a.station_id)]?.last_attempt_at_ms || 0;
    const lb = state.gauges[String(b.station_id)]?.last_attempt_at_ms || 0;
    if (la !== lb) return la - lb;
    const da = String(a.latest_observed_at || '');
    const db = String(b.latest_observed_at || '');
    if (da !== db) return da.localeCompare(db);
    return Number(a.station_id) - Number(b.station_id);
  });
  return eligible.slice(0, batchSize);
}

async function runLiveBatch({ batchSize, startDate }) {
  if (!/^\d{8}$/.test(startDate)) throw new Error('Start date must be YYYYMMDD');
  const all = await getLiveGauges();
  const state = readLiveState();
  const selected = selectLiveBatch(all, state, batchSize);
  const results = [];

  // The WAMIS client serializes HTTP requests internally, so additional
  // workers would not increase the upstream throughput. Keep a single lane.
  for (const station of selected) {
    const id = String(station.station_id);
    const old = state.gauges[id] || {};
    const started = Date.now();
    let result;
    try {
      result = await importGauge(station, startDate);
      const unsuccessful = result.saved === 0;
      const failures = unsuccessful ? (old.failures || 0) + 1 : 0;
      state.gauges[id] = {
        last_attempt_at_ms: started,
        last_success_at_ms: unsuccessful ? (old.last_success_at_ms || null) : Date.now(),
        last_observed_at: result.latest || old.last_observed_at || null,
        failures,
        next_retry_at_ms: unsuccessful ? Date.now() + 15 * 60 * 1000 : 0,
        last_error: unsuccessful ? 'NO_OBSERVATIONS_RETURNED' : null
      };
      results.push(result);
    } catch (error) {
      const failures = (old.failures || 0) + 1;
      const cooldownMinutes = Math.min(60, 5 * (2 ** Math.min(failures - 1, 4)));
      state.gauges[id] = {
        ...old,
        last_attempt_at_ms: started,
        failures,
        next_retry_at_ms: Date.now() + cooldownMinutes * 60 * 1000,
        last_error: String(error.message).slice(0, 240)
      };
      result = {
        station_id: station.station_id,
        code: String(station.external_station_id),
        saved: 0,
        error: error.message
      };
      results.push(result);
    }
    // Persist after EACH gauge, so interruptions don't restart the same queue.
    try { saveLiveState(state); }
    catch (error) { console.warn('[WAMIS live] Checkpoint write failed:', error.message); }
  }

  const failed = results.filter(row => row.error);
  return {
    gauges: all.length,
    attempted: results.length,
    saved: results.reduce((n, row) => n + row.saved, 0),
    failed: failed.length,
    results,
    state_file: LIVE_STATE_PATH
  };
}

function importRiverBatch({ batchSize = 24, startDate = koreanDate(1) } = {}) {
  if (activeLiveBatch) return activeLiveBatch;
  // Avoid competing with a manually invoked full import in this process.
  if (activeImport) return Promise.resolve({ skipped: true, reason: 'FULL_IMPORT_RUNNING' });
  const safeSize = Math.max(1, Math.min(40, Math.floor(Number(batchSize)) || 24));
  const job = runLiveBatch({ batchSize: safeSize, startDate });
  activeLiveBatch = job;
  void job.finally(() => { if (activeLiveBatch === job) activeLiveBatch = null; }).catch(() => {});
  return job;
}

if (require.main === module) {
  const date = process.argv[2] || koreanDate(2);

  importRiverData(date)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = {
  importRiverData,
  importGauge,
  getActiveGauges,
  getLiveGauges,
  selectLiveBatch,
  importRiverBatch
};
