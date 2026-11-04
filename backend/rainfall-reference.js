
const SOURCE =
  'https://www.weather.go.kr/w/forecast/guide/standard.do';

const REFERENCE_CHECKED_AT = '2026-11-01';

const CRITERIA = {
  3: {
    advisory_mm: 60,
    warning_mm: 90
  },
  12: {
    advisory_mm: 110,
    warning_mm: 180
  }
};

function validNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) && n >= 0
    ? n
    : null;
}

function getPeriod(periods, hours) {
  const matches = periods.filter(
    p => Number(p?.hours) === hours
  );

  return matches.length === 1
    ? matches[0]
    : null;
}

function normalizePeriod(periods, hours) {
  const p = getPeriod(periods, hours);

  const empty = {
    hours,
    status: 'INCOMPLETE',
    rainfall_mm: null,
    rainfall_min_mm: null,
    rainfall_max_mm: null,
    rainfall_max_exclusive: null,
    forecast_status: p?.status || 'UNAVAILABLE'
  };

  if (!p) return empty;

  if (p.status === 'COMPLETE') {
    const exact = validNumber(p.rainfall_mm);

    if (exact === null) return empty;

    return {
      hours,
      status: 'EXACT',
      rainfall_mm: exact,
      rainfall_min_mm: exact,
      rainfall_max_mm: exact,
      rainfall_max_exclusive: false,
      forecast_status: p.status
    };
  }

  if (p.status === 'RANGE_AVAILABLE') {
    const min = validNumber(p.rainfall_min_mm);
    const max = validNumber(p.rainfall_max_mm);

    if (
      min === null ||
      max === null ||
      min > max ||
      (min === max &&
        p.rainfall_max_exclusive === true)
    ) {
      return empty;
    }

    return {
      hours,
      status: 'BOUNDED',
      rainfall_mm: null,
      rainfall_min_mm: min,
      rainfall_max_mm: max,
      rainfall_max_exclusive:
        p.rainfall_max_exclusive === true,
      forecast_status: p.status
    };
  }

  return empty;
}

function compareThreshold(period, threshold) {
  if (period.status === 'INCOMPLETE') {
    return 'UNKNOWN';
  }

  const min = period.rainfall_min_mm;
  const max = period.rainfall_max_mm;

  // Every possible rainfall amount meets
  // or exceeds the threshold.
  if (min >= threshold) {
    return 'MET';
  }

  // Every possible rainfall amount is
  // below the threshold.
  if (
    max < threshold ||
    (
      max === threshold &&
      period.rainfall_max_exclusive
    )
  ) {
    return 'BELOW';
  }

  // Interval overlaps the threshold.
  return 'POSSIBLE';
}

function compareRainfall(periods = []) {
  const p3 = normalizePeriod(periods, 3);
  const p12 = normalizePeriod(periods, 12);

  const advisory3 = compareThreshold(
    p3,
    CRITERIA[3].advisory_mm
  );

  const warning3 = compareThreshold(
    p3,
    CRITERIA[3].warning_mm
  );

  const advisory12 = compareThreshold(
    p12,
    CRITERIA[12].advisory_mm
  );

  const warning12 = compareThreshold(
    p12,
    CRITERIA[12].warning_mm
  );

  const advisoryResults = [
    advisory3,
    advisory12
  ];

  const warningResults = [
    warning3,
    warning12
  ];

  function combinedResult(results) {
    if (results.includes('MET')) {
      return 'MET';
    }

    if (results.includes('POSSIBLE')) {
      return 'POSSIBLE';
    }

    if (results.every(r => r === 'BELOW')) {
      return 'BELOW';
    }

    return 'UNKNOWN';
  }

  const advisoryResult = combinedResult(
    advisoryResults
  );

  const warningResult = combinedResult(
    warningResults
  );

  const allCovered =
    p3.status !== 'INCOMPLETE' &&
    p12.status !== 'INCOMPLETE';

  let status = 'INCOMPLETE';

  if (warningResult === 'MET') {
    status = 'WARNING_CRITERION_MET';
  } else if (warningResult === 'POSSIBLE') {
    status = 'WARNING_CRITERION_POSSIBLE';
  } else if (advisoryResult === 'MET') {
    status = 'ADVISORY_CRITERION_MET';
  } else if (advisoryResult === 'POSSIBLE') {
    status = 'ADVISORY_CRITERION_POSSIBLE';
  } else if (
    warningResult === 'BELOW' &&
    advisoryResult === 'BELOW'
  ) {
    status = 'BELOW_REFERENCE_CRITERIA';
  }

  return {
    status,

    coverage: allCovered
      ? 'COMPLETE'
      : 'PARTIAL',

    rainfall_3h_mm: p3.rainfall_mm,
    rainfall_12h_mm: p12.rainfall_mm,

    rainfall_3h_min_mm: p3.rainfall_min_mm,
    rainfall_3h_max_mm: p3.rainfall_max_mm,
    rainfall_3h_max_exclusive:
      p3.rainfall_max_exclusive,

    rainfall_12h_min_mm: p12.rainfall_min_mm,
    rainfall_12h_max_mm: p12.rainfall_max_mm,
    rainfall_12h_max_exclusive:
      p12.rainfall_max_exclusive,

    precipitation_coverage: {
      '3h': p3.status,
      '12h': p12.status
    },

    criteria: {
      advisory: {
        '3h_threshold_mm': CRITERIA[3].advisory_mm,
        '12h_threshold_mm': CRITERIA[12].advisory_mm,
        '3h_result': advisory3,
        '12h_result': advisory12,
        overall_result: advisoryResult
      },

      warning: {
        '3h_threshold_mm': CRITERIA[3].warning_mm,
        '12h_threshold_mm': CRITERIA[12].warning_mm,
        '3h_result': warning3,
        '12h_result': warning12,
        overall_result: warningResult
      }
    },

    source_url: SOURCE,
    reference_checked_at: REFERENCE_CHECKED_AT,

    // No live official-warning endpoint
    // is queried by this comparison.
    official_warning_issued: null,

    note:
      'Compares exact or bounded KMA rainfall ' +
      'forecasts against published heavy-rainfall ' +
      'advisory and warning criteria. MET means ' +
      'the forecast interval definitely reaches ' +
      'the criterion. POSSIBLE means its interval ' +
      'overlaps the criterion. BELOW means its ' +
      'entire interval is below the criterion. ' +
      'This is not an issued KMA warning and ' +
      'does not determine river flood risk.'
  };
}

module.exports = {
  compareRainfall
};
