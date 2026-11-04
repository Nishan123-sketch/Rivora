
require('dotenv').config();

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
    const values = batch.map(() => '(?, ?, ?, NULL)').join(',');
    const params = batch.flatMap(row => [
      station.station_id,
      row.observedAt,
      row.waterLevel
    ]);
    await pool.execute(
      `INSERT INTO water_readings
         (station_id, observed_at, water_level, flow_rate)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE
         water_level = VALUES(water_level)`,
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
  getActiveGauges
};
