
'use strict';

const HOUR_MS = 3600000;
const MIN_TRAIN = 100;
const MIN_TEST = 30;
const MAX_AGE_HOURS = 3;
const REQUIRED_IMPROVEMENT = 0.05;

function kstMillis(value) {
  const m = String(value ?? '').match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!m) return NaN;

  const [, y, month, d, h, minute, second] = m.map(Number);

  const ms = Date.UTC(
    y, month - 1, d, h - 9, minute, second
  );

  const check = new Date(ms + 9 * HOUR_MS);

  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h
  ) {
    return NaN;
  }

  return ms;
}

function kstString(ms) {
  return new Date(ms + 9 * HOUR_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function solve(matrix, vector) {
  const n = vector.length;

  const a = matrix.map((row, i) => [
    ...row,
    vector[i]
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
  const featureCount = 3;

  const means = Array(featureCount).fill(0);
  const scales = Array(featureCount).fill(1);

  for (let j = 0; j < featureCount; j++) {
    means[j] =
      samples.reduce(
        (sum, s) => sum + s.features[j],
        0
      ) / samples.length;

    const variance =
      samples.reduce(
        (sum, s) =>
          sum + (s.features[j] - means[j]) ** 2,
        0
      ) / samples.length;

    scales[j] = Math.sqrt(variance) || 1;
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
        (v, i) => (v - means[i]) / scales[i]
      )
    ];

    for (let i = 0; i < size; i++) {
      xty[i] += x[i] * sample.target;

      for (let j = 0; j < size; j++) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  // Ridge regularization for the three slopes.
  for (let i = 1; i < size; i++) {
    xtx[i][i] += 10;
  }

  const coefficients = solve(xtx, xty);

  return coefficients
    ? { coefficients, means, scales }
    : null;
}

function predictChange(model, features) {
  return model.coefficients[0] +
    features.reduce(
      (sum, value, i) =>
        sum +
        model.coefficients[i + 1] *
        ((value - model.means[i]) / model.scales[i]),
      0
    );
}

function metrics(errors) {
  const mae =
    errors.reduce((sum, e) => sum + Math.abs(e), 0) /
    errors.length;

  const rmse = Math.sqrt(
    errors.reduce((sum, e) => sum + e * e, 0) /
    errors.length
  );

  return {
    evaluated_pairs: errors.length,
    mae_m: round(mae, 5),
    rmse_m: round(rmse, 5)
  };
}

function analyzeWaterLevelRidge(readings, { rollingValidationSelected = false } = {}) {
  const values = (readings || [])
    .map(row => ({
      time: kstMillis(row.observed_at),
      level:
        row.water_level == null ||
        row.water_level === ''
          ? NaN
          : Number(row.water_level)
    }))
    .filter(
      row =>
        Number.isFinite(row.time) &&
        Number.isFinite(row.level)
    )
    .sort((a, b) => a.time - b.time);

  const base = {
    model: 'WATER_LEVEL_RIDGE_EXPERIMENTAL',
    input_source: 'WAMIS_WATER_LEVEL_ONLY',
    status: 'NOT_AVAILABLE',
    available: false,
    live_prediction: null,
    validation_status: 'EXPERIMENTAL_NOT_FLOOD_VALIDATED',
    official_warning_issued: null,
    risk_level: null
  };

  if (values.length < MIN_TRAIN + MIN_TEST + 5) {
    return {
      ...base,
      reason: 'INSUFFICIENT_HOURLY_HISTORY',
      history_records: values.length
    };
  }

  const samples = [];

  // Three previous hourly changes predict
  // the next hourly water-level change.
  for (let i = 3; i < values.length - 1; i++) {
    const window = values.slice(i - 3, i + 2);

    const consecutive = window.every(
      (row, index) =>
        index === 0 ||
        row.time - window[index - 1].time === HOUR_MS
    );

    if (!consecutive) continue;

    samples.push({
      features: [
        values[i].level - values[i - 1].level,
        values[i - 1].level - values[i - 2].level,
        values[i - 2].level - values[i - 3].level
      ],

      currentLevel: values[i].level,
      nextLevel: values[i + 1].level,

      target:
        values[i + 1].level - values[i].level
    });
  }

  // Earlier 80% for training, later 20% for testing.
  const split = Math.floor(samples.length * 0.8);

  const training = samples.slice(0, split);
  const testing = samples.slice(split);

  if (
    training.length < MIN_TRAIN ||
    testing.length < MIN_TEST
  ) {
    return {
      ...base,
      reason: 'INSUFFICIENT_CONSECUTIVE_TRAIN_TEST_PAIRS',
      training_samples: training.length,
      test_samples: testing.length
    };
  }

  const model = trainRidge(training);

  if (!model) {
    return {
      ...base,
      reason: 'MODEL_TRAINING_FAILED'
    };
  }

  const modelErrors = [];
  const baselineErrors = [];

  for (const sample of testing) {
    const predicted =
      sample.currentLevel +
      predictChange(model, sample.features);

    modelErrors.push(
      predicted - sample.nextLevel
    );

    baselineErrors.push(
      sample.currentLevel - sample.nextLevel
    );
  }

  const ridgeMetrics = metrics(modelErrors);
  const baselineMetrics = metrics(baselineErrors);

  // Minimum 5% MAE improvement required.
  const improved =
    baselineMetrics.mae_m > 0 &&
    ridgeMetrics.mae_m <
      baselineMetrics.mae_m *
      (1 - REQUIRED_IMPROVEMENT);

  const latest = values.at(-1);
  const previous = values.at(-2);
  const previous2 = values.at(-3);
  const previous3 = values.at(-4);

  const lastFour = [
    previous3,
    previous2,
    previous,
    latest
  ];

  const consecutive = lastFour.every(
    (row, index) =>
      index === 0 ||
      row.time - lastFour[index - 1].time === HOUR_MS
  );

  const ageHours =
    (Date.now() - latest.time) / HOUR_MS;

  const fresh =
    ageHours >= 0 &&
    ageHours <= MAX_AGE_HOURS;

  const result = {
    ...base,
    status: 'EVALUATED',
    available: true,
    reason: null,

    training_samples: training.length,
    test_samples: testing.length,

    evaluation: {
      method: 'CHRONOLOGICAL_HOLDOUT',
      ...ridgeMetrics,
      baseline_on_same_samples: baselineMetrics,
      beats_baseline_by_5_percent: improved
    },

    latest_observation_fresh: fresh,
    latest_four_hours_consecutive: consecutive,
    model_selection_authority: rollingValidationSelected ? 'THREE_WINDOW_ROLLING_BACKTEST' : 'CHRONOLOGICAL_HOLDOUT'
  };

  if (!fresh) {
    return {
      ...result,
      prediction_reason: 'RIVER_OBSERVATION_STALE'
    };
  }

  if (!consecutive) {
    return {
      ...result,
      prediction_reason:
        'NEED_FOUR_CONSECUTIVE_HOURLY_READINGS'
    };
  }

  if (!improved && !rollingValidationSelected) {
    return {
      ...result,
      prediction_reason:
        'MODEL_NOT_BETTER_THAN_BASELINE'
    };
  }

  const features = [
    latest.level - previous.level,
    previous.level - previous2.level,
    previous2.level - previous3.level
  ];

  // A previously successful rolling backtest is the selection authority.
  // Refit only AFTER validation, using available past observations; never use future data.
  const liveModel = rollingValidationSelected ? trainRidge(samples) : model;
  if (!liveModel) {
    return { ...result, prediction_reason: 'FINAL_TRAINING_FAILED' };
  }
  const predicted =
    latest.level + predictChange(liveModel, features);

  if (!Number.isFinite(predicted)) {
    return {
      ...result,
      prediction_reason: 'INVALID_MODEL_OUTPUT'
    };
  }

  return {
    ...result,
    status: 'LIVE_FORECAST',
    prediction_reason: null,
    final_training_samples: rollingValidationSelected ? samples.length : training.length,

    live_prediction: {
      status: 'LIVE_FORECAST',
      model: 'WATER_LEVEL_RIDGE_EXPERIMENTAL',

      input_observation_time:
        kstString(latest.time),

      target_time:
        kstString(latest.time + HOUR_MS),

      predicted_water_level_m: round(predicted, 3),
      horizon_hours: 1
    }
  };
}

module.exports = {
  analyzeWaterLevelRidge
};
