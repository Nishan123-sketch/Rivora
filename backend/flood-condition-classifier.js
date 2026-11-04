
function validNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function classifyFloodConditions(assessment) {
  if (!assessment || assessment.status !== 'PROVISIONAL') {
    return {
      ...assessment,
      condition_classification: {
        status: 'UNAVAILABLE',
        level: null,
        message: 'Insufficient current observations for assessment.'
      }
    };
  }

  const indicators = assessment.indicators || {};
  const history = assessment.history || {};
  const changes = indicators.recent_river_changes_m || {};
  const observedRain = indicators.observed_rainfall || {};
  const forecast = indicators.forecast_rainfall || {};

  const level = validNumber(indicators.current_water_level_m);
  const p90 = validNumber(history.historical_p90_m);
  const p95 = validNumber(history.historical_p95_m);

  const rise1h = validNumber(changes['1h']);
  const rise3h = validNumber(changes['3h']);
  const rise6h = validNumber(changes['6h']);

  const rain3h = observedRain.source_fresh === true
    ? validNumber(observedRain.rainfall_3h_mm)
    : null;

  const rain6h = observedRain.source_fresh === true
    ? validNumber(observedRain.rainfall_6h_mm)
    : null;

  const upcoming3h = forecast.source_fresh === true
    ? validNumber(forecast.forecast_3h?.maximum_mm)
    : null;

  const reasons = [];

  if (level === null || p90 === null || p95 === null) {
    return {
      ...assessment,
      condition_classification: {
        status: 'UNAVAILABLE',
        level: null,
        reasons: ['HISTORICAL_REFERENCE_UNAVAILABLE'],
        message: 'Historical water-level references are unavailable.'
      }
    };
  }

  const rising = rise1h !== null && rise1h > 0;
  const sustainedRise = rise3h !== null && rise3h > 0;
  const recentRain = rain3h !== null && rain3h > 0;
  const forecastRain = upcoming3h !== null && upcoming3h > 0;

  if (rising) reasons.push('RISING_LAST_HOUR');
  if (sustainedRise) reasons.push('RISING_LAST_3_HOURS');
  if (recentRain) reasons.push('RECENT_RAINFALL');
  if (forecastRain) reasons.push('UPCOMING_RAINFALL_POSSIBLE');

  // These categories are descriptive, experimental
  // condition indicators, NOT calibrated flood-risk
  // probabilities or official warning stages.
  let category;
  let message;

  if (level >= p95) {
    category = 'VERY_HIGH_RELATIVE_LEVEL';
    reasons.push('ABOVE_HISTORICAL_95TH_PERCENTILE');
    message = 'Water level is unusually high relative to this station’s available history.';
  } else if (level >= p90) {
    category = 'ELEVATED_RELATIVE_LEVEL';
    reasons.push('ABOVE_HISTORICAL_90TH_PERCENTILE');
    message = 'Water level is elevated relative to this station’s available history.';
  } else if (rising && sustainedRise && (recentRain || forecastRain)) {
    category = 'RISING_WITH_RAIN';
    message = 'The river is rising and rainfall has been observed or forecast.';
  } else if (rising || sustainedRise) {
    category = 'RISING_OBSERVED';
    message = 'A river-level rise has been observed.';
  } else {
    category = 'NO_ELEVATED_INDICATORS';
    message = 'No elevated indicators were identified by this experimental rule set.';
  }

  return {
    ...assessment,
    condition_classification: {
      status: 'PROVISIONAL',
      level: category,
      method: 'DESCRIPTIVE_RULES_V1',
      validation_status: 'NOT_VALIDATED',
      observed_water_level_m: level,
      historical_p90_m: p90,
      historical_p95_m: p95,
      changes_m: {
        one_hour: rise1h,
        three_hours: rise3h,
        six_hours: rise6h
      },
      rainfall: {
        observed_3h_mm: rain3h,
        observed_6h_mm: rain6h,
        forecast_3h_upper_bound_mm: upcoming3h
      },
      reasons,
      message,
      note: 'This describes observed conditions. It is not a validated Low/Medium/High flood-risk grade and does not replace official warnings.'
    }
  };
}

module.exports = { classifyFloodConditions };
