'use strict';

// Evidentiary references only. A secondary dashboard and a past published
// warning do not authorize Rivora to issue an official warning or assert
// a current gauge-specific risk classification.
const REFERENCE_RECORDS = Object.freeze({
  '2201670': {
    station_id: 207,
    station_name_ko: '울산시(태화교)',
    sources: [
      {
        publisher: 'KBS Disaster Portal (flood-control-office data)',
        observed_reference: '2026-10-20',
        advisory_stage_m: 8.2,
        warning_stage_m: 9.2,
        vertical_basis: 'GAUGE_STAGE_REPORTED',
        source_url: 'https://d2.kbs.co.kr/now/flood'
      },
      {
        publisher: 'Yonhap, quoting Nakdong River Flood Control Office',
        observed_reference: '2025-07-19',
        advisory_stage_m: 4.5,
        warning_stage_m: null,
        vertical_basis: 'GAUGE_STAGE_REPORTED',
        source_url: 'https://www.yna.co.kr/view/AKR20250719009900057'
      }
    ]
  }
});

function evaluatePublishedReferences(gauge) {
  const stationId = Number(gauge.station_id);
  const code = String(gauge.wamis_code || gauge.external_station_id || '');
  const reference = REFERENCE_RECORDS[code];
  if (!reference || reference.station_id !== stationId) {
    return {status: 'NO_RECONCILED_REFERENCE', verified: false, official_warning_issued: null};
  }
  const stages = reference.sources.map(s => s.advisory_stage_m)
    .filter(Number.isFinite);
  const disputed = new Set(stages).size > 1;
  const level = gauge.water_level_m == null ? null : Number(gauge.water_level_m);
  const comparisons = reference.sources.map(source => ({
    publisher: source.publisher,
    observed_reference: source.observed_reference,
    advisory_stage_m: source.advisory_stage_m,
    warning_stage_m: source.warning_stage_m,
    source_url: source.source_url,
    comparison: Number.isFinite(level)
      ? (level >= source.advisory_stage_m ? 'AT_OR_ABOVE_PUBLISHED_ADVISORY_STAGE' : 'BELOW_PUBLISHED_ADVISORY_STAGE')
      : 'NO_CURRENT_OBSERVATION'
  }));
  return {
    status: disputed ? 'CONFLICTING_PUBLISHED_STAGE_CRITERIA' : 'REFERENCE_ONLY_NOT_CERTIFIED',
    verified: false,
    stage_criteria_currentness_confirmed: false,
    station_id: stationId,
    wamis_code: code,
    observed_level_m: Number.isFinite(level) ? level : null,
    published_references: comparisons,
    official_warning_issued: null,
    risk_level: null,
    note: disputed
      ? 'Published advisory stages disagree. Do not choose a risk category until the responsible flood control office verifies which stage and datum apply to this WAMIS gauge today.'
      : 'Published stage evidence is reference-only until gauge identity, datum and current applicability are confirmed.'
  };
}

module.exports = {REFERENCE_RECORDS, evaluatePublishedReferences};
