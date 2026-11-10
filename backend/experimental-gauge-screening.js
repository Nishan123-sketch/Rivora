'use strict';

// Station-specific historical level screening. This is NOT a calibrated
// probability of flooding, an official flood stage, or an official warning.
const {kstTime} = require('./verified-risk-evidence');
const HOUR_MS = 3600000;
const MIN_HOURS = 500;
const MIN_SPAN_DAYS = 30;
const CACHE_MS = 15 * 60 * 1000;
let cache = null;
let inFlight = null;

function numeric(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function quantile(sorted, fraction) {
  const at = (sorted.length - 1) * fraction;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

function evaluateHistory(gauge, rows, now = Date.now()) {
  const base = {
    station_id: Number(gauge.station_id),
    status: 'UNAVAILABLE',
    screening_level: null,
    method: 'STATION_HISTORICAL_LEVEL_PERCENTILES_V1',
    validation_status: 'UNVALIDATED_EXPERIMENTAL_SCREENING',
    official_warning_issued: null,
    official_flood_risk: null,
    flood_probability: null
  };
  const observed = kstTime(gauge.observed_at);
  const level = numeric(gauge.water_level_m);
  if (level === null || !Number.isFinite(observed) || now - observed > 3 * HOUR_MS || now < observed) {
    return {...base, reason: 'RIVER_OBSERVATION_STALE_OR_MISSING'};
  }
  // Use only past WAMIS observations. Do not treat gaps as zeros, and do
  // not extrapolate a gauge's history to other catchments.
  const unique = new Map();
  for (const row of rows) {
    const time = kstTime(row.observed_at);
    const value = numeric(row.water_level);
    if (Number.isFinite(time) && time <= observed && value !== null) unique.set(time, value);
  }
  const times = [...unique.keys()].sort((a, b) => a - b);
  const spanDays = times.length > 1 ? (times[times.length - 1] - times[0]) / (24 * HOUR_MS) : 0;
  if (unique.size < MIN_HOURS || spanDays < MIN_SPAN_DAYS) {
    return {...base, reason: 'INSUFFICIENT_HISTORICAL_LEVEL_DATA', history_hours: unique.size,
      history_span_days: Number(spanDays.toFixed(1))};
  }
  const levels = [...unique.values()].sort((a, b) => a - b);
  const p50 = quantile(levels, 0.5);
  const p90 = quantile(levels, 0.9);
  const p95 = quantile(levels, 0.95);
  // These names are *relative-level screening*, NOT low/medium/high flood
  // warnings. In particular, below p90 does not certify low flood risk.
  const screening = level > p95 && p95 > p50 ? 'UNUSUALLY_HIGH_RELATIVE_LEVEL'
    : level > p90 && p90 > p50 ? 'ELEVATED_RELATIVE_LEVEL'
      : 'BELOW_HISTORICAL_90TH_PERCENTILE';
  const rank = 100 * levels.filter(x => x <= level).length / levels.length;
  return {
    ...base,
    status: 'EXPERIMENTAL_SCREENING',
    reason: null,
    screening_level: screening,
    current_level_m: level,
    observed_at: gauge.observed_at,
    historical_p90_m: Number(p90.toFixed(3)),
    historical_p95_m: Number(p95.toFixed(3)),
    percentile_rank: Number(rank.toFixed(1)),
    previous_3_hour_change_m: unique.has(observed-3*HOUR_MS) ? Number((level-unique.get(observed-3*HOUR_MS)).toFixed(6)) : null,
    history_hours: unique.size,
    history_span_days: Number(spanDays.toFixed(1)),
    note: 'Historical water-level comparison only. This is not an official flood warning, not a validated flood-risk category, and does not demonstrate safety.'
  };
}

async function calculate(db, now = Date.now()) {
  const {getAssessments} = require('./verified-risk-evidence');
  const gauges = await getAssessments(db);
  const output = Array(gauges.length);
  let next = 0;
  async function worker() {
    while (next < gauges.length) {
      const i = next++;
      const gauge = gauges[i];
      try {
        // Recent indexed history only: never make remote WAMIS requests here.
        const [rows] = await db.execute(
          `SELECT DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s') AS observed_at,
                  water_level
             FROM water_readings
            WHERE station_id = ? AND observed_at <= ?
              AND observed_at >= DATE_SUB(?, INTERVAL 365 DAY)
              AND water_level IS NOT NULL
            ORDER BY observed_at DESC LIMIT 5000`,
          [gauge.station_id, gauge.observed_at || '1970-01-01 00:00:00',
            gauge.observed_at || '1970-01-01 00:00:00']
        );
        output[i] = evaluateHistory(gauge, rows, now);
      } catch (error) {
        output[i] = {station_id: gauge.station_id, status: 'UNAVAILABLE',
          screening_level: null, reason: 'GAUGE_HISTORY_QUERY_FAILED', official_flood_risk: null};
        console.warn('[Level screening]', gauge.station_id, error.code || error.message);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  const assessed = output.filter(x => x.status === 'EXPERIMENTAL_SCREENING').length;
  return {
    success: true,
    generated_at: new Date(now).toISOString(),
    total_gauges: output.length,
    experimental_screenings: assessed,
    unavailable: output.length - assessed,
    official_warning_coverage: 'NOT_CHECKED',
    note: 'All classifications describe relative water-level conditions, not validated flood-risk categories.',
    data: output
  };
}

async function getScreening(db = require('./db')) {
  if (cache && Date.now() - cache.timestamp < CACHE_MS) return cache.result;
  if (!inFlight) {
    inFlight = calculate(db).then(result => {
      cache = {timestamp: Date.now(), result};
      return result;
    }).finally(() => {inFlight = null;});
  }
  return inFlight;
}

module.exports = {evaluateHistory, calculate, getScreening};
