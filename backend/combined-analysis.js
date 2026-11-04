const {
  classifyFloodConditions
} = require('./flood-condition-classifier');
require('dotenv').config();
const {
  compareTaehwaPublishedStages
} = require('./taehwa-published-stages');

const pool = require('./db');
const {
  assessExperimentalFloodRisk
} = require('./experimental-flood-risk');
const { compareRainfall } = require('./rainfall-reference');
const { analyzeRainfall } = require('./rainfall-analysis');
const { analyzeRiver } = require('./river-analysis');
const {
  analyzeForecastRainfall
} = require('./forecast-rainfall-analysis');
const { findTaehwaRiver } = require('./station-defaults');
const { evaluateCombinedStageSafety } = require('./combined-stage-safety');

const PORT = Number(process.env.PORT) || 5000;

async function getPrediction(route) {
  const url = `http://127.0.0.1:${PORT}${route}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `Prediction API returned HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(
      data.message || 'Prediction API unavailable'
    );
  }

  return data;
}

function getObservedRainfall(result, hours) {
  const period = result?.[`rainfall${hours}h`];

  return {
    hours,
    status: period?.status || 'UNAVAILABLE',
    rainfall_mm:
      period?.status === 'COMPLETE'
        ? period.rainfallMm
        : null,
    available_hours: period?.available_hours ?? 0,
    expected_hours: period?.expected_hours ?? hours,
    missing_hours: period?.missing_hours || []
  };
}

function getForecastPeriod(periods, hours) {
  return periods.find(
    period => period.hours === hours
  ) || null;
}

function summarizeForecast(periods, hours) {
  const period = getForecastPeriod(periods, hours);

  if (!period) {
    return {
      hours,
      status: 'UNAVAILABLE',
      rainfall_mm: null,
      rainfall_min_mm: null,
      rainfall_max_mm: null,
      rainfall_max_exclusive: null,
      available_hours: 0,
      expected_hours: hours,
      range_hours: 0,
      missing_hours: []
    };
  }

  const usable = [
    'COMPLETE',
    'RANGE_AVAILABLE'
  ].includes(period.status);

  return {
    hours,
    status: period.status,

    rainfall_mm:
      period.status === 'COMPLETE'
        ? period.rainfall_mm
        : null,

    rainfall_min_mm: usable
      ? period.rainfall_min_mm
      : null,

    rainfall_max_mm: usable
      ? period.rainfall_max_mm
      : null,

    rainfall_max_exclusive: usable
      ? period.rainfall_max_exclusive
      : null,

    available_hours: period.available_hours,
    expected_hours: period.expected_hours,
    exact_hours: period.exact_hours ?? null,
    range_hours: period.range_hours ?? 0,
    missing_hours: period.missing_hours || []
  };
}

function describeForecast(period) {
  if (period.status === 'COMPLETE') {
    return {
      hours: period.hours,
      type: 'EXACT_FORECAST',
      message:
        `${period.rainfall_mm} mm of forecast rainfall`
    };
  }

  if (period.status === 'RANGE_AVAILABLE') {
    const operator = period.rainfall_max_exclusive
      ? 'less than'
      : 'up to and including';

    return {
      hours: period.hours,
      type: 'BOUNDED_FORECAST',
      message:
        `At least ${period.rainfall_min_mm} mm and ` +
        `${operator} ${period.rainfall_max_mm} mm`
    };
  }

  return {
    hours: period.hours,
    type: 'INCOMPLETE_FORECAST',
    message:
      'Complete rainfall amount cannot be determined.'
  };
}

async function analyzeCombinedConditions() {
  const names = [
    'rainfall',
    'river',
    'forecast',
    'taehwa_station'
  ];

  const results = await Promise.allSettled([
    analyzeRainfall(),
    analyzeRiver('2201670'),
    analyzeForecastRainfall(),
    findTaehwaRiver()
  ]);

  const values = results.map(result =>
    result.status === 'fulfilled'
      ? result.value
      : null
  );

  const [
    rainfallValue,
    riverValue,
    forecastValue,
    station
  ] = values;

  const rainfall = rainfallValue || {};
  const river = riverValue || {};
  const forecast = forecastValue || {};

  const errors = [];

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `[Combined analysis] ${names[index]}:`,
        result.reason?.message
      );

      errors.push({
        component: names[index],
        message:
          'Component unavailable; check backend logs.'
      });
    }
  });

  let riverPrediction = null;
  let floodPrediction = null;

  if (station?.station_id) {
    const stationId = Number(station.station_id);

    const endpoints = [
      `/api/rivers/${stationId}/prediction`,
      `/api/rivers/${stationId}/flood-prediction`
    ];

    const predictionResults = await Promise.allSettled(
      endpoints.map(endpoint => getPrediction(endpoint))
    );

    riverPrediction =
      predictionResults[0].status === 'fulfilled'
        ? predictionResults[0].value
        : null;

    floodPrediction =
      predictionResults[1].status === 'fulfilled'
        ? predictionResults[1].value
        : null;

    predictionResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const component = index === 0
          ? 'river_prediction'
          : 'flood_prediction';

        console.error(
          `[Combined analysis] ${component}:`,
          result.reason?.message
        );

        errors.push({
          component,
          message:
            'Prediction endpoint unavailable.'
        });
      }
    });
  }

  const rainfallModel =
    riverPrediction?.rainfall_model || null;

  const liveRainfallPrediction =
    rainfallModel?.prediction?.status === 'LIVE_FORECAST'
      ? rainfallModel.prediction
      : null;

  const historicalBacktest =
    rainfallModel?.latest_aligned_backtest || null;

  const baselinePrediction =
    riverPrediction?.prediction || null;

  const stageSafety = evaluateCombinedStageSafety({
    station,
    river,
    floodPrediction
  });

  const verifiedStageAvailable = stageSafety.stage_comparison_allowed;

  const officialStageRisk = verifiedStageAvailable
    ? floodPrediction.predicted_risk_level
    : null;

  const rainfallPeriods =
    Array.isArray(forecast.periods)
      ? forecast.periods
      : [];

  const observed1h =
    getObservedRainfall(rainfall, 1);

  const observed3h =
    getObservedRainfall(rainfall, 3);

  const observed6h =
    getObservedRainfall(rainfall, 6);

  const observed24h =
    getObservedRainfall(rainfall, 24);

  const forecast3h =
    summarizeForecast(rainfallPeriods, 3);

  const forecast6h =
    summarizeForecast(rainfallPeriods, 6);

  const forecast12h =
    summarizeForecast(rainfallPeriods, 12);

  const forecast24h =
    summarizeForecast(rainfallPeriods, 24);

  const usableForecastPeriods = [
    forecast3h,
    forecast6h,
    forecast12h,
    forecast24h
  ].filter(period =>
    ['COMPLETE', 'RANGE_AVAILABLE']
      .includes(period.status)
  ).length;
let experimentalRisk = {
  status: 'NOT_ASSESSED',
  risk_level: null,
  reason: 'ASSESSMENT_UNAVAILABLE'
};

try {
  experimentalRisk = await assessExperimentalFloodRisk({
    river,
    rainfall,
    forecast,
    riverPrediction
  });
} catch (error) {
  console.error(
    '[Combined analysis] experimental risk:',
    error.message
  );

  errors.push({
    component: 'experimental_risk',
    message: 'Experimental assessment unavailable.'
  });
}
  // Keep the existing reference comparison.
  // The reference component must independently support
  // ranges before it can assess bounded totals.
  let rainfallReference = null;

  try {
    rainfallReference = compareRainfall(
  rainfallPeriods
);
  } catch (error) {
    console.error(
      '[Combined analysis] rainfall_reference:',
      error.message
    );

    errors.push({
      component: 'rainfall_reference',
      message:
        'Rainfall reference comparison unavailable.'
    });
  }

  return {
    system: 'Weather and Flood Risk Forecasting',

    component_errors: errors,

    location: {
      city: 'Ulsan',
      country: 'South Korea',
      river: 'Taehwa River'
    },

    rainfall_reference: rainfallReference,

    weather: {
      station: rainfall.station || null,
      observed_at: rainfall.observedAt || null,

      // Preserve the original response fields.
      rainfall_1h: observed1h.rainfall_mm,
      rainfall_3h: observed3h.rainfall_mm,
      rainfall_6h: observed6h.rainfall_mm,
      rainfall_24h: observed24h.rainfall_mm,

      // Additional transparency for missing data.
      observation_status:
        rainfall.status || 'UNAVAILABLE',

      data_age_hours:
        rainfall.data_age_hours ?? null,

      rainfall_coverage: {
        '1h': observed1h,
        '3h': observed3h,
        '6h': observed6h,
        '24h': observed24h
      }
    },

    river: {
      station_id: station?.station_id ?? null,
      station_code:
        river.station_code || '2201670',

      observed_at:
        river.latest_observed_at || null,

      water_level:
        river.latest_water_level ?? null,

      trend: river.trend || 'UNKNOWN',
      changes: river.changes || null,

      data_freshness:
        river.data_freshness || null,

      observed_trends:
        river.observed_trends || null,

      recent_water_levels:
        river.recent_water_levels || null,

      experimental_indicators:
        river.experimental_indicators || null
    },

    weather_forecast: {
      station_id:
        forecast.station_id ?? null,

      station_name:
        forecast.station_name || null,

      issued_at:
        forecast.issued_at || null,

      timezone:
        forecast.timezone || 'Asia/Seoul',

      source:
        forecast.source || null,

      status:
        forecast.status || 'NO_FORECAST_DATA',

      prediction_available:
        forecast.prediction_available === true,

      complete_periods:
        forecast.complete_periods ?? 0,

      bounded_periods:
        forecast.bounded_periods ?? 0,

      usable_periods: usableForecastPeriods,

      // Preserve full hourly coverage and bounds.
      periods: rainfallPeriods,

      // Convenient summaries for frontend use.
      rainfall_summary: {
        '3h': forecast3h,
        '6h': forecast6h,
        '12h': forecast12h,
        '24h': forecast24h
      },

      forecast_descriptions: [
        describeForecast(forecast3h),
        describeForecast(forecast6h),
        describeForecast(forecast12h),
        describeForecast(forecast24h)
      ],

      duplicate_hours:
        forecast.duplicate_hours || [],

      note: forecast.note || null
    },

    river_prediction: {
      status: !riverPrediction
        ? 'UNAVAILABLE'
        : liveRainfallPrediction
          ? 'LIVE_RAINFALL_MODEL_AVAILABLE'
          : baselinePrediction
            ? 'BASELINE_AVAILABLE'
            : 'NO_CURRENT_PREDICTION',

      prediction_available:
        riverPrediction?.prediction_available ?? false,

      latest_observation:
        riverPrediction?.latest_observation || null,

      data_freshness:
        riverPrediction?.data_freshness || null,

      baseline_prediction:
        baselinePrediction,

      rainfall_model: {
        available:
          rainfallModel?.available === true,

        model:
          rainfallModel?.model || null,

        live_prediction:
          liveRainfallPrediction,

        prediction_reason:
          rainfallModel?.prediction_reason || null,

        evaluation:
          rainfallModel?.evaluation || null,

        historical_backtest:
          historicalBacktest,

        training_samples:
          rainfallModel?.training_samples ?? null,

        test_samples:
          rainfallModel?.test_samples ?? null
      }
    },

    assessment: {
      risk_level:
        officialStageRisk,

      risk_status:
        verifiedStageAvailable
          ? 'ASSESSED'
          : 'NOT_ASSESSED',

      assessment_type:
        verifiedStageAvailable
          ? 'VERIFIED_STAGE_REFERENCE_COMPARISON'
          : null,

      thresholds:
        floodPrediction?.flood_thresholds || null,

      stage_thresholds_available:
        verifiedStageAvailable,

      gauge_data_quality: stageSafety,
      published_flood_stage_reference: compareTaehwaPublishedStages({
  stationCode: river.station_code || '2201670',
  level: river.latest_water_level,
  observedAt: river.latest_observed_at,
  now: new Date()
}),

      experimental_prediction_available:
        Boolean(liveRainfallPrediction),

      // No official warning API is checked here.
      official_warning_issued: null,

      experimental_risk: classifyFloodConditions(experimentalRisk),

      message: verifiedStageAvailable
        ? 'River-stage comparison is available using verified reference levels. This is not an issued official flood warning.'
        : liveRainfallPrediction
          ? 'Experimental rainfall-aware prediction is available. Official flood-stage risk remains unassessed.'
          : 'Official flood-stage risk remains unassessed. Experimental live prediction may be unavailable.'
    },

    sources: {
      weather:
        'Korea Meteorological Administration (KMA)',

      weather_forecast:
        'Korea Meteorological Administration (KMA)',

      rainfall_observations:
        'KMA ASOS/AWS observations as selected by rainfall-analysis',

      river: 'WAMIS'
    },

    limitations: [
      'This application is an educational prototype, not an official flood forecasting service.',
      'Experimental predictions are not official flood forecasts.',
      'The rainfall-aware model currently applies to Taehwa Bridge only.',
      'Historical backtests are not live forecasts.',
      'Forecast rainfall ranges are not replaced with fabricated exact values.',
      'Observed ASOS and AWS rainfall values require source-consistency validation.',
      'Official flood-stage classification requires verified station-specific thresholds and recent, compatible gauge readings.',
      'Official warning issuance is not determined by this endpoint.'
    ]
  };
}

if (require.main === module) {
  analyzeCombinedConditions()
    .then(result => {
      console.log(
        JSON.stringify(result, null, 2)
      );
    })
    .catch(error => {
      console.error(
        'Combined analysis failed:',
        error.message
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = {
  analyzeCombinedConditions
};
