'use strict';

// This module never creates flood thresholds or asserts official warnings.
// A gauge identity and a published stage/datum match require separate evidence.
// Load the database only when an API request is made, so pure validation tests
// do not need a running MySQL connection or locally installed dependencies.
const HOUR_MS = 3600000;
const MAX_AGE_HOURS = 3;
const {evaluatePublishedReferences} = require('./published-stage-reference');

const OFFICIAL_HOSTS = new Set([
  'flood.go.kr', 'n.flood.go.kr', 'hrfco.go.kr', 'www.hrfco.go.kr',
  'wamis.go.kr', 'www.wamis.go.kr', 'data.go.kr', 'www.data.go.kr',
  'water.or.kr', 'www.water.or.kr', 'www.yeongsanriver.go.kr', 'www.nakdongriver.go.kr'
]);

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function kstTime(v) {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  const m = String(v).match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)$/);
  if (!m) return NaN;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h - 9, mi, s);
  const c = new Date(t + 9 * HOUR_MS);
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 ||
      c.getUTCDate() !== d || c.getUTCHours() !== h ||
      c.getUTCMinutes() !== mi || c.getUTCSeconds() !== s) return NaN;
  return t;
}

function officialUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && OFFICIAL_HOSTS.has(u.hostname.toLowerCase()) &&
      u.pathname.length > 1;
  } catch { return false; }
}

function stageEvidence(row) {
  const levels = [
    num(row.interest_level_m), num(row.caution_level_m),
    num(row.alert_level_m), num(row.severe_level_m)
  ];
  if (String(row.verification_status).toUpperCase() !== 'VERIFIED' ||
      !row.verified_at || !officialUrl(row.source_url) ||
      levels.some(v => v === null) || !levels.every((v, i) => !i || v > levels[i - 1])) {
    return { verified: false, reason: 'OFFICIAL_STAGES_NOT_VERIFIED' };
  }
  // Explicit operator-reviewed WAMIS identity AND stage measurement datum.
  // Prevents an unverified CSV import or nearby station's levels from being promoted.
  const reference = String(row.reference_source || '');
  const code = String(row.external_station_id || '');
  const identity = reference.match(/(?:^|;)WAMIS:(\d{5,12})(?:;|$)/);
  if (!identity || identity[1] !== code) {
    return { verified: false, reason: 'STAGE_GAUGE_IDENTITY_NOT_RECONCILED' };
  }
  if (!/(?:^|;)DATUM:(?:CONFIRMED|REQUIRES_INDEPENDENT_REVIEW)(?:;|$)/.test(reference)) {
    return { verified: false, reason: 'STAGE_DATUM_NOT_CONFIRMED' };
  }
  return { verified: true, levels, source_url: row.source_url,
    verified_at: row.verified_at, reference_source: reference };
}

function evaluate(row, now = Date.now()) {
  const level = num(row.water_level);
  const observedMs = kstTime(row.observed_at);
  const age = Number.isFinite(observedMs) ? (now - observedMs) / HOUR_MS : null;
  const fresh = age !== null && age >= 0 && age <= MAX_AGE_HOURS;
  const threshold = stageEvidence(row);
  const previousLevel = num(row.previous_water_level);
  const previousMs = kstTime(row.previous_observed_at);
  const hoursBetween = Number.isFinite(previousMs) && Number.isFinite(observedMs)
    ? (observedMs - previousMs) / HOUR_MS : null;
  // Use only a real observation precisely one hour earlier. A missing
  // reading is never replaced by a zero change.
  const hourlyChange = hoursBetween === 1 && previousLevel !== null && level !== null
    ? Number((level - previousLevel).toFixed(3)) : null;
  const trend = !fresh || hourlyChange === null ? 'UNKNOWN'
    : hourlyChange > 0 ? 'RISING'
    : hourlyChange < 0 ? 'FALLING' : 'UNCHANGED';
  const name = String(row.station_name || '');
  const possibleDam = require('./gauge-risk-safety').measurementType(name)==='POTENTIAL_DAM_OR_RESERVOIR';

  let reason = null;
  if (level === null) reason = 'NO_WATER_LEVEL_OBSERVATION';
  else if (!fresh) reason = 'WATER_LEVEL_STALE';
  else if (possibleDam) reason = 'POTENTIAL_DAM_DATUM_OR_MEASUREMENT_TYPE_UNVERIFIED';
  else if (!threshold.verified) reason = threshold.reason;
  const compatibility = require('./measurement-compatibility').compatibility(row,{observed_at:row.observed_at,water_level:row.water_level,source_url:row.observation_source_url},row);
  if (!reason && !compatibility.verified) reason = compatibility.reason;

  let officialStage = null;
  let riskLevel = null;
  if (!reason) {
    const [interest, caution, alert, serious] = threshold.levels;
    officialStage = level >= serious ? 'SERIOUS' : level >= alert ? 'ALERT' :
      level >= caution ? 'CAUTION' : level >= interest ? 'INTEREST' : 'BELOW_INTEREST';
    // Risk labels are our threshold comparison, NOT a government-issued advisory.
    riskLevel = level >= alert ? 'High' : level >= caution ? 'Moderate' : 'Low';
  }
  return {
    station_id: row.station_id,
    station_name: row.station_name,
    wamis_code: String(row.external_station_id),
    water_level_m: level,
    observed_at: row.observed_at ?? null,
    observation_age_hours: age === null ? null : Number(age.toFixed(2)),
    observation_status: level === null ? 'MISSING' : fresh ? 'FRESH' : 'STALE',
    observed_conditions: {
      status: fresh ? 'OBSERVED' : 'UNAVAILABLE',
      water_level_trend: trend,
      previous_hour_change_m: fresh ? hourlyChange : null,
      trend_basis: 'TWO_CONSECUTIVE_WAMIS_HOURLY_OBSERVATIONS',
      note: 'Water-level trend describes observations; it is not a flood-risk classification.'
    },
    published_stage_review: evaluatePublishedReferences({
      station_id: row.station_id,
      wamis_code: row.external_station_id,
      water_level_m: fresh ? level : null
    }),
    published_threshold_metadata_verified: threshold.verified,
    stage_evidence_verified: threshold.verified && compatibility.verified,
    stage_evidence_reason: threshold.verified ? null : threshold.reason,
    source_url: threshold.verified ? threshold.source_url : null,
    risk_level: riskLevel,
    risk_basis: riskLevel === null ? null : 'VERIFIED_STAGE',
    threshold_stage: officialStage,
    assessment_status: reason ? 'NOT_ASSESSED' : 'ASSESSED',
    measurement_compatibility: compatibility,
    reason,
    official_warning_issued: null,
    official_warning_status: 'NOT_CHECKED',
    classification_note: 'Station-specific verified-stage comparison, not an issued official warning or forecast.'
  };
}

const BASE_SQL = `
  SELECT s.station_id, s.station_name, s.external_station_id,
    DATE_FORMAT(w.observed_at, '%Y-%m-%d %H:%i:%s') AS observed_at,
    w.water_level,w.source_url AS observation_source_url,
    DATE_FORMAT(prev.observed_at, '%Y-%m-%d %H:%i:%s') AS previous_observed_at,
    prev.water_level AS previous_water_level,
    t.interest_level_m, t.caution_level_m,
    t.alert_level_m, t.severe_level_m, t.verification_status,
    t.verified_at, t.source_url, t.reference_source
  FROM stations s
  JOIN (SELECT DISTINCT station_id FROM river_gauge_links
        WHERE verification_status = 'VERIFIED') linked ON linked.station_id = s.station_id
  LEFT JOIN water_readings w ON w.reading_id = (
    SELECT w2.reading_id FROM water_readings w2
    WHERE w2.station_id = s.station_id
    ORDER BY w2.observed_at DESC, w2.reading_id DESC LIMIT 1
  )
  LEFT JOIN water_readings prev ON prev.reading_id = (
    SELECT p.reading_id FROM water_readings p
    WHERE p.station_id = s.station_id AND p.observed_at < w.observed_at
    ORDER BY p.observed_at DESC, p.reading_id DESC LIMIT 1
  )
  LEFT JOIN flood_thresholds t ON t.station_id = s.station_id
  WHERE s.data_source = 'RIVER_GAUGE' AND s.external_station_id IS NOT NULL`;

async function getAssessments(db = require('./db'), now = Date.now()) {
  const [rows] = await db.query(`${BASE_SQL} ORDER BY s.station_id`);
  return rows.map(row => evaluate(row,now));
}

async function getAssessmentById(stationId, db = require('./db')) {
  if (!Number.isSafeInteger(Number(stationId)) || Number(stationId) <= 0) return null;
  const [rows] = await db.execute(`${BASE_SQL} AND s.station_id = ? LIMIT 1`, [Number(stationId)]);
  return rows.length ? evaluate(rows[0]) : null;
}

function coverage(rows) {
  const counts = {total_gauges: rows.length, verified_stage_evidence: 0, assessed: 0,
    not_assessed: 0, fresh_observations: 0, stale_or_missing: 0};
  const reasons = {};
  for (const row of rows) {
    if (row.stage_evidence_verified) counts.verified_stage_evidence++;
    if (row.observation_status === 'FRESH') counts.fresh_observations++;
    else counts.stale_or_missing++;
    if (row.assessment_status === 'ASSESSED') counts.assessed++;
    else { counts.not_assessed++; reasons[row.reason] = (reasons[row.reason] || 0) + 1; }
  }
  return { ...counts, reasons, official_warning_coverage: 'NOT_CHECKED',
    caveat: 'Every gauge can be monitored; no unsupported Low/Moderate/High classification is assigned.'};
}

module.exports = { num, kstTime, officialUrl, stageEvidence, evaluate, coverage,
  getAssessments, getAssessmentById };
