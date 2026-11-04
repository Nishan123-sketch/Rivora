
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

const { catalog, matchRiver } = require('./river-catalog');

const {
  getWamis,
  normalizeStationInfo,
  koreanDate,
  mapReadings,
  BASE_URL
} = require('./wamis-client');

const CACHE_FILE = path.join(
  __dirname,
  'wamis-gauge-discovery-cache.json'
);

const MAX_CALLS = 35;
const FAILURE_LIMIT = 3;
const REQUEST_DELAY_MS = 800;
const METADATA_MAX_AGE_MS = 30 * 86400000;

// Prioritize the FIRST gauge for each river.
// Set GAUGE_FIRST_ONLY=false to allow second/third gauges.
const FIRST_GAUGE_ONLY =
  process.env.GAUGE_FIRST_ONLY !== 'false';

const compareGaugeCodes = (a, b) => {
  const x = BigInt(String(a));
  const y = BigInt(String(b));
  return x < y ? -1 : x > y ? 1 : 0;
};

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const timestamp = () => new Date().toISOString();

function loadCache() {
  try {
    const c = JSON.parse(
      fs.readFileSync(CACHE_FILE, 'utf8')
    );

    return {
      version: 3,
      stations: c.stations || {},
      lastScan: c.lastScan || null,
      cursor: c.cursor || null,
      retryCodes: c.retryCodes || []
    };
  } catch {
    return {
      version: 3,
      stations: {},
      lastScan: null,
      cursor: null,
      retryCodes: []
    };
  }
}

function saveCache(cache) {
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify(cache, null, 2),
    'utf8'
  );
}

function ageHours(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/
  );

  if (!match) return Infinity;

  const observedTime =
    Date.UTC(
      +match[1],
      +match[2] - 1,
      +match[3],
      +match[4],
      +match[5],
      +match[6]
    ) - 9 * 3600000;

  return (Date.now() - observedTime) / 3600000;
}

async function fetchStationList() {
  const all = new Map();
  const errors = [];

  for (const basin of ['1', '2', '3', '4', '5']) {
    try {
      const rows = await getWamis(
        'wl_dubwlobs',
        { basin, oper: 'y' },
        12000
      );

      for (const row of rows) {
        const code = String(
          row.obscd || row.wlobscd || ''
        ).trim();

        if (/^\d{5,12}$/.test(code)) {
          all.set(code, {
            ...row,
            obscd: code
          });
        }
      }
    } catch (error) {
      errors.push(
        `basin ${basin}: ${error.message}`
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  if (!all.size) {
    throw new Error(
      `WAMIS station list unavailable: ${errors.join('; ')}`
    );
  }

  return [...all.values()];
}

async function linkVerifiedGauge(station, river, readings) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT station_id
       FROM stations
       WHERE data_source = 'RIVER_GAUGE'
         AND external_station_id = ?
       LIMIT 1`,
      [station.code]
    );

    let stationId = existing[0]?.station_id;

    if (!stationId) {
      const [result] = await connection.execute(
        `INSERT INTO stations
         (
           station_name,
           latitude,
           longitude,
           data_source,
           external_station_id
         )
         VALUES (?, ?, ?, 'RIVER_GAUGE', ?)`,
        [
          station.stationName,
          station.lat,
          station.lon,
          station.code
        ]
      );

      stationId = result.insertId;
    }

    const latest = readings.reduce(
      (current, reading) =>
        reading.observedAt > current
          ? reading.observedAt
          : current,
      ''
    );

    await connection.execute(
      `INSERT INTO river_gauge_links
       (
         river_id,
         station_id,
         verification_status,
         reference_url,
         verified_at,
         source_river_name,
         last_verified_observation_at,
         verification_method
       )
       VALUES
       (
         ?, ?,
         'VERIFIED',
         ?,
         NOW(),
         ?,
         ?,
         'WAMIS_METADATA_AND_HOURLY_DATA'
       )
       ON DUPLICATE KEY UPDATE
         verification_status = 'VERIFIED',
         reference_url = VALUES(reference_url),
         verified_at = NOW(),
         source_river_name = VALUES(source_river_name),
         last_verified_observation_at =
           VALUES(last_verified_observation_at),
         verification_method =
           VALUES(verification_method)`,
      [
        river.river_id,
        stationId,
        `${BASE_URL}/wkw/wl_obsinfo?obscd=${station.code}&output=json`,
        station.riverName,
        latest
      ]
    );

    for (const reading of readings) {
      await connection.execute(
        `INSERT INTO water_readings
         (
           station_id,
           observed_at,
           water_level,
           flow_rate
         )
         VALUES (?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
           water_level = VALUES(water_level)`,
        [
          stationId,
          reading.observedAt,
          reading.waterLevel
        ]
      );
    }

    await connection.commit();

    return stationId;

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function discoverGauges() {
  const cache = loadCache();

  const [linked] = await pool.execute(
    `SELECT
       l.river_id,
       s.external_station_id
     FROM river_gauge_links l
     JOIN stations s
       ON s.station_id = l.station_id
     WHERE l.verification_status = 'VERIFIED'`
  );

  const catalogIds = new Set(
    catalog.map(river => river.river_id)
  );

  const assigned = new Map();
  const knownCodes = new Set();

  for (const row of linked) {
    knownCodes.add(
      String(row.external_station_id)
    );

    if (catalogIds.has(row.river_id)) {
      assigned.set(
        row.river_id,
        (assigned.get(row.river_id) || 0) + 1
      );
    }
  }

  const originalCovered = assigned.size;

  console.log(
    `[Gauge] Existing verified links: ${linked.length}; ` +
    `catalog rivers with gauges: ` +
    `${assigned.size}/${catalog.length}; ` +
    `legacy/out-of-catalog links: ` +
    linked.filter(
      row => !catalogIds.has(row.river_id)
    ).length
  );

  let candidates;

  try {
    candidates = await fetchStationList();
    cache.lastScan = timestamp();
  } catch (error) {
    console.warn(
      '[Gauge] Provider list unavailable. Preserving existing links:',
      error.message
    );

    return {
      status: 'PROVIDER_UNAVAILABLE',
      existing_links: linked.length,
      existing_rivers: assigned.size,
      unlinked_rivers: catalog
        .filter(river => !assigned.has(river.river_id))
        .map(river => river.name_en)
    };
  }

  // Highest priority: matching rivers with zero gauges.
  const priority = raw => {
    const code = String(raw.obscd);

    const details =
      normalizeStationInfo(raw) ||
      cache.stations[code]?.station;

    const river = matchRiver(details || null);

    if (!river) return 0;

    const count = assigned.get(river.river_id) || 0;

    if (count === 0) return 3;

    if (!FIRST_GAUGE_ONLY && count < 3) {
      return 1;
    }

    return 0;
  };

  const pending = candidates.filter(
    row => !knownCodes.has(String(row.obscd))
  );

  pending.sort(
    (a, b) =>
      compareGaugeCodes(a.obscd, b.obscd)
  );

  const high = pending.filter(
    row => priority(row) > 0
  );

  const low = pending.filter(
    row => priority(row) === 0
  );

  const offset = cache.cursor
    ? low.findIndex(
        row =>
          compareGaugeCodes(
            row.obscd,
            cache.cursor
          ) > 0
      )
    : 0;

  const start = offset < 0 ? 0 : offset;

  const retryFirst = low.filter(
    row =>
      (cache.retryCodes || []).includes(
        String(row.obscd)
      )
  );

  const retrySet = new Set(
    retryFirst.map(row => String(row.obscd))
  );

  const rotated = [
    ...low.slice(start),
    ...low.slice(0, start)
  ].filter(
    row => !retrySet.has(String(row.obscd))
  );

  const ordered = [
    ...high,
    ...retryFirst,
    ...rotated
  ];

  console.log(
    `[Gauge] Candidate stations: ${candidates.length}; ` +
    `known: ${knownCodes.size}; ` +
    `high-confidence: ${high.length}; ` +
    `resume: ${cache.cursor || 'start'}`
  );

  let attempts = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let linkedNew = 0;
  let skipped = 0;

  let cachedUnmatched = 0;
  let metadataFetched = 0;
  let metadataIncomplete = 0;
  let noRecentReadings = 0;
  let alreadyCoveredSkipped = 0;

  const retryCodes = new Set(
    Array.isArray(cache.retryCodes)
      ? cache.retryCodes
      : []
  );

  const fresh = entry =>
    entry?.station &&
    Date.now() - Date.parse(entry.fetchedAt) <
      METADATA_MAX_AGE_MS;

  let scanned = 0;
  const visited = new Set();

  for (const raw of ordered) {
    if (
      attempts >= MAX_CALLS ||
      consecutiveFailures >= FAILURE_LIMIT
    ) {
      break;
    }

    const code = String(raw.obscd);

    if (visited.has(code)) continue;

    visited.add(code);
    scanned++;

    // Save the scan position for future runs.
    if (
      priority(raw) === 0 &&
      !retryCodes.has(code)
    ) {
      cache.cursor = code;
    }

    const cached = cache.stations[code];

    if (
      cached?.status === 'unmatched' &&
      Date.now() - Date.parse(cached.checkedAt) <
        METADATA_MAX_AGE_MS
    ) {
      skipped++;
      cachedUnmatched++;
      retryCodes.delete(code);
      continue;
    }

    if (
      cached?.status === 'invalid' &&
      Date.now() - Date.parse(cached.checkedAt) <
        METADATA_MAX_AGE_MS
    ) {
      skipped++;
      metadataIncomplete++;
      retryCodes.delete(code);
      continue;
    }

    let station = fresh(cached)
      ? cached.station
      : null;

    if (!station) {
      station = normalizeStationInfo(raw);
    }

    if (!station) {
      attempts++;

      try {
        const rows = await getWamis(
          'wl_obsinfo',
          { obscd: code },
          12000
        );

        station = normalizeStationInfo(rows[0]);
        consecutiveFailures = 0;

        if (station) {
          metadataFetched++;
          retryCodes.delete(code);

          cache.stations[code] = {
            status: 'metadata',
            station,
            fetchedAt: timestamp()
          };
        } else {
          metadataIncomplete++;
          retryCodes.delete(code);

          cache.stations[code] = {
            status: 'invalid',
            checkedAt: timestamp()
          };
        }

      } catch (error) {
        failures++;
        consecutiveFailures++;
        retryCodes.add(code);

        console.warn(
          `[Gauge] Metadata unavailable ${code} ` +
          `(${consecutiveFailures}/${FAILURE_LIMIT}): ` +
          error.message
        );

        await sleep(REQUEST_DELAY_MS);
        continue;
      }
    }

    if (!station) {
      skipped++;
      continue;
    }

    const river = matchRiver(station);

    if (!river) {
      cache.stations[code] = {
        ...cache.stations[code],
        status: 'unmatched',
        checkedAt: timestamp(),
        station
      };

      skipped++;
      continue;
    }

    const existingCount =
      assigned.get(river.river_id) || 0;

    // Do not add gauge #2 or #3 when
    // the first-gauge-only option is enabled.
    if (
      existingCount >= 3 ||
      (FIRST_GAUGE_ONLY && existingCount >= 1)
    ) {
      skipped++;
      alreadyCoveredSkipped++;
      continue;
    }

    if (attempts >= MAX_CALLS) break;

    attempts++;

    try {
      const readings = mapReadings(
        await getWamis(
          'wl_hrdata',
          {
            obscd: code,
            startdt: koreanDate(2)
          },
          15000
        )
      );

      const hasRecentReadings = readings.some(
        reading =>
          ageHours(reading.observedAt) >= -0.5 &&
          ageHours(reading.observedAt) <= 48
      );

      if (!hasRecentReadings) {
        noRecentReadings++;
        skipped++;
        continue;
      }

      await linkVerifiedGauge(
        station,
        river,
        readings
      );

      assigned.set(
        river.river_id,
        (assigned.get(river.river_id) || 0) + 1
      );

      knownCodes.add(code);
      linkedNew++;
      consecutiveFailures = 0;

      console.log(
        `[Gauge] Linked ${river.name_en}: ` +
        `${station.stationName} (${code})`
      );

    } catch (error) {
      failures++;
      consecutiveFailures++;

      console.warn(
        `[Gauge] Gauge unavailable ${code} ` +
        `(${consecutiveFailures}/${FAILURE_LIMIT}): ` +
        error.message
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  cache.retryCodes = [
    ...retryCodes
  ].slice(0, 1000);

  saveCache(cache);

  const missing = catalog
    .filter(river => !assigned.has(river.river_id))
    .map(river => ({
      river_id: river.river_id,
      name: river.name_en
    }));

  const summary = {
    status:
      consecutiveFailures >= FAILURE_LIMIT
        ? 'STOPPED_PROVIDER_FAILURES'
        : 'COMPLETED_BOUNDED_PASS',

    api_attempts: attempts,
    stations_reviewed: scanned,
    next_scan_after: cache.cursor,

    metadata_fetched: metadataFetched,
    metadata_incomplete: metadataIncomplete,
    cached_unmatched: cachedUnmatched,
    no_recent_readings: noRecentReadings,

    metadata_retry_queue: cache.retryCodes.length,

    first_gauge_only: FIRST_GAUGE_ONLY,
    already_covered_skipped: alreadyCoveredSkipped,

    new_rivers_linked: assigned.size - originalCovered,
    new_links: linkedNew,
    provider_failures: failures,

    rivers_with_gauges: assigned.size,
    total_rivers: catalog.length,

    legacy_links: linked.filter(
      row => !catalogIds.has(row.river_id)
    ).length,

    unlinked_rivers: missing,
    skipped
  };

  console.log(
    '[Gauge] SUMMARY:',
    JSON.stringify(summary, null, 2)
  );

  return summary;
}

if (require.main === module) {
  discoverGauges()
    .catch(error => {
      console.error(
        '[Gauge] Error:',
        error.message
      );

      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = {
  fetchStationList,
  discoverGauges,
  linkVerifiedGauge,
  dateAgeHours: ageHours
};
