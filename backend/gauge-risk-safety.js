'use strict';
// Safety gates are not an official flood-warning service.
const HOUR_MS = 3600000;
function kstMillis(value) {
  if (!value) return NaN;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]-9, +m[5], +m[6]);
}
function measurementType(stationName) {
  const s = String(stationName || '');
  if (/댐|저수지|조정지|방수로|\b(?:dam|reservoir|spillway)\b/i.test(s)) return 'POTENTIAL_DAM_OR_RESERVOIR';
  return 'UNCONFIRMED_RIVER_STAGE';
}
function evaluateGaugeSafety({station, analysis, nowMs=Date.now(), maxAgeHours=3}) {
  const name = station?.station_name ?? '';
  const measurement_type = measurementType(name);
  const timestamp = analysis?.latest_observed_at;
  const observedMs = kstMillis(timestamp);
  const age = Number.isFinite(observedMs) ? (nowMs-observedMs)/HOUR_MS : null;
  const level = analysis?.latest_water_level;
  const missing = level === null || level === undefined || level === '' || !Number.isFinite(Number(level));
  const freshness = age === null ? 'UNKNOWN' : age < -0.5 ? 'FUTURE_TIMESTAMP' : age > maxAgeHours ? 'STALE' : 'RECENT';
  const reasons=[];
  if (measurement_type === 'POTENTIAL_DAM_OR_RESERVOIR') reasons.push('DAM_OR_RESERVOIR_MEASUREMENT_UNVERIFIED');
  if (freshness !== 'RECENT') reasons.push('OBSERVATION_'+freshness);
  if (missing) reasons.push('WATER_LEVEL_MISSING');
  const t=analysis?.thresholds;
  const verified = t?.verification_status === 'VERIFIED' && Boolean(t.source_url) && Boolean(t.verified_at);
  if (!verified) reasons.push('OFFICIAL_GAUGE_THRESHOLDS_UNVERIFIED');
  const allowed=measurement_type !== 'POTENTIAL_DAM_OR_RESERVOIR' && freshness==='RECENT' && !missing && verified && analysis?.risk_status==='ASSESSED';
  return {
    measurement_type,
    measurement_type_verified:false,
    observed_age_hours:age===null?null:Number(age.toFixed(2)),
    observation_freshness:freshness,
    threshold_source_verified:verified,
    stage_comparison_allowed:allowed,
    exclusion_reasons:reasons,
    caveat:'Name-based gauge classification needs official confirmation. Gauge verification does not verify flood thresholds.'
  };
}
module.exports={kstMillis,measurementType,evaluateGaugeSafety};
