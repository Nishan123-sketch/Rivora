import { parseTime } from './time.js';

export const HOUR_MS = 60 * 60 * 1000;
export const MAX_OBSERVATION_AGE_MS = 3 * HOUR_MS;
export const MAX_FORECAST_ISSUE_AGE_MS = 12 * HOUR_MS;

export function numberOrNull(value) {
  if (value === null || value === undefined || typeof value === 'boolean' ||
      (typeof value === 'string' && value.trim() === '')) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function timeMillis(value) {
  return parseTime(value).getTime();
}

export function isRecent(value, nowMs, maxAgeMs) {
  const time = timeMillis(value);
  return Number.isFinite(time) && nowMs >= time && nowMs - time <= maxAgeMs;
}

// KMA observations and the KMA station catalog can arrive independently.
// Use the catalog so cities without an observation are still selectable.
export function kmaStationOptions(stations = [], observations = []) {
  const byId = new Map();
  const hasCatalog = stations.some(row => row?.data_source === 'KMA');
  // When the catalog is present, it is authoritative. Weather observations
  // lack a data_source property and must not accidentally add river gauges.
  const sourceRows = hasCatalog ? stations : observations;
  for (const row of sourceRows) {
    if (row?.station_id === null || row?.station_id === undefined) continue;
    if (row.data_source && row.data_source !== 'KMA') continue;
    const id = String(row.station_id);
    if (!/^\d+$/.test(id)) continue;
    const old = byId.get(id);
    byId.set(id, {
      station_id: id,
      station_name: row.station_name || old?.station_name || `KMA station ${id}`,
      external_station_id: row.external_station_id || old?.external_station_id || null
    });
  }
  return [...byId.values()].sort((a, b) => a.station_name.localeCompare(b.station_name, 'ko'));
}

export function effectiveStationId(selected, options) {
  return options.some(row => row.station_id === String(selected))
    ? String(selected)
    : options[0]?.station_id ?? null;
}

export function latestObservation(observations = [], stationId) {
  return observations
    .filter(item => String(item.station_id) === String(stationId) && Number.isFinite(timeMillis(item.observed_at)))
    .sort((a, b) => timeMillis(b.observed_at) - timeMillis(a.observed_at))[0] ?? null;
}

export function upcomingForecasts(response, stationId, nowMs) {
  if (!response || String(response.station_id) !== String(stationId)) return [];
  if (!Array.isArray(response.forecasts)) return [];
  const unique = new Map();
  for (const row of response.forecasts) {
    const when = timeMillis(row.valid_at);
    if (!Number.isFinite(when) || when < nowMs) continue;
    // Rejected old issues must not be presented as current forecasts.
    if (!isRecent(row.issued_at, nowMs, MAX_FORECAST_ISSUE_AGE_MS)) continue;
    const key = String(when);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => timeMillis(a.valid_at) - timeMillis(b.valid_at));
}

export function chooseNextForecastValue(forecasts, key) {
  // The nearest future period is authoritative; do not skip a missing value
  // and silently substitute a different hour.
  return numberOrNull(forecasts[0]?.[key]);
}

export function weatherDetails(observation, forecasts, nowMs) {
  const observationIsFresh = isRecent(observation?.observed_at, nowMs, MAX_OBSERVATION_AGE_MS);
  const awsIsFresh = isRecent(observation?.aws_observed_at, nowMs, MAX_OBSERVATION_AGE_MS);
  const next = forecasts[0] ?? null;

  const observedHumidity = observationIsFresh ? numberOrNull(observation?.humidity) : null;
  const observedWind = observationIsFresh ? numberOrNull(observation?.wind_speed) : null;
  const asosRain = observationIsFresh ? numberOrNull(observation?.rainfall) : null;
  const awsRain = awsIsFresh ? numberOrNull(observation?.aws_hourly_rainfall) : null;

  return {
    observationIsFresh,
    awsIsFresh,
    temperature: observationIsFresh ? numberOrNull(observation?.temperature) : null,
    humidity: observedHumidity ?? chooseNextForecastValue(forecasts, 'humidity_forecast'),
    humiditySource: observedHumidity !== null ? 'observed' : 'forecast',
    wind: observedWind ?? chooseNextForecastValue(forecasts, 'wind_speed_forecast'),
    windSource: observedWind !== null ? 'observed' : 'forecast',
    rainChance: chooseNextForecastValue(forecasts, 'precipitation_probability'),
    rainfall: asosRain ?? awsRain,
    rainfallSource: asosRain !== null ? 'ASOS' : awsRain !== null ? 'AWS' : null,
    rainfallObservedAt: asosRain !== null ? observation?.observed_at : awsRain !== null ? observation?.aws_observed_at : null,
    awsStationCode: awsRain !== null ? observation?.aws_station_code : null,
    forecastTime: next?.valid_at ?? null
  };
}

export function rainfallForecastLabel(item) {
  if (!item) return 'No data';
  const exact = numberOrNull(item.rainfall_forecast);
  if (exact !== null) return `${exact.toFixed(2)} mm`;
  const raw = typeof item.precipitation_raw === 'string' ? item.precipitation_raw.trim() : '';
  // KMA supplied a categorical range; retain it with its units.
  if (raw) return raw;
  const min = numberOrNull(item.precipitation_min_mm);
  const max = numberOrNull(item.precipitation_max_mm);
  if (min === null || max === null) return 'No data';
  if (min === max) return `${min.toFixed(2)} mm`;
  return Number(item.precipitation_max_exclusive) === 1
    ? `${min.toFixed(2)} to <${max.toFixed(2)} mm`
    : `${min.toFixed(2)}–${max.toFixed(2)} mm`;
}

export async function fetchStationForecast(fetchImpl, stationId, signal) {
  const response = await fetchImpl(`/api/weather/forecast?station_id=${encodeURIComponent(stationId)}`, { signal });
  if (!response.ok) throw new Error(`Forecast API HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.forecasts) || String(data.station_id) !== String(stationId)) {
    throw new Error('Forecast response does not match the selected KMA station');
  }
  return data;
}

export async function requestStationForecastImport(fetchImpl, stationId, signal) {
  const response = await fetchImpl('/api/weather/forecast/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Rivora-Request': '1' },
    body: JSON.stringify({ station_id: Number(stationId) }),
    signal
  });
  const data = await response.json();
  if (!response.ok || data.success !== true || String(data.station_id) !== String(stationId)) {
    throw new Error(data.message || `Forecast import HTTP ${response.status}`);
  }
  return data;
}

// These are summaries of the *available* KMA short-term hours, not
// full-day high/low temperatures or a seven-day medium-range forecast.
export function availableForecastDays(forecasts) {
  const byDate = new Map();
  for (const row of forecasts) {
    const date = String(row.valid_at || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  return [...byDate.entries()].map(([date, items]) => ({
    date,
    hours: items.length,
    temperatures: items.map(i => numberOrNull(i.temperature_forecast)).filter(v => v !== null),
    rainChance: items.map(i => numberOrNull(i.precipitation_probability)).filter(v => v !== null)
  }));
}
