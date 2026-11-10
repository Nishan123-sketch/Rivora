import {apiFetch} from '../lib/apiFetch.js';

import { useEffect, useMemo, useState } from 'react';
import { Section, Notice } from '../components/Shared';

const REFRESH_MS = 60000;

const colors = {
  primary: 'var(--color-primary, #087fbd)',
  muted: 'var(--text-secondary, #64748b)',
  border: 'var(--border-color, #dce5ee)'
};

function number(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function level(value) {
  const valueNumber = number(value);
  return valueNumber === null
    ? 'Unavailable'
    : `${valueNumber.toFixed(3)} m`;
}


function timeMs(value) {
  if (value === null || value === undefined || value === '') {
    return NaN;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  // Chart coordinates already use milliseconds.
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }

  const text = String(value).trim();

  // MySQL DATETIME values represent Korean local time.
  const normalized =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text.replace(' ', 'T')}+09:00`
      : text;

  const result = new Date(normalized).getTime();

  return Number.isFinite(result) ? result : NaN;
}


function showTime(value) {
  const ms = timeMs(value);
  if (!Number.isFinite(ms)) return 'Unavailable';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(ms)) + ' KST';
}

async function getJson(url, signal) {
  const response = await apiFetch(url, { signal });

  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.success === false) {
    throw new Error(result.message || 'API unavailable');
  }

  return result;
}

const panelStyle = {
  padding: '18px',
  border: `1px solid ${colors.border}`,
  borderRadius: '12px',
  minWidth: 0,
  background: 'var(--surface-muted, #f8fafc)'
};

function MetricCard({ title, value, detail }) {
  return (
    <div style={panelStyle}>
      <p style={{ margin: '0 0 12px', color: colors.muted }}>
        {title}
      </p>

      <strong
        style={{
          display: 'block',
          fontSize: 'clamp(20px, 2.5vw, 28px)',
          overflowWrap: 'anywhere'
        }}
      >
        {value}
      </strong>

      <small style={{ color: colors.muted }}>
        {detail}
      </small>
    </div>
  );
}

function WaterLevelChart({
  readings,
  baseline,
  ridge,
  showForecast
}) {
  const points = useMemo(() => {
    return (readings || [])
      .map(row => ({
        time: timeMs(row.observed_at),
        value: number(row.water_level)
      }))
      .filter(row =>
        Number.isFinite(row.time) &&
        row.value !== null
      )
      .sort((a, b) => a.time - b.time);
  }, [readings]);

  if (points.length < 2) {
    return (
      <p style={{ color: colors.muted }}>
        Not enough measured water-level observations
        to display a chart.
      </p>
    );
  }

  const last = points[points.length - 1];

  const future = [];

  if (showForecast && baseline) {
    const t = timeMs(baseline.target_time);
    const v = number(baseline.predicted_water_level_m);

    if (Number.isFinite(t) && t > last.time && v !== null) {
      future.push({
        time: t,
        value: v,
        type: 'Baseline'
      });
    }
  }

  if (showForecast && ridge) {
    const t = timeMs(ridge.target_time);
    const v = number(ridge.predicted_water_level_m);

    if (Number.isFinite(t) && t > last.time && v !== null) {
      future.push({
        time: t,
        value: v,
        type: 'Experimental Ridge'
      });
    }
  }

  const all = [...points, ...future];

  const minimum = Math.min(...all.map(p => p.value));
  const maximum = Math.max(...all.map(p => p.value));
  const range = Math.max(maximum - minimum, 0.1);
  const padding = range * 0.15;

  const lower = minimum - padding;
  const upper = maximum + padding;

  const startTime = points[0].time;
  const endTime = Math.max(...all.map(p => p.time));
  const duration = Math.max(endTime - startTime, 1);

  const x = t =>
    65 + ((t - startTime) / duration) * 680;

  const y = v =>
    205 - ((v - lower) / (upper - lower)) * 165;

  const observedPath = points
    .map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${x(p.time)} ${y(p.value)}`
    )
    .join(' ');

  return (
    <div>
      <svg
        viewBox="0 0 800 250"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block'
        }}
        role="img"
        aria-label="Measured river water levels with available one-hour forecasts"
      >
        {[0, 0.5, 1].map((fraction, i) => {
          const v = upper - fraction * (upper - lower);
          const yy = y(v);

          return (
            <g key={i}>
              <line
                x1="65"
                x2="745"
                y1={yy}
                y2={yy}
                stroke={colors.border}
                strokeDasharray="5 5"
              />

              <text
                x="6"
                y={yy + 4}
                fill="currentColor"
                fontSize="12"
              >
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}

        <path
          d={observedPath}
          fill="none"
          stroke="#087fbd"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <circle
          cx={x(last.time)}
          cy={y(last.value)}
          r="5"
          fill="#087fbd"
        />

        {future.map((prediction, i) => {
          const lineColor =
            prediction.type === 'Baseline'
              ? '#e19a30'
              : '#8c5ac7';

          return (
            <g key={i}>
              <line
                x1={x(last.time)}
                y1={y(last.value)}
                x2={x(prediction.time)}
                y2={y(prediction.value)}
                stroke={lineColor}
                strokeWidth="3"
                strokeDasharray="7 5"
              />

              <circle
                cx={x(prediction.time)}
                cy={y(prediction.value)}
                r="6"
                fill={lineColor}
              />
            </g>
          );
        })}

        <text
          x="65"
          y="240"
          fontSize="12"
          fill="currentColor"
        >
          {showTime(startTime)}
        </text>

        <text
          x="745"
          y="240"
          fontSize="12"
          fill="currentColor"
          textAnchor="end"
        >
          {showTime(endTime)}
        </text>
      </svg>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '18px',
          fontSize: '13px',
          marginTop: '8px'
        }}
      >
        <span style={{ color: '#087fbd' }}>
          ● Measured WAMIS level
        </span>

        {future.some(p => p.type === 'Baseline') && (
          <span style={{ color: '#c17d19' }}>
            ┄ Baseline forecast
          </span>
        )}

        {future.some(p => p.type === 'Experimental Ridge') && (
          <span style={{ color: '#8c5ac7' }}>
            ┄ Experimental Ridge forecast
          </span>
        )}
      </div>

      <p
        style={{
          color: colors.muted,
          fontSize: '12px',
          marginTop: '12px'
        }}
      >
        Solid line: measured history. Dashed lines:
        future model outputs, not observations.
        Chart scales automatically to the selected station.
      </p>
    </div>
  );
}

export default function MLAnalysis() {
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState('');

  const [region, setRegion] = useState('all');
  const [riverId, setRiverId] = useState('');
  const [stationId, setStationId] = useState('');

  const [historyHours, setHistoryHours] = useState(48);

  const [prediction, setPrediction] = useState(null);
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Load only catalog rivers with linked gauges.
  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      try {
        const response = await getJson(
          '/api/river-catalog',
          controller.signal
        );

        if (!controller.signal.aborted) {
          setCatalog(
            (response.data || []).filter(
              river => river.stations?.length > 0
            )
          );
          setCatalogError('');
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setCatalogError(err.message);
        }
      }
    }

    loadCatalog();

    const timer = setInterval(
      loadCatalog,
      REFRESH_MS
    );

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshKey]);

  const regions = useMemo(() => {
    return [...new Map(
      catalog.map(r => [r.region_id, r.region])
    ).entries()];
  }, [catalog]);

  const filteredRivers = useMemo(() => {
    return catalog.filter(
      river =>
        region === 'all' ||
        river.region_id === region
    );
  }, [catalog, region]);

  // Choose Taehwa by default when possible.
  const selectedRiver =
    filteredRivers.find(r => r.river_id === riverId) ||
    filteredRivers.find(r => r.river_id === 'taehwa') ||
    filteredRivers[0] ||
    null;

  const availableStations =
    selectedRiver?.stations || [];

  const selectedStation =
    availableStations.find(
      station => String(station.station_id) === stationId
    ) ||
    availableStations[0] ||
    null;

  const selectedGaugeId = selectedStation?.station_id || null;

  // Load only the selected station, not every gauge.
  useEffect(() => {
    if (!selectedGaugeId) {
      queueMicrotask(() => { setPrediction(null); setHistory([]); });
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadStation() {
      setLoading(true);

      const id = selectedGaugeId;

      const results = await Promise.allSettled([
        getJson(
          `/api/rivers/${id}/prediction`,
          controller.signal
        ),
        getJson(
          `/api/rivers/${id}/history?hours=${historyHours}`,
          controller.signal
        )
      ]);

      if (!active) return;

      const predictionResult = results[0];
      const historyResult = results[1];

      setPrediction(
        predictionResult.status === 'fulfilled'
          ? predictionResult.value
          : null
      );

      setHistory(
        historyResult.status === 'fulfilled'
          ? historyResult.value.readings || []
          : []
      );

      const messages = [];

      if (predictionResult.status === 'rejected') {
        messages.push(
          `Prediction: ${predictionResult.reason.message}`
        );
      }

      if (historyResult.status === 'rejected') {
        messages.push(
          `History: ${historyResult.reason.message}`
        );
      }

      setError(messages.join(' | '));
      setLoading(false);
    }

    loadStation();

    const timer = setInterval(
      loadStation,
      REFRESH_MS
    );

    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [
    selectedGaugeId,
    historyHours,
    refreshKey
  ]);

  const stationCode =
    String(selectedStation?.external_station_id || '');

  const isTaehwa = stationCode === '2201670';

  const latest = prediction?.latest_observation;

  const isFresh =
    prediction?.data_freshness?.status === 'FRESH';

  const baseline =
  prediction?.prediction_available && isFresh
    ? (
        prediction.baseline_prediction ||
        prediction.prediction
      )
    : null;

  const rainfallModel = prediction?.rainfall_model;

  
const multiRiverModel = prediction?.multi_river_ml;

const ridge = isFresh
  ? (
      isTaehwa
        ? (
            rainfallModel?.prediction?.status === 'LIVE_FORECAST'
              ? rainfallModel.prediction
              : null
          )
        : (
            multiRiverModel?.live_prediction?.status === 'LIVE_FORECAST'
              ? multiRiverModel.live_prediction
              : null
          )
    )
  : null;


  const evaluation = rainfallModel?.evaluation;

  const modelHasEvaluation =
    isTaehwa &&
    evaluation?.evaluated_pairs > 0;

  const baselineEvaluation =
    prediction?.evaluation;

  const hasBaselineEvaluation =
    baselineEvaluation?.evaluated_pairs > 0;

  const latestFromHistory = history[history.length - 1];

  const observedLevel =
    latest?.water_level_m ??
    latestFromHistory?.water_level ??
    null;

  const observedAt =
    latest?.observed_at ||
    latestFromHistory?.observed_at ||
    null;

  return (
    <Section
      title="ML Analysis"
      subtitle="Multi-river water-level monitoring, forecasts and model evaluation"
    >
      {catalogError && (
        <Notice>
          River catalog unavailable: {catalogError}
        </Notice>
      )}

      {/* RIVER SELECTION */}
      <section className="card">
        <h3>Select River and Monitoring Station</h3>

        <p style={{ color: colors.muted }}>
          Select any river with a linked WAMIS gauge.
          Predictions depend on available station history
          and model support.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
            gap: '14px',
            marginTop: '18px'
          }}
        >
          <label>
            Region
            <select
              style={{ width: '100%' }}
              value={region}
              onChange={e => {
                setRegion(e.target.value);
                setRiverId('');
                setStationId('');
              }}
            >
              <option value="all">All South Korea</option>

              {regions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label>
            River
            <select
              style={{ width: '100%' }}
              value={selectedRiver?.river_id || ''}
              onChange={e => {
                setRiverId(e.target.value);
                setStationId('');
              }}
            >
              {filteredRivers.length === 0 && (
                <option value="">
                  No monitored rivers
                </option>
              )}

              {filteredRivers.map(river => (
                <option
                  key={river.river_id}
                  value={river.river_id}
                >
                  {river.name_en} · {river.name_ko}
                </option>
              ))}
            </select>
          </label>

          <label>
            Monitoring Gauge
            <select
              style={{ width: '100%' }}
              value={selectedStation?.station_id || ''}
              disabled={!availableStations.length}
              onChange={e => setStationId(e.target.value)}
            >
              {availableStations.map(station => (
                <option
                  key={station.station_id}
                  value={station.station_id}
                >
                  {station.station_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setRefreshKey(v => v + 1)}
          style={{ marginTop: '16px' }}
        >
          Refresh Data
        </button>

        <p
          style={{
            color: colors.muted,
            marginBottom: 0,
            marginTop: '12px'
          }}
        >
          Monitored rivers: {catalog.length}
          {' · '}
          Available gauges:{' '}
          {catalog.reduce(
            (total, river) =>
              total + (river.stations?.length || 0),
            0
          )}
          {' · '}
          Automatic refresh: 60 seconds
        </p>
      </section>

      {selectedStation && (
        <>
          {/* STATION DETAILS */}
          <section className="card">
            <h3>
              {selectedRiver?.name_en} — Selected Gauge
            </h3>

            <p>{selectedStation.station_name}</p>

            <p style={{ color: colors.muted }}>
              WAMIS station code: {stationCode}
              {' · '}
              Observed: {showTime(observedAt)}
            </p>

            {loading && (
              <p style={{ color: colors.muted }}>
                Updating observations...
              </p>
            )}

            {error && <Notice>{error}</Notice>}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
                gap: '14px',
                marginTop: '18px'
              }}
            >
              <MetricCard
                title="Observed Water Level"
                value={level(observedLevel)}
                detail={showTime(observedAt)}
              />

              <MetricCard
                title="1-Hour Baseline Forecast"
                value={level(baseline?.predicted_water_level_m)}
                detail={
                  baseline
                    ? showTime(baseline.target_time)
                    : 'Not available for this station'
                }
              />

              <MetricCard
                title="Experimental Ridge ML Forecast"
                value={level(ridge?.predicted_water_level_m)}
                detail={
  ridge
    ? `${showTime(ridge.target_time)} · ${
        isTaehwa
          ? 'Rainfall-aware Ridge'
          : 'Water-level Ridge'
      }`
    : isTaehwa
      ? rainfallModel?.prediction_reason ||
        rainfallModel?.reason ||
        'No current live ML prediction'
      : multiRiverModel?.prediction_reason ||
        multiRiverModel?.reason ||
        'Not enough data or model not validated'
}
              />
            </div>
          </section>

          {/* WATER-LEVEL CHART */}
          <section className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <h3>Water-Level History & Forecast</h3>

              <label>
                History Period{' '}
                <select
                  value={historyHours}
                  onChange={e =>
                    setHistoryHours(Number(e.target.value))
                  }
                >
                  <option value={24}>24 hours</option>
                  <option value={48}>48 hours</option>
                  <option value={72}>72 hours</option>
                  <option value={168}>7 days</option>
                </select>
              </label>
            </div>

            <WaterLevelChart
              readings={history}
              baseline={baseline}
              ridge={ridge}
              showForecast={isFresh}
            />

            <p style={{ color: colors.muted }}>
              Observed data comes from WAMIS. Forecast
              markers are displayed only when their inputs
              are current and the backend supplies a
              valid future prediction.
            </p>
          </section>

          {/* MODEL PERFORMANCE */}
          <section className="card">
            <h3>Model Performance Comparison</h3>

            {hasBaselineEvaluation ? (
              <div style={{ marginTop: '14px' }}>
                <h4>Persistence Baseline</h4>

                <p>
                  Evaluated pairs:{' '}
                  <strong>
                    {baselineEvaluation.evaluated_pairs}
                  </strong>
                </p>

                <p>
                  MAE:{' '}
                  <strong>
                    {level(baselineEvaluation.mae_m)}
                  </strong>
                  {' · '}
                  RMSE:{' '}
                  <strong>
                    {level(baselineEvaluation.rmse_m)}
                  </strong>
                </p>
              </div>
            ) : (
              <p>
                Baseline evaluation is not available
                for this station.
              </p>
            )}

            {modelHasEvaluation && (
              <div
                style={{
                  marginTop: '20px',
                  borderTop: `1px solid ${colors.border}`,
                  paddingTop: '16px'
                }}
              >
                <h4>
  {isTaehwa
    ? 'Rainfall-Aware Ridge Regression'
    : 'Water-Level Ridge Regression'}
</h4>

                <p>
                  Chronological holdout samples:{' '}
                  <strong>{evaluation.evaluated_pairs}</strong>
                </p>

                <p>
                  Ridge MAE:{' '}
                  <strong>{level(evaluation.mae_m)}</strong>
                  {' · '}
                  Ridge RMSE:{' '}
                  <strong>{level(evaluation.rmse_m)}</strong>
                </p>

                <p>
                  Baseline MAE on the same samples:{' '}
                  <strong>
                    {level(
                      evaluation.baseline_on_same_samples?.mae_m
                    )}
                  </strong>
                </p>

                <p>
                  Result:{' '}
                  <strong>
                    {isTaehwa
  ? evaluation.beats_baseline_mae
    ? 'Ridge has lower MAE on this holdout'
    : 'Ridge does not beat the baseline'
  : evaluation.beats_baseline_by_5_percent
    ? 'Ridge passed the 5% improvement requirement'
    : 'Ridge did not pass the improvement requirement'}
                  </strong>
                </p>
              </div>
            )}

          
            <p
              style={{
                fontSize: '12px',
                color: colors.muted
              }}
            >
              Evaluation results are historical. They
              do not guarantee accuracy during future
              floods or extreme weather.
            </p>
          </section>

          {/* MODEL STATUS */}
          <section className="card">
            <h3>Prediction Availability</h3>

            <p>
              <strong>River observation:</strong>{' '}
              {prediction?.data_freshness?.status ||
                'Unavailable'}
            </p>

            <p>
              
<strong>Baseline:</strong>{' '}
{baseline
  ? '1-hour persistence forecast available'
  : prediction?.data_freshness?.status !== 'FRESH'
    ? 'Waiting for fresh river observations'
    : 'Requires two consecutive valid hourly river observations'}

            </p>

            <p>
              <strong>Experimental ML:</strong>{' '}
{ridge
  ? 'Live experimental forecast available'
  : isTaehwa
    ? rainfallModel?.prediction_reason ||
      rainfallModel?.reason ||
      'Unavailable'
    : multiRiverModel?.prediction_reason ||
      multiRiverModel?.reason ||
      'Unavailable'}
            </p>

            {isTaehwa &&
              rainfallModel?.live_input_diagnostics
                ?.missing_rainfall_hours?.length > 0 && (
                <p style={{ color: colors.muted }}>
                  Waiting for rainfall at:{' '}
                  {rainfallModel.live_input_diagnostics
                    .missing_rainfall_hours.join(', ')}
                </p>
              )}

            <p style={{ color: colors.muted }}>
              The rainfall-aware model requires genuine,
              timestamp-aligned observations. Missing
              rainfall is never replaced with an assumed zero.
            </p>
          </section>

          {/* SAFETY INFORMATION */}
          <section className="card">
            <h3>Flood-Risk Assessment</h3>

            <p>
              <strong>Official status: Not assessed</strong>
            </p>

            <p>
              Water-level forecasts are not official
              flood-risk classifications. Validated
              gauge-specific thresholds and compatible
              measurement datums are required before
              automatic flood-stage assessment.
            </p>

            <p style={{ color: colors.muted }}>
              Educational research prototype — not an
              official emergency or flood-warning service.
            </p>
          </section>
        </>
      )}

      {!selectedStation && (
        <Notice>
          No linked WAMIS monitoring gauge is available
          in the current selection.
        </Notice>
      )}
    </Section>
  );
}
