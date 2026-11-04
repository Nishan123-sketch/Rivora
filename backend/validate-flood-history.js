
require('dotenv').config();

const pool = require('./db');

const STATION_ID = 207;
const STATION_NAME = 'Taehwa Bridge';
const HOUR_MS = 3600000;

// Documented historical events, not automatically
// confirmed flood labels for station 207.
const DOCUMENTED_EVENTS = [
  {
    id: 'ULSAN_2025_07_19',
    name: 'Ulsan and Taehwa River flooding',
    start: '2025-07-17 01:00:00',
    end: '2025-07-21 01:00:00',
    event_date: '2025-07-19',
    evidence_type: 'REGIONAL_DOCUMENTED_EVENT',
    source: 'https://www.yna.co.kr/view/AKR20250719017552057',
    note: 'Regional flooding reported; gauge-specific flood label not verified.'
  },
  {
    id: 'ULSAN_2025_08_03',
    name: 'Ulsan heavy-rain emergency response',
    start: '2025-08-03 01:00:00',
    end: '2025-08-05 01:00:00',
    event_date: '2025-08-03',
    evidence_type: 'REGIONAL_HEAVY_RAIN_EVENT',
    source: 'https://www.ulsan.go.kr/u/rep/bbs/view.ulsan?bbsId=BBS_0000000000000027&dataId=173974&mId=001004003001000000',
    note: 'Heavy rainfall reported; gauge-specific flood label not verified.'
  }
];

function safeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function kstDate(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return NaN;

  return Date.UTC(
    +match[1],
    +match[2] - 1,
    +match[3],
    +match[4],
    +match[5],
    +match[6]
  ) - 9 * HOUR_MS;
}

async function getDatabaseCoverage() {
  const [rows] = await pool.execute(
    `SELECT
       COUNT(*) AS reading_count,
       COUNT(DISTINCT observed_at) AS unique_times,
       DATE_FORMAT(
         MIN(observed_at), '%Y-%m-%d %H:%i:%s'
       ) AS first_observation,
       DATE_FORMAT(
         MAX(observed_at), '%Y-%m-%d %H:%i:%s'
       ) AS last_observation,
       MIN(water_level) AS min_level,
       MAX(water_level) AS max_level
     FROM water_readings
     WHERE station_id = ?
       AND water_level IS NOT NULL`,
    [STATION_ID]
  );

  const row = rows[0];

  return {
    station_id: STATION_ID,
    station_name: STATION_NAME,
    readings: Number(row.reading_count),
    unique_timestamps: Number(row.unique_times),
    first_observation: row.first_observation,
    last_observation: row.last_observation,
    minimum_level_m: safeNumber(row.min_level),
    maximum_level_m: safeNumber(row.max_level)
  };
}

async function inspectDocumentedEvent(event) {
  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         MIN(observed_at), '%Y-%m-%d %H:%i:%s'
       ) AS first_observation,
       DATE_FORMAT(
         MAX(observed_at), '%Y-%m-%d %H:%i:%s'
       ) AS last_observation,
       COUNT(DISTINCT observed_at) AS observed_hours,
       MIN(water_level) AS minimum_level,
       MAX(water_level) AS maximum_level,
       AVG(water_level) AS average_level
     FROM water_readings
     WHERE station_id = ?
       AND observed_at >= ?
       AND observed_at < ?
       AND water_level IS NOT NULL`,
    [STATION_ID, event.start, event.end]
  );

  const row = rows[0];

  const expectedHours = Math.round(
    (kstDate(event.end) - kstDate(event.start))
    / HOUR_MS
  );

  const observedHours = Number(row.observed_hours);
  const coveragePercent = expectedHours > 0
    ? +(100 * observedHours / expectedHours)
        .toFixed(1)
    : null;

  const status =
    observedHours === 0
      ? 'HISTORICAL_DATA_MISSING'
      : observedHours < expectedHours
        ? 'PARTIAL_COVERAGE'
        : 'FULL_COVERAGE';

  return {
    event_id: event.id,
    name: event.name,
    event_date: event.event_date,
    window_start: event.start,
    window_end_exclusive: event.end,
    evidence_type: event.evidence_type,
    source: event.source,
    source_note: event.note,
    gauge_event_label: 'NOT_VERIFIED',
    coverage: {
      status,
      observed_hours: observedHours,
      expected_hours: expectedHours,
      coverage_percent: coveragePercent
    },
    river_observations: {
      first_observation: row.first_observation,
      last_observation: row.last_observation,
      minimum_level_m:
        safeNumber(row.minimum_level),
      maximum_level_m:
        safeNumber(row.maximum_level),
      average_level_m:
        safeNumber(row.average_level)
    },
    suitable_for_model_validation:
      status === 'FULL_COVERAGE'
        ? 'REQUIRES_GAUGE_SPECIFIC_EVENT_LABEL'
        : 'NO'
  };
}


async function getHighestObservedDays() {
  const [rows] = await pool.execute(
    `SELECT
       DATE(observed_at) AS observation_date,
       MAX(water_level) AS peak_water_level,
       COUNT(DISTINCT observed_at) AS observed_hours
     FROM water_readings
     WHERE station_id = ?
       AND water_level IS NOT NULL
     GROUP BY DATE(observed_at)
     ORDER BY peak_water_level DESC
     LIMIT 15`,
    [STATION_ID]
  );

  return rows.map(row => ({
    date: row.observation_date instanceof Date
      ? row.observation_date.toISOString().slice(0, 10)
      : String(row.observation_date).slice(0, 10),

    peak_water_level_m:
      safeNumber(row.peak_water_level),

    observed_hours:
      Number(row.observed_hours),

    meaning:
      'HIGH_OBSERVED_LEVEL_NOT_CONFIRMED_FLOOD'
  }));
}



async function validateFloodHistory() {
  const database = await getDatabaseCoverage();

  const events = [];

  for (const event of DOCUMENTED_EVENTS) {
    events.push(
      await inspectDocumentedEvent(event)
    );
  }

  const peaks = await getHighestObservedDays();

  const usableEvents = events.filter(
    event =>
      event.coverage.status === 'FULL_COVERAGE' &&
      event.gauge_event_label === 'VERIFIED'
  );

  return {
    project: 'Weather and Flood Risk Forecasting',
    analysis: 'HISTORICAL_FLOOD_EVENT_AUDIT',
    station: {
      station_id: STATION_ID,
      station_name: STATION_NAME
    },
    database_coverage: database,
    documented_events: events,
    highest_observed_days: peaks,
    validation_summary: {
      documented_events_checked: events.length,
      gauge_verified_events:
        usableEvents.length,
      validated_flood_classifier: false,
      precision: null,
      recall: null,
      false_alarm_rate: null,
      status:
        usableEvents.length === 0
          ? 'FLOOD_VALIDATION_DATA_NOT_READY'
          : 'EVENTS_READY_FOR_FURTHER_VALIDATION'
    },
    conclusions: [
      'A high water level alone is not proof of flooding.',
      'Regional event reports are not automatically gauge-specific labels.',
      'Missing historical observations cannot be treated as safe conditions.',
      'Model classification accuracy must not be claimed without verified event labels and non-event comparison periods.'
    ]
  };
}

if (require.main === module) {
  validateFloodHistory()
    .then(result => {
      console.log(
        JSON.stringify(result, null, 2)
      );
    })
    .catch(error => {
      console.error(
        '[Historical validation]',
        error
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = {
  validateFloodHistory
};
