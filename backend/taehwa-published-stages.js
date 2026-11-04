
'use strict';

// Taehwa Bridge (울산시 태화교) — WAMIS 2201670
// Flood-stage comparison is disabled until current
// gauge datum and threshold compatibility are confirmed.

const REFERENCE = Object.freeze({
  site_name_ko: '울산시(태화교)',
  river_name_ko: '태화강',
  wamis_station_code_candidate: '2201670',

  // Currently displayed by KBS Disaster Portal.
  advisory_stage_m: 8.2,
  warning_stage_m: 9.2,

  source: 'KBS Disaster Portal - Flood',
  source_url: 'https://md2.kbs.co.kr/now/flood',

  verification_status: 'CURRENT_REFERENCE_REQUIRES_CONFIRMATION',
  gauge_identity_and_datum_status: 'REQUIRES_CONFIRMATION',
  verified_for_automatic_stage_assessment: false,

  // Previous stages are preserved only as history.
  historical_reference: {
    advisory_stage_m: 4.5,
    warning_stage_m: 5.5,
    status: 'HISTORICAL_NOT_FOR_CURRENT_ASSESSMENT'
  }
});

function getKstAgeHours(observedAt, now = new Date()) {
  if (!observedAt) return null;

  const text = String(observedAt).trim();

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second] =
    match.map(Number);

  const timestamp = Date.UTC(
    year,
    month - 1,
    day,
    hour - 9,
    minute,
    second
  );

  if (!Number.isFinite(timestamp)) return null;

  const hours = (now.getTime() - timestamp) / 3600000;

  return Number.isFinite(hours)
    ? Math.round(hours * 100) / 100
    : null;
}

function compareTaehwaPublishedStages({
  stationCode,
  level,
  observedAt,
  now = new Date()
}) {
  if (String(stationCode) !== '2201670') {
    return null;
  }

  const ageHours = getKstAgeHours(observedAt, now);

  const numericLevel =
    level === null || level === undefined || level === ''
      ? null
      : Number(level);

  const validLevel =
    numericLevel !== null &&
    Number.isFinite(numericLevel);

  const fresh =
    ageHours !== null &&
    ageHours >= -0.5 &&
    ageHours <= 3;

  return {
    ...REFERENCE,

    observation_time_kst: observedAt || null,
    observation_age_hours: ageHours,
    observation_fresh: fresh,
    observation_level_m: validLevel ? numericLevel : null,

    // Deliberately disabled: datum compatibility
    // and current stage definitions remain unresolved.
    indicative_stage_comparison: 'NOT_ASSESSED',

    official_warning_issued: null,
    operational_flood_stage_status: 'NOT_ASSESSED',

    stage_comparison_allowed: false,

    exclusion_reasons: [
      'CURRENT_STAGE_DEFINITIONS_NOT_CONFIRMED',
      'GAUGE_DATUM_COMPATIBILITY_NOT_CONFIRMED'
    ],

    explanation:
      'The current published reference lists 8.2 m advisory ' +
      'and 9.2 m warning, while older publications list ' +
      '4.5 m and 5.5 m. Their difference is unresolved. ' +
      'This application does not infer an official warning.'
  };
}

module.exports = {
  REFERENCE,
  getKstAgeHours,
  compareTaehwaPublishedStages
};
