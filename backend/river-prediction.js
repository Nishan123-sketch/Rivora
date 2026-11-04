
const express = require('express');
const pool = require('./db');
const {
  analyzeWaterLevelRidge
} = require('./multi-river-ml');
const {
  applyValidationGate, validateModelEligibility
} = require('./ml-validation-gate');
const router = express.Router();

const AWS_STATION_CODE = '152';
const RIVER_EXTERNAL_ID = '2201670';
const MAX_AGE_HOURS = 3;
const HOUR_MS = 60 * 60 * 1000;

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

// MySQL DATETIME values represent Korean local time.
function kstMillis(value) {
  const text = String(value);

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
  );

  if (!match) {
    throw new Error('Invalid database timestamp: ' + text);
  }

  const [, y, m, d, h, min, sec] = match;

  return Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(h),
    Number(min),
    Number(sec)
  ) - 9 * HOUR_MS;
}

function formatKstMillis(ms) {
  return new Date(ms + 9 * HOUR_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function addHours(value, hours) {
  return formatKstMillis(
    kstMillis(value) + hours * HOUR_MS
  );
}

function isConsecutive(a, b) {
  return kstMillis(b) - kstMillis(a) === HOUR_MS;
}

function metrics(errors) {
  if (!errors.length) {
    return {
      evaluated_pairs: 0,
      mae_m: null,
      rmse_m: null
    };
  }

  const mae = errors.reduce(
    (sum, error) => sum + Math.abs(error),
    0
  ) / errors.length;

  const mse = errors.reduce(
    (sum, error) => sum + error * error,
    0
  ) / errors.length;

  return {
    evaluated_pairs: errors.length,
    mae_m: round(mae, 4),
    rmse_m: round(Math.sqrt(mse), 4)
  };
}

function evaluatePersistence(readings) {
  const split = Math.floor(readings.length * 0.8);
  const errors = [];

  for (
    let i = Math.max(1, split);
    i < readings.length;
    i++
  ) {
    const previous = readings[i - 1];
    const current = readings[i];

    if (!isConsecutive(
      previous.observed_at,
      current.observed_at
    )) {
      continue;
    }

    errors.push(
      Number(previous.water_level) -
      Number(current.water_level)
    );
  }

  return {
    method: 'PERSISTENCE_BASELINE',
    horizon_hours: 1,
    evaluation_method: 'CHRONOLOGICAL_HOLDOUT',
    holdout_fraction: 0.2,
    ...metrics(errors),
    note:
      'Predicts the next hourly level using the previous ' +
      'observed level.'
  };
}

// Solve a small linear system using Gaussian elimination.
function solveSystem(matrix, vector) {
  const n = vector.length;

  const a = matrix.map(
    (row, i) => [...row, vector[i]]
  );

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

    if (Math.abs(a[pivot][col]) < 1e-10) {
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
  // Features:
  // 1. Previous-hour river-level change
  // 2. Current-hour rainfall
  // 3. Trailing three-hour rainfall

  const featureCount = 3;

  const means = Array(featureCount).fill(0);
  const scales = Array(featureCount).fill(1);

  for (let j = 0; j < featureCount; j++) {
    means[j] = samples.reduce(
      (sum, sample) =>
        sum + sample.features[j],
      0
    ) / samples.length;

    const variance = samples.reduce(
      (sum, sample) =>
        sum +
        (sample.features[j] - means[j]) ** 2,
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
        (value, j) =>
          (value - means[j]) / scales[j]
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
  const lambda = 1;

  for (let j = 1; j < size; j++) {
    xtx[j][j] += lambda;
  }

  const coefficients = solveSystem(xtx, xty);

  if (!coefficients) {
    return null;
  }

  return {
    coefficients,
    means,
    scales
  };
}

function predictChange(model, features) {
  let result = model.coefficients[0];

  for (let j = 0; j < features.length; j++) {
    result +=
      model.coefficients[j + 1] *
      (features[j] - model.means[j]) /
      model.scales[j];
  }

  return result;
}

function buildSamples(readings, rainfallMap) {
  const samples = [];

  for (let i = 3; i < readings.length - 1; i++) {
    const previous = readings[i - 1];
    const current = readings[i];
    const next = readings[i + 1];

    if (
      !isConsecutive(
        previous.observed_at,
        current.observed_at
      ) ||
      !isConsecutive(
        current.observed_at,
        next.observed_at
      )
    ) {
      continue;
    }

    const currentHour = kstMillis(
      current.observed_at
    );

    const rainfall = [0, 1, 2].map(
      offset =>
        rainfallMap.get(
          currentHour - offset * HOUR_MS
        )
    );

    if (
      rainfall.some(
        value =>
          value == null ||
          !Number.isFinite(value)
      )
    ) {
      continue;
    }

    const currentLevel = Number(
      current.water_level
    );

    const previousLevel = Number(
      previous.water_level
    );

    const nextLevel = Number(
      next.water_level
    );

    samples.push({
      time: currentHour,
      currentLevel,
      nextLevel,

      features: [
        currentLevel - previousLevel,
        rainfall[0],
        rainfall.reduce(
          (sum, n) => sum + n,
          0
        )
      ],

      targetChange:
        nextLevel - currentLevel
    });
  }

  return samples;
}

router.get(
  '/rivers/:stationId/prediction',
  async (req, res) => {
    try {
      const stationId = Number(
        req.params.stationId
      );

      if (
        !Number.isSafeInteger(stationId) ||
        stationId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid river station ID'
        });
      }

      const [stations] = await pool.execute(
        `SELECT
           station_id,
           station_name,
           external_station_id
         FROM stations
         WHERE station_id = ?
           AND data_source = 'RIVER_GAUGE'`,
        [stationId]
      );

      if (!stations.length) {
        return res.status(404).json({
          success: false,
          message: 'River station not found'
        });
      }

      const [rows] = await pool.query(
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
         LIMIT 3000`,
        [stationId]
      );

      const readings = rows.reverse();

const rollingEligibility = validateModelEligibility(stations[0]);
      const multiRiverML = applyValidationGate(
        analyzeWaterLevelRidge(readings, { rollingValidationSelected: rollingEligibility.eligible }),
        stations[0]
      );

      if (readings.length < 48) {
        return res.json({
          success: true,
          station: stations[0],
          prediction_available: false,
          reason: 'INSUFFICIENT_HISTORY',
          risk_level: null,
          assessment_status: 'NOT_ASSESSED'
        });
      }

      const latest =
        readings[readings.length - 1];

      const previous =
        readings[readings.length - 2];

      const latestLevel = Number(
        latest.water_level
      );

      const consecutive = isConsecutive(
        previous.observed_at,
        latest.observed_at
      );

      const ageHours =
        (
          Date.now() -
          kstMillis(latest.observed_at)
        ) / HOUR_MS;

      const fresh =
        ageHours >= 0 &&
        ageHours <= MAX_AGE_HOURS;

      const freshness = {
        status: ageHours < 0
          ? 'FUTURE_TIMESTAMP'
          : fresh
            ? 'FRESH'
            : 'STALE',

        age_hours: round(ageHours, 2),
        max_age_hours: MAX_AGE_HOURS,
        checked_at:
          new Date().toISOString()
      };

      const evaluation =
        evaluatePersistence(readings);

      const baselineReady =
  consecutive &&
  Number.isFinite(latestLevel) &&
  Number.isFinite(Number(previous.water_level));

      const predictionAvailable =
        baselineReady && fresh;

      const baselinePrediction = {
        target_time:
          addHours(latest.observed_at, 1),

        predicted_water_level_m:
          round(latestLevel),

        horizon_hours: 1,
        model: 'PERSISTENCE_BASELINE'
      };

      let rainfallModel = {
        available: false,
        reason: 'NOT_EVALUATED'
      };

      // Rainfall-aware model is currently paired
      // with Taehwa Bridge only.
      if (
        String(
          stations[0].external_station_id
        ) === RIVER_EXTERNAL_ID
      ) {
        const firstTime =
          readings[0].observed_at;

        const lastTime =
          latest.observed_at;

        const [awsRows] = await pool.execute(
          `SELECT
             DATE_FORMAT(
               observed_at,
               '%Y-%m-%d %H:%i:%s'
             ) AS observed_at,

             hourly_rainfall

           FROM aws_rainfall_readings

           WHERE aws_station_code = ?
             AND observed_at BETWEEN
               DATE_SUB(?, INTERVAL 3 HOUR)
               AND ?

           ORDER BY observed_at`,
          [
            AWS_STATION_CODE,
            firstTime,
            lastTime
          ]
        );

        
const rainfallMap = new Map();
const rainfallSourceMap = new Map();
// 1. Load real AWS rainfall first.
for (const row of awsRows) {
  if (
    row.hourly_rainfall === null ||
    row.hourly_rainfall === undefined ||
    row.hourly_rainfall === ''
  ) {
    continue;
  }

  const rainfall = Number(row.hourly_rainfall);

  if (Number.isFinite(rainfall) && rainfall >= 0) {
    const timestamp = kstMillis(row.observed_at);

rainfallMap.set(timestamp, rainfall);
rainfallSourceMap.set(timestamp, 'KMA_ASOS');
rainfallSourceMap.set(timestamp, 'KMA_AWS');
  }
}

// 2. Use real KMA ASOS rainfall when AWS data is missing.
// Ulsan ASOS station has database station_id 31.
const [asosRows] = await pool.execute(
  `SELECT
     DATE_FORMAT(
       observed_at,
       '%Y-%m-%d %H:%i:%s'
     ) AS observed_at,
     hourly_rainfall,
     rainfall
   FROM weather_readings
   WHERE station_id = ?
     AND observed_at BETWEEN
       DATE_SUB(?, INTERVAL 3 HOUR)
       AND ?
   ORDER BY observed_at ASC`,
  [31, firstTime, lastTime]
);

for (const row of asosRows) {
  const timestamp = kstMillis(row.observed_at);

  // Keep the existing valid AWS reading.
  if (rainfallMap.has(timestamp)) {
    continue;
  }

  // Hourly rainfall is preferred over other rainfall fields.
  const rawRainfall =
    row.hourly_rainfall != null &&
    row.hourly_rainfall !== ''
      ? row.hourly_rainfall
      : row.rainfall;

  if (
    rawRainfall === null ||
    rawRainfall === undefined ||
    rawRainfall === ''
  ) {
    continue;
  }

  const rainfall = Number(rawRainfall);

  if (
    Number.isFinite(rainfall) &&
    rainfall >= 0
  ) {
    rainfallMap.set(timestamp, rainfall);
  }
}

console.log(
  'Available real hourly rainfall records:',
  rainfallMap.size
);


        for (const row of awsRows) {
          if (
            row.hourly_rainfall == null ||
            row.hourly_rainfall === ''
          ) {
            continue;
          }

          const value = Number(
            row.hourly_rainfall
          );

          if (
            Number.isFinite(value) &&
            value >= 0
          ) {
            rainfallMap.set(
              kstMillis(row.observed_at),
              value
            );
          }
        }

        const samples = buildSamples(
          readings,
          rainfallMap
        );

        const split = Math.floor(
          samples.length * 0.8
        );

        const training =
          samples.slice(0, split);

        const testing =
          samples.slice(split);

        if (
          training.length >= 80 &&
          testing.length >= 20
        ) {
          const model = trainRidge(
            training
          );

          if (model) {
            const modelErrors = [];
            const baselineErrors = [];

            for (const sample of testing) {
              const predicted =
                sample.currentLevel +
                predictChange(
                  model,
                  sample.features
                );

              modelErrors.push(
                predicted - sample.nextLevel
              );

              baselineErrors.push(
                sample.currentLevel -
                sample.nextLevel
              );
            }

            const modelMetrics =
              metrics(modelErrors);

            const baselineMetrics =
              metrics(baselineErrors);

            rainfallModel = {
              available: true,

              rainfall_source:
                'KMA_AWS_RN_HR1',

              aws_station_code:
                AWS_STATION_CODE,

              model:
                'RAINFALL_RIDGE_EXPERIMENTAL',

              training_samples:
                training.length,

              test_samples:
                testing.length,

              features: [
                'previous_hour_level_change',
                'current_hour_rainfall',
                'trailing_3_hour_rainfall'
              ],

              evaluation: {
                method:
                  'CHRONOLOGICAL_HOLDOUT',

                ...modelMetrics,

                baseline_on_same_samples:
                  baselineMetrics,

                beats_baseline_mae:
                  modelMetrics.mae_m <
                  baselineMetrics.mae_m
              },

              limitations: [
                'Experimental statistical model.',
                'Missing rainfall hours are excluded.',
                'Only observed rainfall is used.',
                'AWS rainfall quality requires validation.',
                'Station pairing requires hydrological validation.'
              ]
            };

            // Historical prediction:
            // The target is already observed.
            if (testing.length > 0) {
              const sample =
                testing[testing.length - 1];

              const predicted =
                sample.currentLevel +
                predictChange(
                  model,
                  sample.features
                );

              const targetMs =
                sample.time + HOUR_MS;

              rainfallModel.latest_aligned_backtest = {
                status:
                  'HISTORICAL_BACKTEST',

                model:
                  'RAINFALL_RIDGE_EXPERIMENTAL',

                input_observation_time:
                  formatKstMillis(
                    sample.time
                  ),

                target_time:
                  formatKstMillis(
                    targetMs
                  ),

                predicted_water_level_m:
                  round(predicted),

                actual_water_level_m:
                  round(sample.nextLevel),

                absolute_error_m:
                  round(
                    Math.abs(
                      predicted -
                      sample.nextLevel
                    )
                  ),

                baseline_predicted_water_level_m:
                  round(sample.currentLevel),

                baseline_absolute_error_m:
                  round(
                    Math.abs(
                      sample.currentLevel -
                      sample.nextLevel
                    )
                  ),

                rainfall_inputs: {
                  current_hour_mm:
                    sample.features[1],

                  trailing_3_hour_mm:
                    round(
                      sample.features[2]
                    )
                },

                target_age_hours:
                  round(
                    (
                      Date.now() -
                      targetMs
                    ) / HOUR_MS,
                    2
                  ),

                evaluation_split:
                  'CHRONOLOGICAL_HOLDOUT',

                message:
                  'Historical evaluation only; not a live forecast or official flood warning.'
              };
            }

            // Diagnose required live rainfall hours.
            const latestHour =
              kstMillis(
                latest.observed_at
              );

            const requiredRainfallHours =
              [0, 1, 2].map(offset => {
                const timestamp =
                  latestHour -
                  offset * HOUR_MS;

                const value =
                  rainfallMap.get(timestamp);

                return {
  observed_at: formatKstMillis(timestamp),
  rainfall_mm: value == null ? null : value,
  source: rainfallSourceMap.get(timestamp) || null,
  available: value != null && Number.isFinite(value)
};
              });

            const missingRainfallHours =
              requiredRainfallHours
                .filter(
                  hour => !hour.available
                )
                .map(
                  hour => hour.observed_at
                );

            rainfallModel.live_input_diagnostics = {
              latest_river_observation_at:
                latest.observed_at,

              required_rainfall_hours:
                requiredRainfallHours,

              missing_rainfall_hours:
                missingRainfallHours,

              river_observations_consecutive:
                consecutive,

              river_observation_fresh:
                fresh,

             rainfall_source: 'KMA_AWS_WITH_ASOS_FALLBACK',

              note:
                'The live model needs rainfall at the latest river observation hour and the two preceding hours. Missing rainfall is never substituted with zero.'
            };

            const rain =
              requiredRainfallHours.map(
                hour => hour.rainfall_mm
              );

            if (
              missingRainfallHours.length === 0 &&
              consecutive &&
              fresh
            ) {
              const features = [
                latestLevel -
                Number(
                  previous.water_level
                ),

                rain[0],

                rain.reduce(
                  (sum, n) => sum + n,
                  0
                )
              ];

              rainfallModel.prediction = {
                status: 'LIVE_FORECAST',

                input_observation_time:
                  latest.observed_at,

                target_time:
                  addHours(
                    latest.observed_at,
                    1
                  ),

                predicted_water_level_m:
                  round(
                    latestLevel +
                    predictChange(
                      model,
                      features
                    )
                  ),

                horizon_hours: 1,

                model:
                  'RAINFALL_RIDGE_EXPERIMENTAL',

                rainfall_inputs: {
                  current_hour_mm:
                    rain[0],

                  trailing_3_hour_mm:
                    round(
                      rain.reduce(
                        (sum, n) =>
                          sum + n,
                        0
                      )
                    )
                }
              };

              rainfallModel.prediction_reason =
                null;

            } else {
              rainfallModel.prediction = null;

              rainfallModel.prediction_reason =
                !fresh
                  ? 'RIVER_OBSERVATION_STALE'
                  : !consecutive
                    ? 'RIVER_OBSERVATIONS_NOT_CONSECUTIVE'
                    : 'WAITING_FOR_RAINFALL_OBSERVATION';
            }
          } else {
            rainfallModel = {
              available: false,
              reason:
                'RIDGE_MODEL_TRAINING_FAILED'
            };
          }

        } else {
          rainfallModel = {
            available: false,

            reason:
              'INSUFFICIENT_COMPLETE_RAINFALL_SAMPLES',

            rainfall_source:
              'KMA_AWS_RN_HR1',

            aws_station_code:
              AWS_STATION_CODE,

            available_hourly_rainfall_records:
              rainfallMap.size,

            training_samples:
              training.length,

            test_samples:
              testing.length
          };
        }
      }

      return res.json(await require('./prediction-store').saveLegacyPrediction(stations[0].station_id, {
        success: true,
        station: stations[0],

        latest_observation: {
          observed_at:
            latest.observed_at,

          water_level_m:
            round(latestLevel),

          previous_hour_change_m:
            consecutive
              ? round(
                  latestLevel -
                  Number(
                    previous.water_level
                  )
                )
              : null
        },

        data_freshness:
          freshness,

        prediction_available:
          predictionAvailable,

        prediction:
          predictionAvailable
            ? baselinePrediction
            : null,

        baseline_prediction:
          baselineReady
            ? baselinePrediction
            : null,

        evaluation,

       rainfall_model:
  rainfallModel,

multi_river_ml:
  multiRiverML,

historical_records_used:
  readings.length,

        risk_level: null,
        assessment_status:
          'NOT_ASSESSED',

        limitations: [
          'Historical backtests refer to already observed hours, not live forecasts.',
          'Experimental predictions are not official forecasts.',
          'The primary prediction remains the persistence baseline.',
          'Stale data disables the primary prediction.',
          'The rainfall model requires further validation.',
          'Official flood-stage thresholds are not verified.'
        ]
      }));

    } catch (error) {
      console.error(
        'River prediction error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'River prediction failed'
      });
    }
  }
);

module.exports = router;
