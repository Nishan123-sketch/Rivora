
require('dotenv').config();

const pool = require('./db');
const { importAwsRainfall } = require('./aws-rainfall-importer');

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const AWS_STATION_CODE = '152';
const ASOS_STATION_ID = 31;
const RIVER_STATION_ID = 207;

const RECENT_OFFSETS = [4, 3, 2, 1];

const STARTUP_RECOVERY_HOURS = 30;
const DAILY_RECOVERY_HOURS = 48;

const SYNC_INTERVAL_MS = 10 * MINUTE_MS;
const RETRY_COOLDOWN_MS = 20 * MINUTE_MS;
const MAX_SYNC_ATTEMPTS = 6;
const MAX_RIVER_AGE_HOURS = 3;

const IMPORT_DELAY_MS = 1500;

let running = false;
let started = false;

const retryHistory = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Convert KST database datetime to UTC milliseconds.
function parseKstTime(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
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

// Convert UTC milliseconds to KST database datetime.
function formatKstTime(ms) {
  return new Date(ms + 9 * HOUR_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function makeOffsets(count) {
  const offsets = [];

  for (let i = count; i >= 1; i--) {
    offsets.push(i);
  }

  return offsets;
}

// Import AWS observations at selected offsets.
async function importOffsets(offsets, jobName) {
  if (running) {
    console.log(`[AWS] ${jobName} skipped: importer busy`);

    return {
      status: 'SKIPPED_BUSY'
    };
  }

  running = true;

  const summary = {
    status: 'COMPLETED',
    requested: offsets.length,
    successful: 0,
    failed: 0,
    stations_inserted: 0,
    stations_updated: 0
  };

  console.log(`[AWS] ${jobName} started`);

  try {
    for (const offset of offsets) {
      try {
        const result = await importAwsRainfall(offset);

        summary.successful++;

        summary.stations_inserted += result?.inserted || 0;
        summary.stations_updated += result?.updated || 0;

      } catch (error) {
        summary.failed++;

        console.error(
          `[AWS] Import offset ${offset} failed:`,
          error.message
        );
      }

      await sleep(IMPORT_DELAY_MS);
    }

    await require('./link-nearest-rainfall').run();
    console.log(`[AWS] ${jobName} completed:`, summary);

    return summary;

  } finally {
    running = false;
  }
}

async function runRecentImport() {
  return importOffsets(
    RECENT_OFFSETS,
    'Recent rainfall update'
  );
}

async function runStartupRecovery() {
  return importOffsets(
    makeOffsets(STARTUP_RECOVERY_HOURS),
    'Startup rainfall recovery'
  );
}

async function runDailyRecovery() {
  return importOffsets(
    makeOffsets(DAILY_RECOVERY_HOURS),
    'Daily rainfall recovery'
  );
}

// Find latest Taehwa Bridge water observation.
async function getLatestRiverObservation() {
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
     LIMIT 1`,
    [RIVER_STATION_ID]
  );

  return rows[0] || null;
}

// Read valid rainfall values without inventing zero.
function validRainfall(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return number;
}

// Get required rainfall at river observation time
// and the previous two hours.
//
// Priority:
// 1. KMA AWS
// 2. KMA ASOS
//
// Missing rainfall stays NULL.
async function getRequiredRainfall(riverTime) {
  const latestMs = parseKstTime(riverTime);

  if (!Number.isFinite(latestMs)) {
    throw new Error(
      'Invalid latest river observation timestamp'
    );
  }

  const requiredTimes = [0, 1, 2].map(offset =>
    formatKstTime(latestMs - offset * HOUR_MS)
  );

  const placeholders =
    requiredTimes.map(() => '?').join(', ');

  const rainfallMap = new Map();

  // STEP 1: Load genuine AWS hourly rainfall.
  const [awsRows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         observed_at,
         '%Y-%m-%d %H:%i:%s'
       ) AS observed_at,
       hourly_rainfall
     FROM aws_rainfall_readings
     WHERE aws_station_code = ?
       AND observed_at IN (${placeholders})
     ORDER BY observed_at ASC`,
    [AWS_STATION_CODE, ...requiredTimes]
  );

  for (const row of awsRows) {
    const value = validRainfall(row.hourly_rainfall);

    if (value !== null) {
      rainfallMap.set(row.observed_at, {
        rainfall_mm: value,
        source: 'KMA_AWS'
      });
    }
  }

  // STEP 2: ASOS fallback for missing AWS hours.
  const [asosRows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         observed_at,
         '%Y-%m-%d %H:%i:%s'
       ) AS observed_at,
       hourly_rainfall
     FROM weather_readings
     WHERE station_id = ?
       AND observed_at IN (${placeholders})
     ORDER BY observed_at ASC`,
    [ASOS_STATION_ID, ...requiredTimes]
  );

  for (const row of asosRows) {
    if (rainfallMap.has(row.observed_at)) {
      continue;
    }

    const value = validRainfall(row.hourly_rainfall);

    if (value !== null) {
      rainfallMap.set(row.observed_at, {
        rainfall_mm: value,
        source: 'KMA_ASOS'
      });
    }
  }

  // IMPORTANT: Always return an array.
  return requiredTimes.map(time => {
    const observation = rainfallMap.get(time);

    return {
      observed_at: time,
      rainfall_mm: observation?.rainfall_mm ?? null,
      source: observation?.source ?? null,
      available: observation !== undefined
    };
  });
}

// Calculate the offset used by the existing importer.
function calculateOffset(observedAt) {
  const timestamp = parseKstTime(observedAt);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const offset = Math.floor(
    (Date.now() - timestamp) / HOUR_MS
  );

  // Existing importer uses positive hourly offsets.
  if (
    !Number.isInteger(offset) ||
    offset < 1 ||
    offset > 168
  ) {
    return null;
  }

  return offset;
}

// Avoid excessive KMA API requests.

function canRetry(observedAt) {
  const previous = retryHistory.get(observedAt);

  if (!previous) {
    return true;
  }

  const elapsed = Date.now() - previous.lastAttempt;

  // Respect the normal cooldown between API requests.
  if (elapsed < RETRY_COOLDOWN_MS) {
    return false;
  }

  // After six attempts, pause for two hours.
  // Then permit another retry cycle.
  if (previous.attempts >= MAX_SYNC_ATTEMPTS) {
    const pauseMs = 2 * HOUR_MS;

    if (elapsed < pauseMs) {
      return false;
    }

    retryHistory.delete(observedAt);
  }

  return true;
}

function recordAttempt(observedAt) {
  const previous = retryHistory.get(observedAt);

  retryHistory.set(observedAt, {
    attempts: (previous?.attempts || 0) + 1,
    lastAttempt: Date.now()
  });
}


function recordAttempt(observedAt) {
  const previous = retryHistory.get(observedAt);

  retryHistory.set(observedAt, {
    attempts: (previous?.attempts || 0) + 1,
    lastAttempt: Date.now()
  });
}

function cleanRetryHistory(latestRiverTime) {
  const latestMs = parseKstTime(latestRiverTime);

  for (const time of retryHistory.keys()) {
    const timestamp = parseKstTime(time);

    if (
      !Number.isFinite(timestamp) ||
      timestamp < latestMs - 3 * HOUR_MS
    ) {
      retryHistory.delete(time);
    }
  }
}

// Synchronize rainfall for latest river prediction.
async function runRainfallSynchronization() {
  if (running) {
    console.log(
      '[AWS Sync] Import already running; skipped'
    );

    return {
      status: 'SKIPPED_BUSY'
    };
  }

  running = true;

  try {
    const river = await getLatestRiverObservation();

    if (!river) {
      return {
        status: 'NO_RIVER_DATA'
      };
    }

    const riverMs = parseKstTime(river.observed_at);

    const riverAgeHours =
      (Date.now() - riverMs) / HOUR_MS;

    if (
      !Number.isFinite(riverAgeHours) ||
      riverAgeHours < 0 ||
      riverAgeHours > MAX_RIVER_AGE_HOURS
    ) {
      return {
        status: 'RIVER_DATA_NOT_CURRENT',
        latest_river_observation: river.observed_at
      };
    }

    cleanRetryHistory(river.observed_at);

    // This always returns an array of three hours.
    const required = await getRequiredRainfall(
      river.observed_at
    );

    const missing = required.filter(
      item => !item.available
    );

    if (missing.length === 0) {
      console.log(
        '[AWS Sync] All required rainfall available'
      );

      return {
        status: 'SYNCHRONIZED',
        latest_river_observation: river.observed_at,
        required_rainfall: required,
        missing_hours: []
      };
    }

    console.log(
      '[AWS Sync] Missing rainfall:',
      missing.map(item => item.observed_at)
    );

    const attempted = [];
    const deferred = [];

    for (const item of missing) {
      const offset = calculateOffset(item.observed_at);

      if (offset === null) {
        deferred.push({
          observed_at: item.observed_at,
          reason: 'OBSERVATION_HOUR_NOT_YET_REQUESTABLE'
        });

        continue;
      }

      if (!canRetry(item.observed_at)) {
        deferred.push({
          observed_at: item.observed_at,
          reason: 'RETRY_COOLDOWN_OR_LIMIT'
        });

        continue;
      }

      recordAttempt(item.observed_at);

      try {
        console.log(
          `[AWS Sync] Requesting ${item.observed_at}`
        );

        const result = await importAwsRainfall(offset);

        attempted.push({
          observed_at: item.observed_at,
          requested_time: result?.requested_time ?? null,
          success:
            result?.requested_time ===
            item.observed_at
              .replace(/[- :]/g, '')
              .slice(0, 12)
        });

      } catch (error) {
        console.error(
          `[AWS Sync] ${item.observed_at}:`,
          error.message
        );

        attempted.push({
          observed_at: item.observed_at,
          success: false,
          error: error.message
        });
      }

      await sleep(IMPORT_DELAY_MS);
    }

    // Check again after import attempts.
    const after = await getRequiredRainfall(
      river.observed_at
    );

    const stillMissing = after
      .filter(item => !item.available)
      .map(item => item.observed_at);

    const result = {
      status:
        stillMissing.length === 0
          ? 'SYNCHRONIZED'
          : 'WAITING_FOR_KMA',

      latest_river_observation: river.observed_at,

      attempted,
      deferred,
      required_rainfall: after,
      missing_hours: stillMissing
    };

    console.log(
      '[AWS Sync] Result:',
      result.status,
      'missing:',
      stillMissing
    );

    return result;

  } finally {
    running = false;
  }
}

// Start automatic rainfall scheduler.
function startAwsRainfallScheduler() {
  if (started) {
    console.log(
      '[AWS] Scheduler already started'
    );

    return;
  }

  started = true;

  console.log(
    '[AWS] Automatic rainfall scheduler started'
  );

  // Recover recent rainfall on startup.
  void runStartupRecovery()
    .then(() => runRainfallSynchronization())
    .catch(error => {
      console.error(
        '[AWS] Startup recovery error:',
        error.message
      );
    });

  // Import recent rainfall every hour.
  setInterval(() => {
    void runRecentImport().catch(error => {
      console.error(
        '[AWS] Recent import error:',
        error.message
      );
    });
  }, HOUR_MS);

  // Recover historical rainfall every 24 hours.
  setInterval(() => {
    void runDailyRecovery().catch(error => {
      console.error(
        '[AWS] Daily recovery error:',
        error.message
      );
    });
  }, 24 * HOUR_MS);

  // Synchronize river and rainfall every 10 minutes.
  setInterval(() => {
    void runRainfallSynchronization()
      .catch(error => {
        console.error(
          '[AWS Sync] Error:',
          error.message
        );
      });
  }, SYNC_INTERVAL_MS);

  console.log(
    '[AWS] River/rainfall synchronization enabled'
  );
}

module.exports = {
  startAwsRainfallScheduler,
  runRecentImport,
  runStartupRecovery,
  runDailyRecovery,
  runRainfallSynchronization
};
