
require('dotenv').config();

const pool = require('./db');

const STATION_ID = 207;
const GAUGE_CODE = '2201670';

const API =
  'http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata';

const PERIODS = [
  {
    name: 'July 2025 flood event',
    start: '20250717',
    end: '20250720'
  },
  {
    name: 'August 2025 heavy rain',
    start: '20250803',
    end: '20250804'
  }
];

function convertWamisTime(ymdh) {
  const s = String(ymdh);

  if (!/^\d{10}$/.test(s)) {
    throw new Error('Invalid WAMIS timestamp: ' + s);
  }

  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));

  if (hour < 1 || hour > 24) {
    throw new Error('Invalid WAMIS hour: ' + s);
  }

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Invalid WAMIS date: ' + s);
  }

  if (hour === 24) {
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(0);
  } else {
    date.setUTCHours(hour);
  }

  return date.toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

async function fetchPeriod(period) {
  const url = new URL(API);

  url.searchParams.set('obscd', GAUGE_CODE);
  url.searchParams.set('startdt', period.start);
  url.searchParams.set('enddt', period.end);
  url.searchParams.set('output', 'json');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(
      `WAMIS HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (
    data.result?.code !== 'success' ||
    !Array.isArray(data.list)
  ) {
    throw new Error(
      'Unexpected WAMIS response: ' +
      JSON.stringify(data).slice(0, 300)
    );
  }

  return data.list;
}

async function importPeriod(period) {
  console.log('\nImporting:', period.name);

  const records = await fetchPeriod(period);

  let inserted = 0;
  let existing = 0;
  let invalid = 0;

  // Use a single database connection so each
  // period is committed as a complete unit.
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const record of records) {
      const level = Number(record.wl);

      if (
        record.wl === null ||
        record.wl === undefined ||
        String(record.wl).trim() === '' ||
        !Number.isFinite(level)
      ) {
        invalid++;
        continue;
      }

      const observedAt = convertWamisTime(
        record.ymdh
      );

      const [rows] = await connection.execute(
        `SELECT 1
         FROM water_readings
         WHERE station_id = ?
           AND observed_at = ?
         LIMIT 1`,
        [STATION_ID, observedAt]
      );

      if (rows.length > 0) {
        existing++;
        continue;
      }

      await connection.execute(
        `INSERT INTO water_readings
           (station_id, observed_at, water_level)
         VALUES (?, ?, ?)`,
        [
          STATION_ID,
          observedAt,
          level
        ]
      );

      inserted++;
    }

    await connection.commit();

  } catch (error) {
    await connection.rollback();
    throw error;

  } finally {
    connection.release();
  }

  const result = {
    event: period.name,
    api_records: records.length,
    inserted,
    existing,
    invalid
  };

  console.log(result);

  return result;
}

async function main() {
  console.log(
    'Historical WAMIS import for Taehwa Bridge'
  );

  const results = [];

  for (const period of PERIODS) {
    results.push(await importPeriod(period));
  }

  console.log('\nCOMPLETE');

  console.log(
    JSON.stringify(results, null, 2)
  );

  console.log(
    '\nImportant: Historical water-level ' +
    'measurement datums must be checked ' +
    'before merging years for model training.'
  );
}

main()
  .catch(error => {
    console.error(
      'Historical import failed:',
      error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
