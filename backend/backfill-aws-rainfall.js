
require('dotenv').config();
const pool = require('./db');

const API_URL =
  'https://apihub.kma.go.kr/api/typ01/url/awsh.php';

const STATION_CODE = '152';
const DAYS = 7;
const HOURS = DAYS * 24;
const DELAY_MS = 1500;
const HOUR_MS = 3600000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function kstTimestamp(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const p = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${p.year}${p.month}${p.day}${p.hour}00`;
}

function mysqlTimestamp(tm) {
  return (
    `${tm.slice(0, 4)}-${tm.slice(4, 6)}-` +
    `${tm.slice(6, 8)} ${tm.slice(8, 10)}:` +
    `${tm.slice(10, 12)}:00`
  );
}

function parseRainfall(value) {
  if (value == null || value === '-' || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : null;
}

async function importHour(tm) {
  const url = new URL(API_URL);

  url.searchParams.set('var', 'RN');
  url.searchParams.set('tm', tm);
  url.searchParams.set('help', '1');
  url.searchParams.set('authKey', process.env.KMA_API_KEY);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.text();

  const line = body.split(/\r?\n/).find(row => {
    const columns = row.trim().split(/\s+/);

    return (
      columns.length >= 14 &&
      columns[0] === tm &&
      columns[1] === STATION_CODE
    );
  });

  if (!line) {
    return 'NO_STATION_DATA';
  }

  const columns = line.trim().split(/\s+/);

  const dailyRainfall = parseRainfall(columns[4]);

  const hourlyRainfall =
    columns[7] === '-60'
      ? parseRainfall(columns[6])
      : null;

  await pool.execute(
    `INSERT INTO aws_rainfall_readings
      (aws_station_code, observed_at,
       hourly_rainfall, daily_rainfall)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       hourly_rainfall = VALUES(hourly_rainfall),
       daily_rainfall = VALUES(daily_rainfall)`,
    [
      STATION_CODE,
      mysqlTimestamp(tm),
      hourlyRainfall,
      dailyRainfall
    ]
  );

  return hourlyRainfall === null
    ? 'MISSING_HOURLY_RAINFALL'
    : 'OK';
}

async function main() {
  if (!process.env.KMA_API_KEY) {
    throw new Error('KMA_API_KEY missing in .env');
  }

 
  // End at two hours before the current hour.
  // Request the preceding seven days of observations.
  const endHour =
    Math.floor(Date.now() / HOUR_MS) * HOUR_MS -
    2 * HOUR_MS;


  const counts = {
    OK: 0,
    MISSING_HOURLY_RAINFALL: 0,
    NO_STATION_DATA: 0,
    FAILED: 0
  };

  console.log(`Starting ${DAYS}-day AWS rainfall backfill`);

  for (let i = HOURS - 1; i >= 0; i--) {
    const date = new Date(endHour - i * HOUR_MS);
    const tm = kstTimestamp(date);

    try {
      const result = await importHour(tm);

      counts[result]++;

      console.log(`${tm}: ${result}`);
    } catch (error) {
      counts.FAILED++;

      console.error(`${tm}: FAILED - ${error.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log('Backfill finished');
  console.log(counts);
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
