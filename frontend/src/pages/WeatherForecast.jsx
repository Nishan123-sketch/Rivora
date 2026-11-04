import { parseTime } from "../lib/time";

import { useEffect, useMemo, useRef, useState } from "react";
import { metric, observed } from "../lib/format";
import {
  availableForecastDays, effectiveStationId, fetchStationForecast, isRecent,
  kmaStationOptions, latestObservation, MAX_FORECAST_ISSUE_AGE_MS,
  numberOrNull, rainfallForecastLabel, requestStationForecastImport,
  upcomingForecasts, weatherDetails
} from "../lib/weatherForecastData";


function formatForecastTime(value) {
  if (!value) return "Unknown time";

  const date = parseTime(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid time";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}


function ForecastChart({ forecasts }) {
  const points = forecasts
    .slice(0, 24)
    .map((item) => ({
      time: item.valid_at,
      temperature: numberOrNull(item.temperature_forecast),
      rainfall: numberOrNull(item.rainfall_forecast)
    }));

  const temperatures = points
    .map((p) => p.temperature)
    .filter((v) => v !== null);

  const rainfalls = points
    .map((p) => p.rainfall)
    .filter((v) => v !== null);

  if (temperatures.length === 0 && rainfalls.length === 0) {
    return (
      <p className="muted">
        No numerical forecast values are available for the chart.
      </p>
    );
  }

  const width = 640;
  const height = 240;
  const left = 35;
  const right = 20;
  const top = 25;
  const bottom = 35;

  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  const minTemp = temperatures.length
    ? Math.min(...temperatures) - 1
    : 0;

  const maxTemp = temperatures.length
    ? Math.max(...temperatures) + 1
    : 1;

  const maxRain = Math.max(1, ...rainfalls);

  function x(index) {
    return left +
      (index / Math.max(1, points.length - 1)) * chartWidth;
  }

  function tempY(value) {
    return top + chartHeight -
      ((value - minTemp) / Math.max(1, maxTemp - minTemp)) *
        chartHeight;
  }

  function rainY(value) {
    return top + chartHeight -
      (value / maxRain) * chartHeight;
  }

  function segments(key, yFunction) {
    const result = [];
    let current = [];

    points.forEach((point, index) => {
      if (point[key] === null) {
        if (current.length) result.push(current);
        current = [];
      } else {
        current.push(
          `${x(index)},${yFunction(point[key])}`
        );
      }
    });

    if (current.length) result.push(current);
    return result;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto" }}
        role="img"
        aria-label="Temperature and rainfall forecasts"
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = top + fraction * chartHeight;

          return (
            <line
              key={fraction}
              x1={left}
              y1={y}
              x2={width - right}
              y2={y}
              stroke="#e5edf4"
              strokeDasharray="4 5"
            />
          );
        })}

        {segments("temperature", tempY).map((segment, i) => (
          <polyline
            key={`temp-${i}`}
            points={segment.join(" ")}
            fill="none"
            stroke="#1879e6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {segments("rainfall", rainY).map((segment, i) => (
          <polyline
            key={`rain-${i}`}
            points={segment.join(" ")}
            fill="none"
            stroke="#07999c"
            strokeWidth="2.5"
            strokeDasharray="6 5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        <text x={left} y={height - 7} fontSize="12" fill="#718198">
          {formatForecastTime(points[0]?.time)}
        </text>

        <text
          x={width - right}
          y={height - 7}
          fontSize="12"
          textAnchor="end"
          fill="#718198"
        >
          {formatForecastTime(points[points.length - 1]?.time)}
        </text>
      </svg>

      <div className="chart-legend">
        <span>
          <i className="legend-dot temp" />
          Temperature (°C)
        </span>
        <span>
          <i className="legend-dot rain" />
          Forecast rainfall (mm)
        </span>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Temperature and rainfall use separate scales.
        The chart plots exact numerical rainfall only; categorical ranges appear in the hourly list.
      </p>
    </div>
  );
}

export default function WeatherForecast({ weather = [], stations = [] }) {
  const [selected, setSelected] = useState("");
  const [forecastData, setForecastData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const options = useMemo(() => kmaStationOptions(stations, weather), [stations, weather]);
  const selectedStationId = effectiveStationId(selected, options);
  const selectedStation = options.find(item => item.station_id === selectedStationId);
  const currentStationRef = useRef(selectedStationId);
  useEffect(() => { currentStationRef.current = selectedStationId; }, [selectedStationId]);
  const w = useMemo(() => latestObservation(weather, selectedStationId), [weather, selectedStationId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // The display filters results by station; never show another station’s forecast.
    if (!selectedStationId) {
      queueMicrotask(() => { if (!controller.signal.aborted) { setForecastData(null); setLoading(false); } });
      return () => controller.abort();
    }
    queueMicrotask(() => { if (!controller.signal.aborted) { setForecastData(null); setForecastError(""); setImportMessage(""); setLoading(true); } });
    fetchStationForecast(fetch, selectedStationId, controller.signal)
      .then(data => { if (!controller.signal.aborted) setForecastData(data); })
      .catch(error => {
        if (!controller.signal.aborted) setForecastError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedStationId, refreshKey]);
  // Leave a pending import bound to its original station, even if the user
  // changes the dropdown while the request is in flight.
  async function importSelectedForecast() {
    if (!selectedStationId || importing) return;
    const requestedStation = selectedStationId;
    setImporting(true);
    setImportMessage('Requesting KMA forecast...');
    try {
      await requestStationForecastImport(fetch, requestedStation);
      if (currentStationRef.current === requestedStation) {
        setRefreshKey(v => v + 1);
        setImportMessage('KMA forecast import completed.');
      }
    } catch (error) {
      if (currentStationRef.current === requestedStation) setImportMessage(error.message);
    } finally {
      setImporting(false);
    }
  }

  // Do not show old-city data while a new-city request is pending.
  const forecasts = useMemo(() => upcomingForecasts(forecastData, selectedStationId, now), [forecastData, selectedStationId, now]);
  const details = useMemo(() => weatherDetails(w, forecasts, now), [w, forecasts, now]);
  const forecastDays = useMemo(() => availableForecastDays(forecasts), [forecasts]);
  const issueIsOld = forecastData && String(forecastData.station_id) === String(selectedStationId)
    && forecastData.forecasts?.length > 0
    && !forecastData.forecasts.some(item => isRecent(item.issued_at, now, MAX_FORECAST_ISSUE_AGE_MS));

  return (
    <div className="design-weather">
      <section className="card weather-shell">
        <div className="weather-hero">
          <div className="weather-left">
            <p className="caps">
              {selectedStation?.station_name || "SELECT A KMA STATION"}{" • CURRENT WEATHER"}
            </p>
            <strong className="huge">{metric(details.temperature, "°C", 1)}</strong>
            <p>Observed: {details.observationIsFresh ? observed(w?.observed_at) : "No data (no recent observation)"}</p>
          </div>
          <div className="wd">
            <div className="weather-head">
              <p className="caps">WEATHER DETAILS</p>
              <select
                aria-label="Select weather station"
                className="weather-station-select"
                value={selectedStationId || ""}
                onChange={event => setSelected(event.target.value)}
              >
                {options.map(item => (
                  <option key={item.station_id} value={item.station_id}>{item.station_name}</option>
                ))}
              </select>
            </div>
            <div className="weather-details-grid">
              <span>
                {details.rainfallSource === 'ASOS' ? 'Reported rainfall (ASOS)' : 'Hourly rainfall (AWS)'}
                <br />
                <b>{metric(details.rainfall, 'mm')}</b>
              </span>
              <span>
                Humidity ({details.humiditySource})
                <br />
                <b>{metric(details.humidity, '%')}</b>
              </span>
              <span>
                Wind ({details.windSource})
                <br />
                <b>{metric(details.wind, 'm/s')}</b>
              </span>
              <span>
                Rain chance (forecast)
                <br />
                <b>{metric(details.rainChance, '%')}</b>
              </span>
            </div>
            <p className="weather-footnote">
              Observed temperature, humidity, wind, and rainfall require a reading from the last three hours.
              Forecast values are labeled and use the nearest upcoming KMA hour.
              {details.rainfallSource === 'AWS'
                ? ` AWS station ${details.awsStationCode || 'No data'}, observed ${observed(details.rainfallObservedAt)} KST.`
                : details.rainfallSource === 'ASOS'
                  ? ` Reported ASOS rainfall observed ${observed(details.rainfallObservedAt)} KST; do not interpret it as a six-hour total.`
                  : ' Rainfall observation unavailable.'}
              {' '}Weather information is separate from flood-risk estimates.
            </p>
          </div>
        </div>
      </section>

      <section className="card forecast-hours">
        <h3>Hourly forecast</h3>
        <p className="muted">KMA short-term forecast temperature and rainfall</p>
        {loading ? (
          <p>Loading forecast...</p>
        ) : forecastError ? (
          <div className="muted">
            <p>Forecast request failed: {forecastError}</p>
            <button type="button" disabled={importing || !selectedStationId} onClick={importSelectedForecast}>
              {importing ? 'Importing...' : 'Retry KMA forecast import'}
            </button>
            {importMessage && <p>{importMessage}</p>}
          </div>
        ) : forecasts.length === 0 ? (
          <div className="muted">
            <p>{issueIsOld ? 'The last stored forecast is outdated.' : 'No upcoming KMA forecast is stored for this station.'}</p>
            <button type="button" disabled={importing || !selectedStationId} onClick={importSelectedForecast}>
              {importing ? 'Importing...' : 'Fetch KMA forecast for this location'}
            </button>
            {importMessage && <p>{importMessage}</p>}
          </div>
        ) : (
          <>
            <p className="muted">Issued: {observed(forecasts[0]?.issued_at)} KST</p>
            <div className="forecast-hour-list">
              {forecasts.slice(0, 7).map((item, index) => (
                <div className="forecast-hour-item" key={`${item.valid_at}-${index}`}>
                  <strong>{formatForecastTime(item.valid_at)}</strong>
                  <div>{metric(item.temperature_forecast, '°C', 1)}</div>
                  <small>
                    Rain: {rainfallForecastLabel(item)} · Chance: {metric(item.precipitation_probability, '%')} · Humidity: {metric(item.humidity_forecast, '%')} · Wind: {metric(item.wind_speed_forecast, 'm/s')}
                  </small>
                </div>
              ))}
            </div>
            <button type="button" disabled={importing} onClick={importSelectedForecast}>
              {importing ? 'Importing...' : 'Refresh forecast from KMA'}
            </button>
            {importMessage && <p className="muted">{importMessage}</p>}
          </>
        )}
      </section>

      <div className="grid-even">
        <section className="card weather-chart">
          <h3>Temperature & precipitation trend</h3>
          <p className="muted">Next available forecast periods</p>
          {forecasts.length > 0 ? <ForecastChart forecasts={forecasts} /> : (
            <p className="muted">Forecast chart is unavailable for this station.</p>
          )}
        </section>
        <section className="card week-panel">
          <h3>Available short-term forecast days</h3>
          <p className="muted">Only hours supplied by KMA, not full-day extremes or seven-day predictions</p>
          {forecastDays.length > 0 ? (
            <div className="forecast-summary-list">
              {forecastDays.map(day => (
                <div className="forecast-summary-row" key={day.date}>
                  <strong>{day.date} ({day.hours} hours)</strong>
                  <span>{day.temperatures.length
                    ? `${Math.min(...day.temperatures).toFixed(1)}–${Math.max(...day.temperatures).toFixed(1)} °C (available hours)`
                    : 'No data'}</span>
                  <span>{day.rainChance.length
                    ? `Rain chance up to ${Math.max(...day.rainChance).toFixed(0)}% (available hours)`
                    : 'No data'}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No short-term forecast data available.</p>}
          <p className="muted" style={{ marginTop: 18 }}>
            A complete seven-day forecast requires a separate supported mid-term KMA data source.
          </p>
        </section>
      </div>
    </div>
  );
}
