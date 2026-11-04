
require('dotenv').config();

const pool = require('./db');

const STATION_ID = 207;
const HOUR_MS = 3600000;

const EVENTS = [
  {
    name: 'July 2025 reported flood',
    start: '2025-07-17 01:00:00',
    end: '2025-07-21 01:00:00',
    classification: 'REGIONAL_FLOOD_REPORTED'
  },
  {
    name: 'August 2025 heavy rain',
    start: '2025-08-03 01:00:00',
    end: '2025-08-05 01:00:00',
    classification: 'REGIONAL_HEAVY_RAIN_REPORTED'
  }
];

function number(value) {
  if (value === null || value === undefined ||
      value === '') return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value) {
  return value === null
    ? null
    : Number(value.toFixed(3));
}

function parseTime(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return NaN;

  return Date.UTC(
    +match[1], +match[2] - 1, +match[3],
    +match[4], +match[5], +match[6]
  ) - 9 * HOUR_MS;
}

async function loadEvent(event) {
  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         observed_at, '%Y-%m-%d %H:%i:%s'
       ) AS observed_at,
       water_level
     FROM water_readings
     WHERE station_id = ?
       AND observed_at >= ?
       AND observed_at < ?
       AND water_level IS NOT NULL
     ORDER BY observed_at ASC`,
    [STATION_ID, event.start, event.end]
  );

  return rows.map(row => ({
    time: row.observed_at,
    timestamp: parseTime(row.observed_at),
    level: number(row.water_level)
  })).filter(row =>
    Number.isFinite(row.timestamp) &&
    row.level !== null
  );
}

function calculateRise(rows, hours) {
  const byTime = new Map(
    rows.map(row => [row.timestamp, row])
  );

  let biggestRise = null;
  let biggestFall = null;
  let validPairs = 0;

  for (const current of rows) {
    const previous = byTime.get(
      current.timestamp - hours * HOUR_MS
    );

    if (!previous) continue;

    // An exact elapsed-time match is required.
    // Missing hours are never treated as zero.
    validPairs++;

    const change = current.level - previous.level;

    const result = {
      from: previous.time,
      to: current.time,
      change_m: round(change),
      starting_level_m: previous.level,
      ending_level_m: current.level
    };

    if (
      biggestRise === null ||
      change > biggestRise.change_m
    ) {
      biggestRise = result;
    }

    if (
      biggestFall === null ||
      change < biggestFall.change_m
    ) {
      biggestFall = result;
    }
  }

  return {
    hours,
    valid_pairs: validPairs,
    maximum_change_m: biggestRise,
    minimum_change_m: biggestFall
  };
}

function analyzeEvent(event, rows) {
  const expectedHours = Math.round(
    (parseTime(event.end) -
      parseTime(event.start)) / HOUR_MS
  );

  if (rows.length === 0) {
    return {
      event: event.name,
      status: 'NO_DATA',
      expected_hours: expectedHours,
      observed_hours: 0
    };
  }

  const timestamps = new Set(
    rows.map(row => row.timestamp)
  );

  let completeHours = 0;

  for (
    let time = parseTime(event.start);
    time < parseTime(event.end);
    time += HOUR_MS
  ) {
    if (timestamps.has(time)) {
      completeHours++;
    }
  }

  const peak = rows.reduce((highest, item) =>
    item.level > highest.level ? item : highest
  );

  const minimum = rows.reduce((lowest, item) =>
    item.level < lowest.level ? item : lowest
  );

  return {
    event: event.name,
    evidence_type: event.classification,
    gauge_flood_label: 'NOT_VERIFIED',
    coverage: {
      expected_hours: expectedHours,
      available_hours: completeHours,
      coverage_percent: round(
        100 * completeHours / expectedHours
      ),
      status: completeHours === expectedHours
        ? 'COMPLETE'
        : 'INCOMPLETE'
    },
    minimum_level: {
      observed_at: minimum.time,
      level_m: minimum.level
    },
    peak_level: {
      observed_at: peak.time,
      level_m: peak.level
    },
    observed_level_range_m:
      round(peak.level - minimum.level),
    river_changes: {
      one_hour: calculateRise(rows, 1),
      three_hours: calculateRise(rows, 3),
      six_hours: calculateRise(rows, 6)
    },
    interpretation:
      'Descriptive historical river-level analysis. ' +
      'Does not independently verify flooding.'
  };
}

async function main() {
  const results = [];

  for (const event of EVENTS) {
    const rows = await loadEvent(event);
    results.push(analyzeEvent(event, rows));
  }

  const output = {
    project: 'Weather and Flood Risk Forecasting',
    station_id: STATION_ID,
    source: 'WAMIS historical river observations',
    comparison: results,
    validation_status: 'GAUGE_EVENTS_NOT_VERIFIED',
    note:
      'Both periods use observations from the same ' +
      'gauge. Event labels are regional. No official ' +
      'flood-stage exceedance is claimed.'
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
