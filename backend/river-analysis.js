
require('dotenv').config();

const pool = require('./db');

const MAX_AGE_HOURS = 3;
const HOUR_MS = 3600000;

function toMillis(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return NaN;

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 9,
    Number(match[5]),
    Number(match[6])
  );
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

  return Number.isFinite(number) ? number : null;
}

function round3(value) {
  return Number(value.toFixed(3));
}

function classifyStage(level, thresholds) {
  if (level >= thresholds.severe_level_m) {
    return 'SEVERE';
  }

  if (level >= thresholds.alert_level_m) {
    return 'ALERT';
  }

  if (level >= thresholds.caution_level_m) {
    return 'CAUTION';
  }

  if (level >= thresholds.interest_level_m) {
    return 'INTEREST';
  }

  return 'NORMAL';
}

function validThresholds(thresholds) {
  if (!thresholds) return false;

  const levels = [
    thresholds.interest_level_m,
    thresholds.caution_level_m,
    thresholds.alert_level_m,
    thresholds.severe_level_m
  ];

  return (
    levels.every(level =>
      level !== null && Number.isFinite(level)
    ) &&
    levels[0] < levels[1] &&
    levels[1] < levels[2] &&
    levels[2] < levels[3] &&
    String(thresholds.verification_status).toUpperCase() ===
      'VERIFIED' &&
    Boolean(thresholds.verified_at) &&
    Boolean(thresholds.source_url)
  );
}

function calculateChanges(rows, latestTime, latestLevel) {
  const byTime = new Map();

  for (const row of rows) {
    const time = toMillis(row.observed_at);
    const level = numberOrNull(row.water_level);

    if (Number.isFinite(time) && level !== null) {
      byTime.set(time, level);
    }
  }

  function change(hours) {
    const previous = byTime.get(
      latestTime - hours * HOUR_MS
    );

    return previous === undefined
      ? null
      : round3(latestLevel - previous);
  }

  return {
    '1h': change(1),
    '3h': change(3),
    '6h': change(6),
    '24h': change(24)
  };
}

function calculateRecentStats(rows, latestTime, hours) {
  const levels = rows
    .filter(row => {
      const time = toMillis(row.observed_at);

      return (
        Number.isFinite(time) &&
        time >= latestTime - (hours - 1) * HOUR_MS &&
        time <= latestTime
      );
    })
    .map(row => numberOrNull(row.water_level))
    .filter(value => value !== null);

  if (!levels.length) {
    return {
      hours,
      available_observations: 0,
      minimum_level_m: null,
      maximum_level_m: null,
      level_range_m: null
    };
  }

  const minimum = Math.min(...levels);
  const maximum = Math.max(...levels);

  return {
    hours,
    available_observations: levels.length,
    minimum_level_m: round3(minimum),
    maximum_level_m: round3(maximum),
    level_range_m: round3(maximum - minimum)
  };
}

function directionFromChange(change) {
  if (change === null) return 'UNKNOWN';

  if (change > 0) return 'RISING';
  if (change < 0) return 'FALLING';

  return 'STABLE';
}

async function analyzeRiver(stationCode = '2201670') {
  const [stations] = await pool.execute(
    `SELECT
       station_id,
       station_name,
       external_station_id
     FROM stations
     WHERE data_source = 'RIVER_GAUGE'
       AND external_station_id = ?
     LIMIT 1`,
    [String(stationCode)]
  );

  if (!stations.length) {
    return {
      station_code: stationCode,
      status: 'STATION_NOT_FOUND',
      risk_level: null,
      risk_status: 'NOT_ASSESSED'
    };
  }

  const station = stations[0];

  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         observed_at,
         '%Y-%m-%d %H:%i:%s'
       ) AS observed_at,
       water_level
     FROM water_readings
     WHERE station_id = ?
       AND water_level IS NOT NULL
     ORDER BY observed_at DESC
     LIMIT 1000`,
    [station.station_id]
  );

  const [thresholdRows] = await pool.execute(
    `SELECT
       advisory_level_m,
       warning_level_m,
       danger_level_m,
       interest_level_m,
       caution_level_m,
       alert_level_m,
       severe_level_m,
       verification_status,
       verified_at,
       source_url,
       reference_source
     FROM flood_thresholds
     WHERE station_id = ?
     LIMIT 1`,
    [station.station_id]
  );

  const threshold = thresholdRows[0] || null;

  const thresholds = threshold ? {
    advisory_level_m:
      numberOrNull(threshold.advisory_level_m),

    warning_level_m:
      numberOrNull(threshold.warning_level_m),

    danger_level_m:
      numberOrNull(threshold.danger_level_m),

    interest_level_m:
      numberOrNull(threshold.interest_level_m),

    caution_level_m:
      numberOrNull(threshold.caution_level_m),

    alert_level_m:
      numberOrNull(threshold.alert_level_m),

    severe_level_m:
      numberOrNull(threshold.severe_level_m),

    verification_status: threshold.verification_status,
    verified_at: threshold.verified_at,
    source_url: threshold.source_url,
    reference_source: threshold.reference_source
  } : null;

  if (!rows.length) {
    return {
      station_code: stationCode,
      station_id: station.station_id,
      station_name: station.station_name,
      status: 'NO_DATA',
      latest_observed_at: null,
      latest_water_level: null,
      trend: 'UNKNOWN',
      changes: null,
      thresholds,
      risk_level: null,
      risk_status: 'NOT_ASSESSED',
      message: 'No water-level observations available.'
    };
  }

  const latest = rows[0];
  const latestTime = toMillis(latest.observed_at);
  const latestLevel = numberOrNull(latest.water_level);

  const ageHours = Number.isFinite(latestTime)
    ? (Date.now() - latestTime) / HOUR_MS
    : NaN;

  const fresh =
    Number.isFinite(ageHours) &&
    ageHours >= 0 &&
    ageHours <= MAX_AGE_HOURS;

  const observationValid =
    Number.isFinite(latestTime) &&
    latestLevel !== null;

  const changes = observationValid
    ? calculateChanges(rows, latestTime, latestLevel)
    : {
        '1h': null,
        '3h': null,
        '6h': null,
        '24h': null
      };

  const trend = directionFromChange(changes['1h']);

  const stats3h = observationValid
    ? calculateRecentStats(rows, latestTime, 3)
    : null;

  const stats6h = observationValid
    ? calculateRecentStats(rows, latestTime, 6)
    : null;

  const stats24h = observationValid
    ? calculateRecentStats(rows, latestTime, 24)
    : null;

  const stageThresholdsVerified =
    validThresholds(thresholds);

  let riskLevel = null;
  let riskStatus = 'STAGE_THRESHOLDS_UNAVAILABLE';

  if (!observationValid) {
    riskStatus = 'INVALID_OBSERVATION';
  } else if (!fresh) {
    riskStatus = 'STALE_OBSERVATION';
  } else if (stageThresholdsVerified) {
    riskLevel = classifyStage(
      latestLevel,
      thresholds
    );

    riskStatus = 'ASSESSED';
  }

  return {
    station_code: stationCode,
    station_id: station.station_id,
    station_name: station.station_name,

    status: 'OBSERVATION_ANALYSIS',

    latest_observed_at: latest.observed_at,
    latest_water_level: latestLevel,

    data_freshness: {
      status: !Number.isFinite(ageHours)
        ? 'INVALID_TIMESTAMP'
        : ageHours < 0
          ? 'FUTURE_TIMESTAMP'
          : fresh ? 'FRESH' : 'STALE',

      age_hours: Number.isFinite(ageHours)
        ? Number(ageHours.toFixed(2))
        : null,

      max_age_hours: MAX_AGE_HOURS
    },

    trend,
    changes,

    observed_trends: {
      one_hour: directionFromChange(changes['1h']),
      three_hour: directionFromChange(changes['3h']),
      six_hour: directionFromChange(changes['6h']),
      twenty_four_hour: directionFromChange(changes['24h']),

      note:
        'Observed changes only. A rising level is not by itself a flood-risk classification.'
    },

    recent_water_levels: {
      last_3h: stats3h,
      last_6h: stats6h,
      last_24h: stats24h
    },

    thresholds,

    threshold_verification: {
      verified_for_stage_comparison:
        stageThresholdsVerified,

      verification_status:
        thresholds?.verification_status || 'UNAVAILABLE',

      source_url:
        thresholds?.source_url || null
    },

    risk_level: riskLevel,
    risk_status: riskStatus,

    assessment_type:
      stageThresholdsVerified
        ? 'VERIFIED_STAGE_REFERENCE_COMPARISON'
        : null,

    official_warning_issued: null,

    experimental_indicators: {
      rising_last_hour: changes['1h'] !== null
        ? changes['1h'] > 0
        : null,

      rising_last_three_hours: changes['3h'] !== null
        ? changes['3h'] > 0
        : null,

      sustained_rise_observed:
        changes['1h'] !== null &&
        changes['3h'] !== null
          ? changes['1h'] > 0 && changes['3h'] > 0
          : null,

      classification:
        'OBSERVATION_INDICATORS_ONLY',

      note:
        'These are descriptive river-level indicators, not validated Low/Moderate/High flood-risk categories.'
    },

    note:
      'Educational river-level analysis based on actual WAMIS observations. ' +
      'Official flood-stage assessment requires verified station-specific thresholds.'
  };
}

if (require.main === module) {
  analyzeRiver()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error(
        'Analysis failed:',
        error.message
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = { analyzeRiver };
