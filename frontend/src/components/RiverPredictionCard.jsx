
import { useEffect, useState } from 'react';
import './RiverPredictionCard.css';

// Use Vite's /api proxy, rather than bypassing it with a localhost URL.

function formatLevel(value) {
  if (value === null || value === undefined) {
    return 'Unavailable';
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? `${number.toFixed(3)} m`
    : 'Unavailable';
}

export default function RiverPredictionCard({ stationId, stationName, gaugeCode }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadPrediction() {
      try {
        const response = await fetch(`/api/rivers/${encodeURIComponent(stationId)}/prediction`, {signal: controller.signal});

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error('Prediction API unavailable');
        }

        if (active) {
          setData(result);
          setError('');
        }
      } catch (err) {
        if (active) {
          setError(err.message);
          setData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPrediction();

    const interval = setInterval(loadPrediction, 60000);

    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [stationId]);

  if (loading) {
    return (
      <section className="river-prediction-card">
        <h3>River-Level Prediction</h3>
        <p>Loading real river observations...</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="river-prediction-card">
        <h3>River-Level Prediction</h3>
        <p>Prediction data is unavailable.</p>
        <small>{error}</small>
      </section>
    );
  }

  const latest = data.latest_observation;
  const baseline = data.prediction;
  const ml = data.rainfall_model;
  const ridge = ml?.prediction;
  const multi = data.multi_river_ml;
  const supportedRidge = multi?.live_prediction;

  const fresh = data.data_freshness?.status === 'FRESH';

  const ridgeAvailable =
    fresh &&
    ridge?.status === 'LIVE_FORECAST';

  const missingHours =
    ml?.live_input_diagnostics?.missing_rainfall_hours || [];

  return (
    <section className="river-prediction-card">
      <div className="river-prediction-header">
        <div>
          <h3>Water-Level Prediction</h3>
          <p>{stationName} · WAMIS {gaugeCode}</p>
        </div>

        <span className="river-prediction-status">
          {fresh ? 'Fresh observation' : 'Stale observation'}
        </span>
      </div>

      <div className="river-prediction-grid">
        <article className="river-prediction-metric">
          <span>Observed water level</span>
          <strong>
            {formatLevel(latest?.water_level_m)}
          </strong>
          <small>
            {latest?.observed_at || 'Time unavailable'} KST
          </small>
        </article>

        <article className="river-prediction-metric">
          <span>1-hour baseline forecast</span>
          <strong>
            {formatLevel(baseline?.predicted_water_level_m)}
          </strong>
          <small>
            {baseline?.target_time
              ? `${baseline.target_time} KST`
              : 'Unavailable'}
          </small>
          <small>Persistence baseline</small>
        </article>

        <article className="river-prediction-metric">
          <span>Experimental Ridge ML forecast</span>

          <strong>
            {ridgeAvailable
              ? formatLevel(ridge.predicted_water_level_m)
              : supportedRidge ? formatLevel(supportedRidge.predicted_water_level_m) : 'Unavailable'}
          </strong>

          <small>
            {ridgeAvailable
              ? `${ridge.target_time} KST · rainfall-aware experimental model`
              : supportedRidge ? `${supportedRidge.target_time} KST · water-level-only experimental model`
              : multi?.prediction_reason || ml?.prediction_reason ||
                ml?.reason || 'ML prediction unavailable'}
          </small>

          <small>Experimental — not an official forecast</small>
        </article>
      </div>

      {(ml?.evaluation || multi?.evaluation) && (
        <div className="river-prediction-evaluation">
          <h4>Historical model evaluation</h4>

          <p>
            Ridge MAE:{' '}
            <strong>
              {(ml?.evaluation || multi?.evaluation)?.mae_m ?? 'N/A'} m
            </strong>
            {' · '}
            Baseline MAE:{' '}
            <strong>
              {(ml?.evaluation || multi?.evaluation)?.baseline_on_same_samples?.mae_m ?? 'N/A'} m
            </strong>
          </p>

          <p>
            Evaluated samples:{' '}
            {(ml?.evaluation || multi?.evaluation)?.evaluated_pairs ?? 'N/A'}
          </p>
        </div>
      )}

      {missingHours.length > 0 && (
        <p className="river-prediction-notice">
          Waiting for KMA rainfall observations:{' '}
          {missingHours.join(', ')}
        </p>
      )}

      <p className="river-prediction-disclaimer">
        Educational prototype. Predictions are experimental
        and do not represent official flood warnings or
        validated flood-risk classifications.
      </p>
    </section>
  );
}
