
const express = require('express');
const pool = require('./db');

const router = express.Router();

const MAX_AGE_HOURS = 3;
const ONE_HOUR_MS = 3600000;

function parseKst(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return NaN;

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 9,
    Number(match[5]),
    Number(match[6])
  );
}

function formatKst(timestamp) {
  return new Date(timestamp + 9 * ONE_HOUR_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function classifyTrend(change) {
  const rounded = round3(change);

  if (rounded > 0) return 'RISING';
  if (rounded < 0) return 'FALLING';

  return 'STABLE';
}

function classifyStage(level, thresholds) {
  if (level >= thresholds.severe_level_m) {
    return 'SEVERE';
  }

  if (level >= thresholds.alert_level_m) {
    return 'ALERT';
  }

  if (level >= thresholds.caution_level_m) {
    return 'CAUTION';
  }

  if (level >= thresholds.interest_level_m) {
    return 'INTEREST';
  }

  return 'NORMAL';
}

function thresholdsAreValid(thresholds) {
  if (!thresholds) return false;

  const values = [
    thresholds.interest_level_m,
    thresholds.caution_level_m,
    thresholds.alert_level_m,
    thresholds.severe_level_m
  ];

  return (
    values.every(value => (
      value !== null && Number.isFinite(value)
    )) &&
    values[0] < values[1] &&
    values[1] < values[2] &&
    values[2] < values[3] &&
    String(thresholds.verification_status).toUpperCase() ===
      'VERIFIED' &&
    Boolean(thresholds.source_url) &&
    Boolean(thresholds.verified_at)
  );
}

router.get(
  '/rivers/:stationId/flood-prediction',
  async (req, res) => {
    try {
      const stationId = Number(req.params.stationId);

      if (
        !Number.isSafeInteger(stationId) ||
        stationId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid station ID'
        });
      }

      const [stations] = await pool.execute(`
        SELECT
          station_id,
          station_name,
          external_station_id
        FROM stations
        WHERE station_id = ?
          AND data_source = 'RIVER_GAUGE'
        LIMIT 1
      `, [stationId]);

      if (!stations.length) {
        return res.status(404).json({
          success: false,
          message: 'River gauge station not found'
        });
      }

      const station = stations[0];

      const [readings] = await pool.execute(`
        SELECT
          DATE_FORMAT(
            observed_at,
            '%Y-%m-%d %H:%i:%s'
          ) AS observed_at,
          water_level
        FROM water_readings
        WHERE station_id = ?
          AND water_level IS NOT NULL
        ORDER BY observed_at DESC
        LIMIT 2
      `, [stationId]);

      function unavailable(status, message) {
        return res.json({
          success: true,
          station,
          prediction_available: false,
          prediction: null,
          predicted_risk_level: null,
          experimental_trend: null,
          stage_thresholds_available: false,
          assessment_status: status,
          official_warning_issued: null,
          message
        });
      }

      if (readings.length < 2) {
        return unavailable(
          'INSUFFICIENT_OBSERVATIONS',
          'At least two hourly observations are required.'
        );
      }

      const latest = readings[0];
      const previous = readings[1];

      const latestTime = parseKst(latest.observed_at);
      const previousTime = parseKst(previous.observed_at);

      if (
        !Number.isFinite(latestTime) ||
        !Number.isFinite(previousTime)
      ) {
        return unavailable(
          'INVALID_OBSERVATION_TIME',
          'Observation timestamps could not be parsed.'
        );
      }

      const ageHours =
        (Date.now() - latestTime) / ONE_HOUR_MS;

      if (
        ageHours < 0 ||
        ageHours > MAX_AGE_HOURS
      ) {
        return unavailable(
          'STALE_OBSERVATION',
          'Recent water-level observations are unavailable.'
        );
      }

      if (latestTime - previousTime !== ONE_HOUR_MS) {
        return unavailable(
          'NONCONSECUTIVE_OBSERVATIONS',
          'The two latest observations are not one hour apart.'
        );
      }

      const latestLevel = numberOrNull(
        latest.water_level
      );

      const previousLevel = numberOrNull(
        previous.water_level
      );

      if (
        latestLevel === null ||
        previousLevel === null
      ) {
        return unavailable(
          'INVALID_WATER_LEVEL',
          'Valid water-level measurements are unavailable.'
        );
      }

      // Experimental observation trend.
      // This is NOT an official flood-risk classification.
      const hourlyChange = round3(
        latestLevel - previousLevel
      );

      const trend = classifyTrend(hourlyChange);

      // One-hour persistence baseline:
      // assumes the latest level remains unchanged.
      const predictedLevel = latestLevel;

      const targetTime = formatKst(
        latestTime + ONE_HOUR_MS
      );

      const [thresholdRows] = await pool.execute(`
        SELECT
          interest_level_m,
          caution_level_m,
          alert_level_m,
          severe_level_m,
          verification_status,
          verified_at,
          reference_source,
          source_url
        FROM flood_thresholds
        WHERE station_id = ?
        LIMIT 1
      `, [stationId]);

      const thresholdRow = thresholdRows[0] || null;

      const thresholds = thresholdRow ? {
        interest_level_m: numberOrNull(
          thresholdRow.interest_level_m
        ),
        caution_level_m: numberOrNull(
          thresholdRow.caution_level_m
        ),
        alert_level_m: numberOrNull(
          thresholdRow.alert_level_m
        ),
        severe_level_m: numberOrNull(
          thresholdRow.severe_level_m
        ),
        verification_status:
          thresholdRow.verification_status,
        verified_at: thresholdRow.verified_at,
        reference_source:
          thresholdRow.reference_source,
        source_url: thresholdRow.source_url
      } : null;

      const validThresholds =
        thresholdsAreValid(thresholds);

      const predictedRiskLevel = validThresholds
        ? classifyStage(predictedLevel, thresholds)
        : null;

      return res.json({
        success: true,

        station,

        prediction_available: true,

        latest_observation: {
          observed_at: latest.observed_at,
          water_level_m: latestLevel,
          age_hours: round3(ageHours)
        },

        previous_observation: {
          observed_at: previous.observed_at,
          water_level_m: previousLevel
        },

        experimental_trend: {
          direction: trend,
          change_m_per_hour: hourlyChange,
          method: 'TWO_OBSERVATION_DIFFERENCE',
          interpretation:
            'Observed one-hour change, not a flood warning.'
        },

        prediction: {
          target_time: targetTime,
          horizon_hours: 1,
          predicted_water_level_m: predictedLevel,
          model: 'PERSISTENCE_BASELINE',
          experimental: true
        },

        predicted_risk_level: predictedRiskLevel,

        assessment_status: validThresholds
          ? 'ASSESSED'
          : 'STAGE_THRESHOLDS_UNAVAILABLE',

        assessment_type:
          'PREDICTED_STAGE_REFERENCE_COMPARISON',

        stage_thresholds_available: validThresholds,

        flood_thresholds: thresholds,

        official_warning_issued: null,

        message: validThresholds
          ? 'Experimental predicted river level compared against verified station-specific reference thresholds.'
          : 'River-level prediction and trend are available. Official flood-stage classification is not assessed because verified station thresholds are unavailable.',

        limitations: [
          'This is an educational experimental prediction.',
          'The persistence baseline assumes the water level remains unchanged for one hour.',
          'The trend uses only the last two hourly observations.',
          'Rainfall forecasts are not incorporated into this endpoint.',
          'A rising water level alone does not establish flood danger.',
          'Stage comparisons do not indicate that an official warning was issued.'
        ]
      });

    } catch (error) {
      console.error(
        'Flood prediction error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to calculate flood prediction'
      });
    }
  }
);

module.exports = router;
