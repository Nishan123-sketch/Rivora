
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

const HOUR_MS = 3600000;

const CONFIG = {
  historyLimit: 10000,
  folds: 3,
  minTrainingSamples: 100,
  minTestSamplesPerFold: 30,
  minimumImprovementPercent: 5,
  ridgeLambda: 10
};

function round(value, digits = 5) {
  return Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : null;
}

function parseKst(value) {
  const match = String(value ?? '').match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return NaN;

  const [, y, month, d, h, minute, second] =
    match.map(Number);

  const ms = Date.UTC(
    y, month - 1, d, h - 9, minute, second
  );

  const check = new Date(ms + 9 * HOUR_MS);

  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== minute
  ) {
    return NaN;
  }

  return ms;
}

function metrics(errors) {
  if (!errors.length) {
    return {
      count: 0,
      mae_m: null,
      rmse_m: null,
      bias_m: null
    };
  }

  const count = errors.length;

  const mae = errors.reduce(
    (total, e) => total + Math.abs(e),
    0
  ) / count;

  const mse = errors.reduce(
    (total, e) => total + e * e,
    0
  ) / count;

  const bias = errors.reduce(
    (total, e) => total + e,
    0
  ) / count;

  return {
    count,
    mae_m: round(mae),
    rmse_m: round(Math.sqrt(mse)),
    bias_m: round(bias)
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);

  return sorted[low] +
    (sorted[high] - sorted[low]) * (index - low);
}

function solve(matrix, vector) {
  const n = vector.length;

  const a = matrix.map((row, index) => [
    ...row,
    vector[index]
  ]);

  for (let col = 0; col < n; col++) {
    let pivot = col;

    for (let row = col + 1; row < n; row++) {
      if (
        Math.abs(a[row][col]) >
        Math.abs(a[pivot][col])
      ) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][col]) < 1e-12) {
      return null;
    }

    [a[col], a[pivot]] = [a[pivot], a[col]];

    const divisor = a[col][col];

    for (let j = col; j <= n; j++) {
      a[col][j] /= divisor;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;

      const factor = a[row][col];

      for (let j = col; j <= n; j++) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  return a.map(row => row[n]);
}

function trainRidge(samples) {
  if (samples.length < CONFIG.minTrainingSamples) {
    return null;
  }

  const featureCount = 3;
  const means = [];
  const scales = [];

  for (let j = 0; j < featureCount; j++) {
    const mean = samples.reduce(
      (sum, sample) => sum + sample.features[j],
      0
    ) / samples.length;

    const variance = samples.reduce(
      (sum, sample) =>
        sum + (sample.features[j] - mean) ** 2,
      0
    ) / samples.length;

    means.push(mean);
    scales.push(Math.sqrt(variance) || 1);
  }

  const size = featureCount + 1;

  const xtx = Array.from(
    { length: size },
    () => Array(size).fill(0)
  );

  const xty = Array(size).fill(0);

  for (const sample of samples) {
    const x = [
      1,
      ...sample.features.map(
        (value, j) => (value - means[j]) / scales[j]
      )
    ];

    for (let i = 0; i < size; i++) {
      xty[i] += x[i] * sample.targetChange;

      for (let j = 0; j < size; j++) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  // Regularize slopes, not intercept.
  for (let i = 1; i < size; i++) {
    xtx[i][i] += CONFIG.ridgeLambda;
  }

  const coefficients = solve(xtx, xty);

  return coefficients
    ? { coefficients, means, scales }
    : null;
}

function predictChange(model, features) {
  let value = model.coefficients[0];

  for (let i = 0; i < features.length; i++) {
    value +=
      model.coefficients[i + 1] *
      (features[i] - model.means[i]) /
      model.scales[i];
  }

  return value;
}

function prepareReadings(rows) {
  const parsed = rows
    .map(row => ({
      time: parseKst(row.observed_at),
      level: Number(row.water_level)
    }))
    .filter(row =>
      Number.isFinite(row.time) &&
      Number.isFinite(row.level)
    )
    .sort((a, b) => a.time - b.time);

  const unique = [];
  let duplicates = 0;

  for (const row of parsed) {
    if (
      unique.length &&
      row.time === unique[unique.length - 1].time
    ) {
      duplicates++;
      continue;
    }

    unique.push(row);
  }

  let consecutivePairs = 0;

  for (let i = 1; i < unique.length; i++) {
    if (
      unique[i].time - unique[i - 1].time ===
      HOUR_MS
    ) {
      consecutivePairs++;
    }
  }

  const spanHours = unique.length > 1
    ? (unique.at(-1).time - unique[0].time) /
      HOUR_MS
    : 0;

  return {
    readings: unique,
    duplicate_timestamps: duplicates,
    consecutive_pairs: consecutivePairs,
    span_days: round(spanHours / 24, 2),
    hourly_coverage_percent:
      spanHours > 0
        ? round(
            100 * (unique.length - 1) / spanHours,
            2
          )
        : null
  };
}

function buildSamples(readings) {
  const samples = [];

  for (let i = 3; i < readings.length - 1; i++) {
    const window = readings.slice(i - 3, i + 2);

    const consecutive = window.every(
      (row, index) =>
        index === 0 ||
        row.time - window[index - 1].time ===
          HOUR_MS
    );

    if (!consecutive) continue;

    const current = readings[i];
    const next = readings[i + 1];

    samples.push({
      time: current.time,
      features: [
        readings[i].level - readings[i - 1].level,
        readings[i - 1].level - readings[i - 2].level,
        readings[i - 2].level - readings[i - 3].level
      ],
      currentLevel: current.level,
      nextLevel: next.level,
      targetChange: next.level - current.level
    });
  }

  return samples;
}

function evaluateGauge(rows) {
  const prepared = prepareReadings(rows);
  const readings = prepared.readings;
  const samples = buildSamples(readings);

  const base = {
    status: 'INSUFFICIENT_DATA',
    model: 'WATER_LEVEL_RIDGE_EXPERIMENTAL',
    source: 'WAMIS',
    history_records: readings.length,
    history_span_days: prepared.span_days,
    hourly_coverage_percent:
      prepared.hourly_coverage_percent,
    duplicate_timestamps:
      prepared.duplicate_timestamps,
    consecutive_samples: samples.length,
    official_flood_validation: false,
    official_warning_issued: null,
    flood_risk_level: null,
    folds: [],
    limitations: []
  };

  const testSize = Math.max(
    CONFIG.minTestSamplesPerFold,
    Math.floor(samples.length * 0.15)
  );

  const firstTrainingSize =
    samples.length - CONFIG.folds * testSize;

  if (
    firstTrainingSize < CONFIG.minTrainingSamples
  ) {
    return {
      ...base,
      reason: 'NOT_ENOUGH_CONSECUTIVE_HOURLY_SAMPLES',
      minimum_required:
        CONFIG.minTrainingSamples +
        CONFIG.folds *
          CONFIG.minTestSamplesPerFold
    };
  }

  const allRidgeErrors = [];
  const allBaselineErrors = [];

  const allHighRidgeErrors = [];
  const allHighBaselineErrors = [];

  const foldReports = [];

  for (let fold = 0; fold < CONFIG.folds; fold++) {
    const trainEnd =
      firstTrainingSize + fold * testSize;

    const train = samples.slice(0, trainEnd);
    const test = samples.slice(
      trainEnd,
      trainEnd + testSize
    );

    const model = trainRidge(train);

    if (!model) {
      return {
        ...base,
        status: 'TRAINING_FAILED',
        reason: `RIDGE_TRAINING_FAILED_FOLD_${fold + 1}`
      };
    }

    // This is a relative high-water threshold,
    // calculated only from the training period.
    // It is NOT an official flood-warning threshold.
    const highWaterReference = percentile(
      train.map(sample => sample.currentLevel),
      0.9
    );

    const ridgeErrors = [];
    const baselineErrors = [];

    const highRidgeErrors = [];
    const highBaselineErrors = [];

    for (const sample of test) {
      const ridgePrediction =
        sample.currentLevel +
        predictChange(model, sample.features);

      if (!Number.isFinite(ridgePrediction)) {
        return {
          ...base,
          status: 'TRAINING_FAILED',
          reason: 'NON_FINITE_MODEL_PREDICTION'
        };
      }

      const ridgeError =
        ridgePrediction - sample.nextLevel;

      const baselineError =
        sample.currentLevel - sample.nextLevel;

      ridgeErrors.push(ridgeError);
      baselineErrors.push(baselineError);

      allRidgeErrors.push(ridgeError);
      allBaselineErrors.push(baselineError);

      if (
        sample.currentLevel >= highWaterReference
      ) {
        highRidgeErrors.push(ridgeError);
        highBaselineErrors.push(baselineError);

        allHighRidgeErrors.push(ridgeError);
        allHighBaselineErrors.push(baselineError);
      }
    }

    const ridgeMetrics = metrics(ridgeErrors);
    const baselineMetrics = metrics(baselineErrors);

    const improvement =
      baselineMetrics.mae_m > 0
        ? 100 * (
            1 -
            ridgeMetrics.mae_m /
              baselineMetrics.mae_m
          )
        : null;

    foldReports.push({
      fold: fold + 1,
      training_samples: train.length,
      test_samples: test.length,
      ridge: ridgeMetrics,
      baseline: baselineMetrics,
      improvement_percent: round(improvement, 2),
      high_water_reference_m:
        round(highWaterReference, 3),
      high_water_test_samples: highRidgeErrors.length,
      high_water_ridge: metrics(highRidgeErrors),
      high_water_baseline: metrics(highBaselineErrors)
    });
  }

  const ridge = metrics(allRidgeErrors);
  const baseline = metrics(allBaselineErrors);

  const improvement =
    baseline.mae_m > 0
      ? 100 * (
          1 - ridge.mae_m / baseline.mae_m
        )
      : null;

  const eachFoldImproves = foldReports.every(
    fold =>
      fold.improvement_percent !== null &&
      fold.improvement_percent > 0
  );

  const passesSelection =
    improvement !== null &&
    improvement >=
      CONFIG.minimumImprovementPercent &&
    eachFoldImproves;

  const highWaterRidge = metrics(allHighRidgeErrors);
  const highWaterBaseline =
    metrics(allHighBaselineErrors);

  const limitations = [];

  if (prepared.span_days < 365) {
    limitations.push(
      'Less than one year of historical coverage; ' +
      'seasonal generalization is not established.'
    );
  }

  if (allHighRidgeErrors.length < 30) {
    limitations.push(
      'Insufficient relatively high-water test samples.'
    );
  }

  if (
    prepared.hourly_coverage_percent !== null &&
    prepared.hourly_coverage_percent < 90
  ) {
    limitations.push(
      'Historical hourly observations contain substantial gaps.'
    );
  }

  limitations.push(
    'High-water percentiles are not official flood stages.'
  );

  limitations.push(
    'Documented flood events and peak timing have not been independently validated.'
  );

  limitations.push(
    'Training and test samples may not contain extreme floods.'
  );

  limitations.push(
    'The model uses WAMIS water levels only; catchment rainfall and dam operations are not modeled.'
  );

  return {
    ...base,

    status: passesSelection
      ? 'BACKTEST_EVALUATED_MODEL_SELECTED'
      : 'BACKTEST_EVALUATED_BASELINE_PREFERRED',

    reason: passesSelection
      ? null
      : 'MODEL_DID_NOT_PASS_SELECTION_RULE',

    method: 'EXPANDING_WINDOW_ROLLING_ORIGIN',
    test_windows: CONFIG.folds,

    training_samples_first_fold:
      firstTrainingSize,

    total_out_of_sample_predictions:
      allRidgeErrors.length,

    ridge,
    baseline,

    improvement_percent:
      round(improvement, 2),

    each_fold_improved:
      eachFoldImproves,

    passes_model_selection_rule:
      passesSelection,

    high_water_analysis: {
      definition:
        'Observed level at or above training-period 90th percentile',
      official_flood_event: false,
      evaluated_samples:
        allHighRidgeErrors.length,
      ridge: highWaterRidge,
      baseline: highWaterBaseline
    },

    folds: foldReports,
    limitations
  };
}

function csvEscape(value) {
  const text = value === null ||
    value === undefined
      ? ''
      : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(reports) {
  const columns = [
    'station_id',
    'station_name',
    'wamis_code',
    'status',
    'history_records',
    'history_span_days',
    'hourly_coverage_percent',
    'consecutive_samples',
    'test_windows',
    'total_out_of_sample_predictions',
    'ridge_mae_m',
    'baseline_mae_m',
    'ridge_rmse_m',
    'baseline_rmse_m',
    'ridge_bias_m',
    'baseline_bias_m',
    'improvement_percent',
    'each_fold_improved',
    'passes_model_selection_rule',
    'high_water_test_samples',
    'limitations'
  ];

  const lines = [columns.join(',')];

  for (const report of reports) {
    const row = {
      ...report,
      ridge_mae_m: report.ridge?.mae_m,
      baseline_mae_m: report.baseline?.mae_m,
      ridge_rmse_m: report.ridge?.rmse_m,
      baseline_rmse_m: report.baseline?.rmse_m,
      ridge_bias_m: report.ridge?.bias_m,
      baseline_bias_m: report.baseline?.bias_m,
      high_water_test_samples:
        report.high_water_analysis?.evaluated_samples,
      limitations:
        (report.limitations || []).join('; ')
    };

    lines.push(
      columns.map(key => csvEscape(row[key])).join(',')
    );
  }

  return lines.join('\n');
}

async function main() {
  console.log(
    'Starting nationwide WAMIS ML validation...'
  );

  const [stations] = await pool.execute(
    `SELECT DISTINCT
       s.station_id,
       s.station_name,
       s.external_station_id
     FROM stations s
     JOIN river_gauge_links l
       ON l.station_id = s.station_id
     WHERE s.data_source = 'RIVER_GAUGE'
       AND l.verification_status = 'VERIFIED'
       AND s.external_station_id IS NOT NULL
     ORDER BY s.station_id`
  );

  console.log(
    `Verified linked gauges: ${stations.length}`
  );

  const reports = [];

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];

    try {
      const [rows] = await pool.execute(
        `SELECT
           DATE_FORMAT(
             observed_at,
             '%Y-%m-%d %H:%i:%s'
           ) AS observed_at,
           water_level
         FROM water_readings
         WHERE station_id = ?
           AND water_level IS NOT NULL
         ORDER BY observed_at DESC
         LIMIT ${CONFIG.historyLimit}`,
        [station.station_id]
      );

      const result = evaluateGauge(rows);

      const report = {
        station_id: station.station_id,
        station_name: station.station_name,
        wamis_code: station.external_station_id,
        ...result
      };

      reports.push(report);

      console.log(
        `[${i + 1}/${stations.length}]`,
        station.station_name,
        '=>',
        result.status,
        '| improvement:',
        result.improvement_percent ?? 'N/A',
        '%'
      );

    } catch (error) {
      reports.push({
        station_id: station.station_id,
        station_name: station.station_name,
        wamis_code: station.external_station_id,
        status: 'ERROR',
        reason: error.message,
        official_flood_validation: false
      });

      console.error(
        `Failed station ${station.station_id}:`,
        error.message
      );
    }
  }

  const counts = {};

  for (const report of reports) {
    counts[report.status] =
      (counts[report.status] || 0) + 1;
  }

  const output = {
    system: 'Weather and Flood Risk Forecasting',
    generated_at: new Date().toISOString(),

    methodology: {
      source: 'WAMIS',
      model: 'Water-level Ridge Regression',
      comparator: 'Persistence baseline',
      evaluation:
        'Three expanding-window chronological tests',
      model_selection_improvement_percent:
        CONFIG.minimumImprovementPercent,
      warning:
        'Model selection is not official flood validation.'
    },

    total_gauges: stations.length,
    status_counts: counts,
    reports
  };

  const directory = path.join(__dirname, 'reports');

  fs.mkdirSync(directory, { recursive: true });

  const jsonPath = path.join(
    directory,
    'all-river-ml-validation.json'
  );

  const csvPath = path.join(
    directory,
    'all-river-ml-validation.csv'
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    csvPath,
    toCsv(reports),
    'utf8'
  );

  console.log('\nValidation completed.');
  console.log('Total gauges:', stations.length);
  console.log('Results:', counts);
  console.log('JSON:', jsonPath);
  console.log('CSV:', csvPath);
}

main()
  .catch(error => {
    console.error('Validation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
