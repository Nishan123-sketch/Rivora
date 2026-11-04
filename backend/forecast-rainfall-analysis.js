
require('dotenv').config();

const pool = require('./db');
const { findUlsanKma } = require('./station-defaults');

const SOURCE = 'KMA_VILAGE_FCST';
const HOUR_MS = 60 * 60 * 1000;

function formatKst(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function parseKstDate(value) {
  if (typeof value !== 'string') return null;

  const date = new Date(
    value.replace(' ', 'T') + '+09:00'
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : null;
}

function round2(number) {
  return Number(number.toFixed(2));
}

function normalizeForecast(row) {
  const exact = numberOrNull(row.rainfall_forecast);
  const min = numberOrNull(row.precipitation_min_mm);
  const max = numberOrNull(row.precipitation_max_mm);

  if (exact !== null) {
    return {
      valid: true,
      exact: true,
      min: exact,
      max: exact,
      maxExclusive: false,
      raw: row.precipitation_raw
    };
  }

  if (
    min !== null &&
    max !== null &&
    min <= max
  ) {
    return {
      valid: true,
      exact: false,
      min,
      max,
      maxExclusive:
        Number(row.precipitation_max_exclusive) === 1,
      raw: row.precipitation_raw
    };
  }

  return {
    valid: false,
    exact: false,
    min: null,
    max: null,
    maxExclusive: false,
    raw: row.precipitation_raw
  };
}

function analyzePeriod(forecastMap, start, hours) {
  const end = new Date(
    start.getTime() + hours * HOUR_MS
  );

  let exactTotal = 0;
  let minimumTotal = 0;
  let maximumTotal = 0;

  let exactHours = 0;
  let rangeHours = 0;
  let maxExclusive = false;

  const missingHours = [];
  const rangeDetails = [];

  for (let hour = 1; hour <= hours; hour++) {
    const expectedTime = new Date(
      start.getTime() + hour * HOUR_MS
    );

    const record = forecastMap.get(
      expectedTime.getTime()
    );

    if (!record || !record.valid) {
      missingHours.push(formatKst(expectedTime));
      continue;
    }

    minimumTotal += record.min;
    maximumTotal += record.max;

    if (record.exact) {
      exactTotal += record.min;
      exactHours++;
    } else {
      rangeHours++;

      if (record.maxExclusive) {
        maxExclusive = true;
      }

      rangeDetails.push({
        valid_at: formatKst(expectedTime),
        raw: record.raw,
        minimum_mm: record.min,
        maximum_mm: record.max,
        maximum_exclusive: record.maxExclusive
      });
    }
  }

  const availableHours = exactHours + rangeHours;

  const fullCoverage = availableHours === hours;
  const allExact = fullCoverage && rangeHours === 0;

  let status;

  if (allExact) {
    status = 'COMPLETE';
  } else if (fullCoverage) {
    status = 'RANGE_AVAILABLE';
  } else {
    status = 'INCOMPLETE';
  }

  return {
    hours,
    start_at: formatKst(start),
    end_at: formatKst(end),

    expected_hours: hours,
    available_hours: availableHours,
    exact_hours: exactHours,
    range_hours: rangeHours,

    rainfall_mm: allExact
      ? round2(exactTotal)
      : null,

    rainfall_min_mm: fullCoverage
      ? round2(minimumTotal)
      : null,

    rainfall_max_mm: fullCoverage
      ? round2(maximumTotal)
      : null,

    rainfall_max_exclusive:
      fullCoverage ? maxExclusive : null,

    average_rainfall_mm_per_hour: allExact
      ? round2(exactTotal / hours)
      : null,

    status,
    missing_hours: missingHours,
    range_details: rangeDetails,

    note: allExact
      ? 'All hourly precipitation values are exact.'
      : fullCoverage
        ? 'All hours have KMA forecast data, but some values are ranges. The exact total is unknown.'
        : 'Some forecast hours have no usable precipitation value. A complete total or bound cannot be calculated.'
  };
}

async function analyzeForecastRainfall() {
  const ulsan = await findUlsanKma();

  if (!ulsan) {
    return {
      station_id: null,
      station_name: null,
      source: SOURCE,
      timezone: 'Asia/Seoul',
      status: 'NO_FORECAST_DATA',
      prediction_available: false,
      periods: [],
      duplicate_hours: [],
      message: 'Ulsan KMA station not found.'
    };
  }

  const stationId = Number(ulsan.station_id);

  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         issued_at,
         '%Y-%m-%d %H:%i:%s'
       ) AS issued_at,

       DATE_FORMAT(
         valid_at,
         '%Y-%m-%d %H:%i:%s'
       ) AS valid_at,

       rainfall_forecast,
       precipitation_raw,
       precipitation_min_mm,
       precipitation_max_mm,
       precipitation_max_exclusive

     FROM weather_forecasts

     WHERE station_id = ?
       AND source = ?
       AND issued_at = (
         SELECT MAX(issued_at)
         FROM weather_forecasts
         WHERE station_id = ?
           AND source = ?
       )

     ORDER BY valid_at ASC`,
    [stationId, SOURCE, stationId, SOURCE]
  );

  if (!rows.length) {
    return {
      station_id: stationId,
      station_name: '울산',
      source: SOURCE,
      timezone: 'Asia/Seoul',
      status: 'NO_FORECAST_DATA',
      prediction_available: false,
      periods: [],
      duplicate_hours: [],
      message: 'No KMA rainfall forecast available.'
    };
  }

  const forecastMap = new Map();
  const duplicateHours = new Set();

  for (const row of rows) {
    const validAt = parseKstDate(row.valid_at);

    if (!validAt) continue;

    const key = validAt.getTime();

    if (forecastMap.has(key)) {
      duplicateHours.add(key);
      forecastMap.set(key, null);
      continue;
    }

    forecastMap.set(key, normalizeForecast(row));
  }

  for (const key of duplicateHours) {
    forecastMap.set(key, null);
  }

  const now = new Date();

  const start = new Date(
    Math.floor(now.getTime() / HOUR_MS) * HOUR_MS
  );

  const periods = [3, 6, 12, 24].map(
    hours => analyzePeriod(
      forecastMap,
      start,
      hours
    )
  );

  const completePeriods = periods.filter(
    period => period.status === 'COMPLETE'
  ).length;

  const boundedPeriods = periods.filter(
    period => period.status === 'RANGE_AVAILABLE'
  ).length;

  const usablePeriods = completePeriods + boundedPeriods;

  const forecastStatus =
    completePeriods === periods.length
      ? 'AVAILABLE'
      : usablePeriods > 0
        ? 'PARTIALLY_AVAILABLE'
        : 'INCOMPLETE';

  return {
    station_id: stationId,
    station_name: '울산',

    issued_at: rows[0].issued_at,
    source: SOURCE,
    timezone: 'Asia/Seoul',
    forecast_type: 'KMA_SHORT_TERM',

    status: forecastStatus,
    prediction_available: usablePeriods > 0,

    complete_periods: completePeriods,
    bounded_periods: boundedPeriods,
    total_periods: periods.length,

    duplicate_hours: [
      ...duplicateHours
    ].map(timestamp =>
      formatKst(new Date(timestamp))
    ),

    periods,

    note:
      'Uses only the latest KMA forecast issuance. ' +
      'Exact rainfall totals are returned when every hour ' +
      'has an exact value. When KMA supplies precipitation ' +
      'ranges, minimum and maximum bounds are reported ' +
      'instead of an invented exact total. ' +
      'Missing or duplicate forecasts remain incomplete.'
  };
}

if (require.main === module) {
  analyzeForecastRainfall()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error(
        'Forecast rainfall analysis failed:',
        error.message
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = {
  analyzeForecastRainfall
};
