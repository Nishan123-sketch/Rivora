
'use strict';

const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(
  __dirname,
  'reports',
  'all-river-ml-validation.json'
);

const MAX_REPORT_AGE_DAYS = 7;
const REQUIRED_FOLDS = 3;

let cachedReport = null;
let cachedMtime = null;

function loadValidationReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    return {
      valid: false,
      reason: 'VALIDATION_REPORT_NOT_FOUND'
    };
  }

  try {
    const stat = fs.statSync(REPORT_PATH);

    if (
      cachedReport &&
      cachedMtime === stat.mtimeMs
    ) {
      return cachedReport;
    }

    const report = JSON.parse(
      fs.readFileSync(REPORT_PATH, 'utf8')
    );

    const generatedAt = Date.parse(report.generated_at);
    const ageDays =
      (Date.now() - generatedAt) / 86400000;

    if (
      !Number.isFinite(generatedAt) ||
      ageDays < 0 ||
      ageDays > MAX_REPORT_AGE_DAYS
    ) {
      cachedReport = {
        valid: false,
        reason: 'VALIDATION_REPORT_OUTDATED'
      };
    } else if (
      !Array.isArray(report.reports)
    ) {
      cachedReport = {
        valid: false,
        reason: 'INVALID_VALIDATION_REPORT'
      };
    } else {
      cachedReport = {
        valid: true,
        generated_at: report.generated_at,
        reports: report.reports
      };
    }

    cachedMtime = stat.mtimeMs;
    return cachedReport;

  } catch (error) {
    cachedReport = null;
    cachedMtime = null;

    return {
      valid: false,
      reason: 'VALIDATION_REPORT_READ_FAILED',
      detail: error.message
    };
  }
}

function validateModelEligibility(station) {
  const report = loadValidationReport();

  if (!report.valid) {
    return {
      eligible: false,
      reason: report.reason,
      validation_status: 'NOT_VERIFIED'
    };
  }

  const stationId = Number(station.station_id);
  const wamisCode = String(
    station.external_station_id || ''
  );

  const entry = report.reports.find(row =>
    Number(row.station_id) === stationId &&
    String(row.wamis_code) === wamisCode
  );

  if (!entry) {
    return {
      eligible: false,
      reason: 'GAUGE_NOT_IN_VALIDATION_REPORT',
      validation_status: 'NOT_VERIFIED'
    };
  }

  const requiredStatus =
    'BACKTEST_EVALUATED_MODEL_SELECTED';

  const foldsValid =
    Array.isArray(entry.folds) &&
    entry.folds.length === REQUIRED_FOLDS &&
    entry.folds.every(fold =>
      Number(fold.test_samples) >= 30 &&
      Number(fold.training_samples) >= 100 &&
      Number.isFinite(
        Number(fold.ridge?.mae_m)
      ) &&
      Number.isFinite(
        Number(fold.baseline?.mae_m)
      ) &&
      Number(fold.improvement_percent) > 0
    );

  const eligible =
    entry.status === requiredStatus &&
    entry.passes_model_selection_rule === true &&
    entry.each_fold_improved === true &&
    foldsValid;

  return {
    eligible,

    reason: eligible
      ? null
      : entry.status === 'INSUFFICIENT_DATA'
        ? 'INSUFFICIENT_VALIDATION_DATA'
        : 'MODEL_NOT_SELECTED_BY_NATIONWIDE_BACKTEST',

    validation_status: eligible
      ? 'BACKTEST_EVALUATED'
      : 'NOT_SELECTED',

    report_generated_at: report.generated_at,
    gauge_station_id: stationId,
    gauge_wamis_code: wamisCode,

    nationwide_result: entry.status,

    rolling_test_windows: entry.test_windows ?? null,
    improvement_percent: entry.improvement_percent ?? null,

    ridge_mae_m: entry.ridge?.mae_m ?? null,
    baseline_mae_m: entry.baseline?.mae_m ?? null,

    official_flood_validation: false,
    official_warning_issued: null
  };
}

function applyValidationGate(modelResult, station) {
  const validation = validateModelEligibility(station);

  const result = {
    ...modelResult,
    nationwide_validation: validation
  };

  if (validation.eligible) {
    return result;
  }

  return {
    ...result,

    status: 'VALIDATION_GATE_BLOCKED',
    live_prediction: null,

    prediction_reason: validation.reason,

    validation_status:
      'EXPERIMENTAL_NOT_FLOOD_VALIDATED'
  };
}

module.exports = {
  validateModelEligibility,
  applyValidationGate
};
