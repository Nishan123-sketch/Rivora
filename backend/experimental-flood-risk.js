
const pool = require('./db');

const HOUR_MS = 3600000;
const MAX_AGE_HOURS = 3;
const MIN_HISTORY_HOURS = 500;
const MIN_HISTORY_DAYS = 30;

// These percentiles describe historical river
// levels. They are NOT official flood thresholds.
const ELEVATED_PERCENTILE = 90;
const VERY_HIGH_PERCENTILE = 95;

function numberOrNull(value) {
  if (value === null || value === undefined ||
      value === '') {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseKst(value) {
  if (!value) return NaN;

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
  );

  if (!match) return NaN;

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ) - 9 * HOUR_MS;
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function percentile(sorted, percent) {
  const index =
    (sorted.length - 1) * percent / 100;

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const fraction = index - lower;

  return sorted[lower] +
    (sorted[upper] - sorted[lower]) * fraction;
}

function forecastRange(periods, hours) {
  const p = periods.find(
    item => Number(item.hours) === hours
  );

  if (!p || !['COMPLETE', 'RANGE_AVAILABLE']
      .includes(p.status)) {
    return {
      status: 'UNAVAILABLE',
      minimum_mm: null,
      maximum_mm: null,
      maximum_exclusive: null
    };
  }

  if (p.status === 'COMPLETE') {
    const value = numberOrNull(p.rainfall_mm);

    return {
      status: value === null
        ? 'UNAVAILABLE' : 'EXACT',
      minimum_mm: value,
      maximum_mm: value,
      maximum_exclusive: false
    };
  }

  const min = numberOrNull(p.rainfall_min_mm);
  const max = numberOrNull(p.rainfall_max_mm);

  if (min === null || max === null || min > max) {
    return {
      status: 'UNAVAILABLE',
      minimum_mm: null,
      maximum_mm: null,
      maximum_exclusive: null
    };
  }

  return {
    status: 'BOUNDED',
    minimum_mm: min,
    maximum_mm: max,
    maximum_exclusive:
      p.rainfall_max_exclusive === true
  };
}

async function assessExperimentalFloodRisk({
  river,
  rainfall,
  forecast,
  riverPrediction
}) {
  const base = {
    status: 'NOT_ASSESSED',
    assessment_type:
      'EXPERIMENTAL_RELATIVE_CONDITIONS',
    condition_level: null,
    risk_level: null,
    official_flood_risk: null,
    official_warning_issued: null,
    validation_status: 'NOT_VALIDATED',
    station_id: river?.station_id ?? null,
    model_version: '1.0',
    indicators: {},
    limitations: [
      'Historical percentiles are not flood thresholds.',
      'This assessment does not estimate flood probability.',
      'The historical period may not contain flood events.',
      'Upstream rainfall, catchment response, dam operations and other flood drivers are not fully modeled.',
      'Experimental river predictions are not official forecasts.'
    ]
  };

  const stationId = Number(river?.station_id);
  const level = numberOrNull(
    river?.latest_water_level
  );

  const observedAt = river?.latest_observed_at;
  const observedMs = parseKst(observedAt);

  if (
    !Number.isSafeInteger(stationId) ||
    stationId <= 0 ||
    level === null ||
    !Number.isFinite(observedMs)
  ) {
    return {
      ...base,
      reason: 'RIVER_OBSERVATION_UNAVAILABLE'
    };
  }

  const ageHours =
    (Date.now() - observedMs) / HOUR_MS;

  if (
    ageHours < 0 ||
    ageHours > MAX_AGE_HOURS
  ) {
    return {
      ...base,
      reason: 'RIVER_OBSERVATION_STALE',
      observation_age_hours: round(ageHours, 2)
    };
  }

  // Only authentic readings from the selected
  // river station are used for historical context.
  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         observed_at, '%Y-%m-%d %H:%i:%s'
       ) AS observed_at,
       water_level
     FROM water_readings
     WHERE station_id = ?
       AND water_level IS NOT NULL
       AND observed_at <= ?
       AND observed_at >= DATE_SUB(
         ?, INTERVAL 365 DAY
       )
     ORDER BY observed_at DESC
     LIMIT 10000`,
    [stationId, observedAt, observedAt]
  );

  // Deduplicate exact hourly timestamps.
  const byHour = new Map();

  for (const row of rows) {
    const time = parseKst(row.observed_at);
    const value = numberOrNull(row.water_level);

    if (
      Number.isFinite(time) &&
      value !== null &&
      !byHour.has(time)
    ) {
      byHour.set(time, value);
    }
  }

  const timestamps = [...byHour.keys()].sort(
    (a, b) => a - b
  );

  const spanDays = timestamps.length > 1
    ? (timestamps.at(-1) - timestamps[0]) /
      (24 * HOUR_MS)
    : 0;

  if (
    byHour.size < MIN_HISTORY_HOURS ||
    spanDays < MIN_HISTORY_DAYS
  ) {
    return {
      ...base,
      reason: 'INSUFFICIENT_HISTORICAL_COVERAGE',
      history: {
        available_hours: byHour.size,
        span_days: round(spanDays, 1),
        minimum_hours_required: MIN_HISTORY_HOURS,
        minimum_days_required: MIN_HISTORY_DAYS
      }
    };
  }

  const levels = [...byHour.values()].sort(
    (a, b) => a - b
  );

  const p50 = percentile(levels, 50);
  const p90 = percentile(levels, 90);
  const p95 = percentile(levels, 95);

  const belowOrEqual = levels.filter(
    value => value <= level
  ).length;

  const percentileRank =
    100 * belowOrEqual / levels.length;

  const change1h =
    numberOrNull(river.changes?.['1h']);

  const change3h =
    numberOrNull(river.changes?.['3h']);

  const change6h =
    numberOrNull(river.changes?.['6h']);

  const riverRising = change1h !== null
    ? change1h > 0
    : null;

  const sustainedRise =
    change1h !== null &&
    change3h !== null
      ? change1h > 0 && change3h > 0
      : null;

  const observed3h =
    rainfall?.rainfall3h?.status === 'COMPLETE'
      ? numberOrNull(rainfall.rainfall3h.rainfallMm)
      : null;

  const observed6h =
    rainfall?.rainfall6h?.status === 'COMPLETE'
      ? numberOrNull(rainfall.rainfall6h.rainfallMm)
      : null;

  const observed24h =
    rainfall?.rainfall24h?.status === 'COMPLETE'
      ? numberOrNull(rainfall.rainfall24h.rainfallMm)
      : null;

  // Ensure recent rainfall is not treated as
  // current when the rainfall feed is stale.
  const rainfallMs = parseKst(
    rainfall?.observedAt
  );

  const rainfallAgeHours =
    (Date.now() - rainfallMs) / HOUR_MS;

  const rainfallFresh =
    Number.isFinite(rainfallAgeHours) &&
    rainfallAgeHours >= 0 &&
    rainfallAgeHours <= MAX_AGE_HOURS;

  const observedRain = rainfallFresh
    ? {
        rainfall_3h_mm: observed3h,
        rainfall_6h_mm: observed6h,
        rainfall_24h_mm: observed24h
      }
    : {
        rainfall_3h_mm: null,
        rainfall_6h_mm: null,
        rainfall_24h_mm: null
      };

  const periods = Array.isArray(forecast?.periods)
    ? forecast.periods
    : [];

  const forecastIssuedMs = parseKst(
    forecast?.issued_at
  );

  const forecastAgeHours =
    (Date.now() - forecastIssuedMs) / HOUR_MS;

  // An older issuance is exposed as context,
  // but cannot strengthen a live assessment.
  const forecastFresh =
    Number.isFinite(forecastAgeHours) &&
    forecastAgeHours >= 0 &&
    forecastAgeHours <= 8;

  const upcoming3h = forecastFresh
    ? forecastRange(periods, 3)
    : forecastRange([], 3);

  const upcoming12h = forecastFresh
    ? forecastRange(periods, 12)
    : forecastRange([], 12);

  const livePrediction =
    riverPrediction?.rainfall_model?.prediction;

  const validLivePrediction =
    livePrediction?.status === 'LIVE_FORECAST' &&
    livePrediction.input_observation_time === observedAt;

  const predictedLevel = validLivePrediction
    ? numberOrNull(
        livePrediction.predicted_water_level_m
      )
    : null;

  // Provisional condition labels based only on
  // relative historical levels.
  // These are NOT calibrated flood-risk grades.
  let conditionLevel = 'WITHIN_HISTORICAL_RANGE';

  if (level >= p95) {
    conditionLevel = 'VERY_HIGH_RELATIVE_LEVEL';
  } else if (level >= p90) {
    conditionLevel = 'ELEVATED_RELATIVE_LEVEL';
  }

  const signals = [];

  if (riverRising === true) {
    signals.push('RIVER_RISING');
  }

  if (sustainedRise === true) {
    signals.push('SUSTAINED_RISE_3H');
  }

  if (
    observedRain.rainfall_3h_mm !== null &&
    observedRain.rainfall_3h_mm > 0
  ) {
    signals.push('RECENT_RAINFALL_OBSERVED');
  }

  if (
    upcoming3h.minimum_mm !== null &&
    upcoming3h.maximum_mm > 0
  ) {
    signals.push('FORECAST_RAINFALL_POSSIBLE');
  }

  if (
    predictedLevel !== null &&
    predictedLevel > level
  ) {
    signals.push('EXPERIMENTAL_LEVEL_INCREASE');
  }

  return {
    ...base,

    status: 'PROVISIONAL',
    condition_level: conditionLevel,

    // Remains null until a flood-event-based
    // classification model is validated.
    risk_level: null,

    reason: null,

    observed_at: observedAt,
    observation_age_hours: round(ageHours, 2),

    history: {
      available_hours: byHour.size,
      span_days: round(spanDays, 1),
      historical_min_m: round(levels[0]),
      historical_median_m: round(p50),
      historical_p90_m: round(p90),
      historical_p95_m: round(p95),
      historical_max_m: round(levels.at(-1)),
      current_percentile_rank:
        round(percentileRank, 1)
    },

    indicators: {
      current_water_level_m: level,

      recent_river_changes_m: {
        '1h': change1h,
        '3h': change3h,
        '6h': change6h
      },

      rising_last_hour: riverRising,
      sustained_rise_3h: sustainedRise,

      observed_rainfall: {
        ...observedRain,
        source_fresh: rainfallFresh,
        data_age_hours:
          Number.isFinite(rainfallAgeHours)
            ? round(rainfallAgeHours, 2)
            : null
      },

      forecast_rainfall: {
        source_fresh: forecastFresh,
        forecast_3h: upcoming3h,
        forecast_12h: upcoming12h
      },

      experimental_river_prediction: {
        available: predictedLevel !== null,
        predicted_level_m: predictedLevel,
        target_time: validLivePrediction
          ? livePrediction.target_time
          : null
      },

      signals
    },

    message:
      'Provisional river-condition assessment based ' +
      'on observed water levels, historical context, ' +
      'rainfall and available predictions. ' +
      'This is not a validated flood-risk grade ' +
      'or an official warning.'
  };
}

module.exports = {
  assessExperimentalFloodRisk
};
