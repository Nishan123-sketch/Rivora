
require('dotenv').config();
const pool = require('./db');

const STATION_ID = 207;
const CODE = '2201670';
const API = 'http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata';

function wamisTime(value) {
  const s = String(value);

  if (!/^\d{10}$/.test(s)) return null;

  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));

  if (hour < 1 || hour > 24) return null;

  const d = new Date(Date.UTC(
    year, month - 1, day
  ));

  if (hour === 24) {
    d.setUTCDate(d.getUTCDate() + 1);
  } else {
    d.setUTCHours(hour);
  }

  return d.toISOString().slice(0, 19)
    .replace('T', ' ');
}

async function main() {
  const url = new URL(API);
  url.searchParams.set('obscd', CODE);
  url.searchParams.set('startdt', '20261031');
  url.searchParams.set('enddt', '20261101');
  url.searchParams.set('output', 'json');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`WAMIS HTTP ${response.status}`);
  }

  const data = await response.json();

  if (
    data.result?.code !== 'success' ||
    !Array.isArray(data.list)
  ) {
    throw new Error('Invalid WAMIS response');
  }

  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s')
         AS observed_at,
       water_level
     FROM water_readings
     WHERE station_id = ?
       AND observed_at >= '2026-10-31'
       AND observed_at < '2026-11-02 01:00:00'`,
    [STATION_ID]
  );

  const database = new Map(
    rows.map(r => [
      r.observed_at,
      Number(r.water_level)
    ])
  );

  const comparison = [];

  for (const item of data.list) {
    const time = wamisTime(item.ymdh);
    const apiValue = Number(item.wl);

    if (!time || item.wl == null ||
        String(item.wl).trim() === '' ||
        !Number.isFinite(apiValue)) continue;

    const dbValue = database.get(time);

    comparison.push({
      observed_at: time,
      wamis_m: apiValue,
      database_m: dbValue ?? null,
      difference_m: dbValue === undefined
        ? null
        : Number((dbValue - apiValue).toFixed(3))
    });
  }

  const mismatches = comparison.filter(
    r => r.difference_m !== null &&
      Math.abs(r.difference_m) > 0.001
  );

  console.log(JSON.stringify({
    gauge_code: CODE,
    compared_records: comparison.length,
    database_mismatches: mismatches.length,
    api_min_m: comparison.length
      ? Math.min(...comparison.map(r => r.wamis_m))
      : null,
    api_max_m: comparison.length
      ? Math.max(...comparison.map(r => r.wamis_m))
      : null,
    examples: comparison.slice(-10),
    mismatches: mismatches.slice(0, 10),
    conclusion:
      'Matching 2026 values confirm database consistency ' +
      'with WAMIS, but do not prove the water-level datum ' +
      'is unchanged between 2025 and 2026.'
  }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => pool.end());
