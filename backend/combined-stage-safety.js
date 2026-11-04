'use strict';

const { evaluateGaugeSafety } = require('./gauge-risk-safety');

// A predicted stage is not an official warning. Require the current gauge's
// verified reference, a recent observation, and the separate flood endpoint's
// positive assessment before exposing its stage comparison.
function evaluateCombinedStageSafety({ station, river, floodPrediction, nowMs = Date.now() }) {
  const quality = evaluateGaugeSafety({
    station: {
      station_name: station?.station_name || river?.station_name || ''
    },
    analysis: {
      latest_observed_at: river?.latest_observed_at,
      latest_water_level: river?.latest_water_level,
      thresholds: river?.thresholds,
      risk_status: river?.risk_status
    },
    nowMs
  });

  const sameStation = Boolean(
    station?.station_id &&
    river?.station_id &&
    Number(station.station_id) === Number(river.station_id)
  );
  const floodAssessed = floodPrediction?.stage_thresholds_available === true &&
    floodPrediction?.assessment_status === 'ASSESSED';
  const reasons = [...quality.exclusion_reasons];
  if (!sameStation) reasons.push('STATION_IDENTITY_UNCONFIRMED');
  if (!floodAssessed) reasons.push('FLOOD_PREDICTION_STAGE_ASSESSMENT_UNAVAILABLE');

  return {
    ...quality,
    station_identity_confirmed: sameStation,
    flood_prediction_stage_assessed: floodAssessed,
    stage_comparison_allowed: quality.stage_comparison_allowed && sameStation && floodAssessed,
    exclusion_reasons: reasons
  };
}

module.exports = { evaluateCombinedStageSafety };
