
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

const {
  getWamis,
  mapReadings
} = require('./wamis-client');

const START_DATE = process.argv[3] || '20260101';
const MODE = process.argv[2] || '--probe';

const BATCH_SIZE = 250;
const REQUEST_DELAY_MS = 5000;
const HOUR_MS = 3600000;

if (
  !['--probe', '--all'].includes(MODE) ||
  !/^\d{8}$/.test(START_DATE)
) {
  console.error(
    'Usage: node backfill-river-history.js --probe 20260101'
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseKst(value) {
  const match = String(value ?? '').match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return NaN;

  const [, y, m, d, h, min, sec] = match.map(Number);

  const ms = Date.UTC(
    y, m - 1, d, h - 9, min, sec
  );

  const check = new Date(ms + 9 * HOUR_MS);

  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== min ||
    check.getUTCSeconds() !== sec
  ) {
    return NaN;
  }

  return ms;
}

function validReading(row) {
  if (
    !row ||
    row.waterLevel === null ||
    row.waterLevel === undefined ||
    row.waterLevel === ''
  ) {
    return false;
  }

  const time = parseKst(row.observedAt);
  const level = Number(row.waterLevel);

  return (
    Number.isFinite(time) &&
    time <= Date.now() + HOUR_MS &&
    Number.isFinite(level)
  );
}

async function getGauges() {
  const [rows] = await pool.execute(`
    SELECT DISTINCT
      s.station_id,
      s.station_name,
      s.external_station_id,
      (
        SELECT COUNT(*)
        FROM water_readings w
        WHERE w.station_id = s.station_id
      ) AS existing_records
    FROM stations s
    JOIN river_gauge_links l
      ON l.station_id = s.station_id
    WHERE s.data_source = 'RIVER_GAUGE'
      AND l.verification_status = 'VERIFIED'
      AND s.external_station_id IS NOT NULL
    ORDER BY existing_records ASC, s.station_id ASC
  `);

  return rows.filter(row =>
    /^\d{5,12}$/.test(
      String(row.external_station_id)
    )
  );
}

async function fetchHistory(station) {
  const raw = await getWamis(
    'wl_hrdata',
    {
      obscd: String(station.external_station_id),
      startdt: START_DATE
    },
    60000
  );

  const mapped = mapReadings(raw);
  const unique = new Map();

  for (const row of mapped) {
    if (!validReading(row)) continue;

    const time = String(row.observedAt)
      .replace('T', ' ');

    unique.set(time, Number(row.waterLevel));
  }

  return [...unique.entries()]
    .map(([observedAt, waterLevel]) => ({
      observedAt,
      waterLevel
    }))
    .sort((a, b) =>
      a.observedAt.localeCompare(b.observedAt)
    );
}

async function saveHistory(stationId, readings) {
  let saved = 0;

  for (
    let start = 0;
    start < readings.length;
    start += BATCH_SIZE
  ) {
    const batch = readings.slice(
      start,
      start + BATCH_SIZE
    );

    const placeholders = batch.map(
      () => '(?, ?, ?, NULL)'
    ).join(',');

    const params = [];

    for (const row of batch) {
      params.push(
        stationId,
        row.observedAt,
        row.waterLevel
      );
    }

    await pool.execute(
      `INSERT INTO water_readings
         (station_id, observed_at, water_level, flow_rate)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         water_level = VALUES(water_level)`,
      params
    );

    saved += batch.length;
  }

  return saved;
}

async function inspectGauge(station, save) {
  const readings = await fetchHistory(station);

  const first = readings[0] || null;
  const last = readings.at(-1) || null;

  const oldestMs = first
    ? parseKst(first.observedAt)
    : NaN;

  const returnedSpanDays =
    first && last
      ? Number((
          (parseKst(last.observedAt) - oldestMs) /
          (24 * HOUR_MS)
        ).toFixed(2))
      : 0;

  const olderThan30Days =
    Number.isFinite(oldestMs) &&
    oldestMs < Date.now() - 30 * 24 * HOUR_MS;

  const saved = save
    ? await saveHistory(station.station_id, readings)
    : 0;

  return {
    station_id: station.station_id,
    station_name: station.station_name,
    wamis_code: String(station.external_station_id),
    existing_records: Number(station.existing_records),
    returned_records: readings.length,
    earliest_returned_at: first?.observedAt || null,
    latest_returned_at: last?.observedAt || null,
    returned_span_days: returnedSpanDays,
    older_than_30_days_available: olderThan30Days,
    saved_records: saved,
    status:
      readings.length === 0
        ? 'NO_DATA_RETURNED'
        : olderThan30Days
          ? 'HISTORICAL_DATA_RETURNED'
          : 'ONLY_RECENT_DATA_RETURNED'
  };
}

async function main() {
  const gauges = await getGauges();

  console.log('WAMIS historical water-level check');
  console.log('Verified linked gauges:', gauges.length);
  console.log('Requested start date:', START_DATE);
  console.log('Mode:', MODE);

  if (!gauges.length) {
    console.log('No verified linked gauges found.');
    return;
  }

  if (MODE === '--probe') {
    // Test three gauges with the least stored history.
    // Probe mode does not change the database.
    const selected = gauges.slice(0, 3);

    for (const station of selected) {
      try {
        const result = await inspectGauge(station, false);

        console.log(
          '\n' + JSON.stringify(result, null, 2)
        );
      } catch (error) {
        console.error(
          'Probe error:',
          station.external_station_id,
          error.message
        );
      }

      await sleep(REQUEST_DELAY_MS);
    }

    console.log(
      '\nProbe completed. No database records were changed.'
    );

    return;
  }

  // Nationwide mode uses a checkpoint so repeated
  // execution does not need to restart all gauges.
  const directory = path.join(__dirname, 'reports');

  fs.mkdirSync(directory, { recursive: true });

  const checkpointPath = path.join(
    directory,
    `wamis-backfill-${START_DATE}-checkpoint.json`
  );

  let checkpoint = {};

  if (fs.existsSync(checkpointPath)) {
    checkpoint = JSON.parse(
      fs.readFileSync(checkpointPath, 'utf8')
    );
  }

  let processed = 0;
  let failed = 0;
  let savedTotal = 0;

  for (const station of gauges) {
    const key = String(station.station_id);

    if (
      checkpoint[key]?.completed === true
    ) {
      continue;
    }

    try {
      const result = await inspectGauge(station, true);

      checkpoint[key] = {
        ...result,
        completed: true,
        processed_at: new Date().toISOString()
      };

      processed++;
      savedTotal += result.saved_records;

      console.log(
        `[${processed}] ${result.station_name}`,
        result.status,
        'records:',
        result.saved_records
      );
    } catch (error) {
      failed++;

      checkpoint[key] = {
        completed: false,
        station_id: station.station_id,
        station_name: station.station_name,
        error: error.message,
        attempted_at: new Date().toISOString()
      };

      console.error(
        'Backfill error:',
        station.station_name,
        error.message
      );
    }

    fs.writeFileSync(
      checkpointPath,
      JSON.stringify(checkpoint, null, 2),
      'utf8'
    );

    await sleep(REQUEST_DELAY_MS);
  }

  const reportPath = path.join(
    directory,
    `wamis-backfill-${START_DATE}-report.json`
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      source: 'WAMIS wl_hrdata',
      requested_start_date: START_DATE,
      total_verified_gauges: gauges.length,
      processed_this_run: processed,
      failed_this_run: failed,
      returned_records_saved_or_updated: savedTotal,
      note:
        'Counts include updates to existing records. ' +
        'They are not counts of newly inserted rows.',
      gauges: checkpoint
    }, null, 2),
    'utf8'
  );

  console.log('\nBackfill completed.');
  console.log('Gauges processed:', processed);
  console.log('Failures:', failed);
  console.log('Rows saved or updated:', savedTotal);
  console.log('Report:', reportPath);
}

main()
  .catch(error => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
