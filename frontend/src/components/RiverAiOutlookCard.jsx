import {englishText} from '../lib/englishDisplay';
import {useEffect, useState} from 'react';
import {apiFetch} from '../lib/apiFetch';

const HORIZONS = [1, 3, 6];

function readableNumber(value, places = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(places)} m` : 'Unavailable';
}

export default function RiverAiOutlookCard({stationId}) {
  if(!stationId)return <section className="card"><h3>River-level outlook</h3><p>Select a monitoring station to inspect its forecasts.</p></section>;
  return <RiverAiOutlookContent key={String(stationId)} stationId={stationId}/>;
}
function RiverAiOutlookContent({stationId}) {
  const [outlook, setOutlook] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stationId) return undefined;
    const abort = new AbortController();
    const timeout = setTimeout(() => {abort.abort();setError('The forecasting request timed out.');setLoading(false);}, 18000);
    async function getJson(path) {
      const response = await apiFetch(path, {signal: abort.signal});
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      const body = await response.json();
      if (body?.success === false) throw new Error(body.message || 'API response error');
      return body;
    }
    async function load() {
      const results = await Promise.allSettled([
        getJson(`/api/risk/ai-outlook/${stationId}`),
        getJson(`/api/risk/warning-history/${stationId}`)
      ]);
      if (abort.signal.aborted) return;
      if (results[0].status === 'fulfilled') setOutlook(results[0].value);
      else setError(results[0].reason.message);
      if (results[1].status === 'fulfilled') setEvents(results[1].value);
      setLoading(false);
    }
    void load();
    return () => {clearTimeout(timeout); abort.abort();};
  }, [stationId]);

  return <section className="card" aria-label="Rivora multi-horizon river-level forecast">
    <h3>Rivora AI-style river-level outlook</h3>
    <p className="muted">Independent 1-, 3-, and 6-hour river-level forecasts. Evaluated against a historical persistence baseline; not the Korean government AI model or a flood probability.</p>
    {loading && <p role="status">Checking forecasting history…</p>}
    {error && <p role="alert">Forecast unavailable: {error}</p>}
    {outlook && <>
      <p className="muted">Observed: {outlook.horizons?.find(h => h.observed_at)?.observed_at || 'Unavailable'} KST · WAMIS {outlook.wamis_code}</p>
      <div className="river-coverage">
        {HORIZONS.map(hour => {
          const forecast = outlook.horizons?.find(item => item.horizon_hours === hour);
          return <div key={hour}>
            <span>{hour}-hour forecast</span>
            <strong>{forecast?.forecast_status === 'AVAILABLE' ? readableNumber(forecast.predicted_level_m) : 'Unavailable'}</strong>
            <small className="muted">{forecast?.forecast_status === 'AVAILABLE' ? `${forecast.model_kind === 'RIDGE' ? 'Ridge regression' : 'Persistence'} · historical MAE: ${forecast.holdout?.chosen_method === 'RIDGE' ? forecast.holdout?.model?.mae_m : forecast.holdout?.persistence?.mae_m} m` : forecast?.reason?.replaceAll('_', ' ').toLowerCase() || 'Insufficient data'}</small>
          </div>;
        })}
      </div>
      <p className="muted">Rainfall input: {outlook.horizons?.some(h => h.model_features === 'PAST_WATER_LEVEL_AND_PAST_6H_KMA_RAINFALL') ? 'Nearest KMA historical rainfall proxy included where complete' : 'Water levels only; rainfall history missing or not eligible'}. Forecast quality varies by gauge and season.</p>
    </>}
    <h4>Official HRFCO warning history</h4>
    {events ? <>
      <p className="muted">{events.historical_event_count} imported historical notices for matching WAMIS gauge {events.wamis_station_code}. Historical notices are not current warnings.</p>
      {events.events?.slice(0, 3).map((event, i) => <div className="river-detail-row" key={`${event.issued_at}-${event.kind}-${i}`}>
        <span>{event.issued_at} KST · {englishText(event.station_name)}</span>
        <b>{event.kind}</b>
      </div>)}
    </> : <p className="muted">No imported warning archive available. Run <code>npm run import:hrfco-history</code> in the backend to import the included historical notice sample.</p>}
    <p className="muted"><strong>Important:</strong> These are water-level predictions and historical warnings—not validated inundation forecasts or official alerts. No absence of a warning implies safety.</p>
  </section>;
}
