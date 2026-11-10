import ObservationPlot from '../components/ObservationPlot';
import {englishStationName} from '../lib/englishDisplay';
import WeeklyForecast from '../components/WeeklyForecast';
import WeatherIcon from '../components/WeatherIcon';
import WeatherAtmosphere from '../components/WeatherAtmosphere';
import {weatherAtmosphere} from '../lib/weatherAtmosphere';
import '../styles/weather.css';
import { parseTime } from "../lib/time";

import { useEffect, useMemo, useRef, useState } from "react";
import { metric, observed } from "../lib/format";
import {
  effectiveStationId, fetchStationForecast, isRecent,
  kmaStationOptions, latestObservation, MAX_FORECAST_ISSUE_AGE_MS,
  rainfallForecastLabel, requestStationForecastImport,
  upcomingForecasts, weatherDetails
} from "../lib/weatherForecastData";


function formatForecastTime(value,part='time') {
  const date=parseTime(value);
  if(!Number.isFinite(date.getTime()))return 'Time unavailable';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',...(part==='date'?{weekday:'short',day:'numeric',month:'short'}:{hour:'2-digit',minute:'2-digit',hour12:false})}).format(date);
}
function englishRainfall(item){
 const label=rainfallForecastLabel(item);
 return label.replace(/^(\d+(?:\.\d+)?)\s*mm\s*미만$/,'Less than $1 mm').replace(/^강수없음$/,'No precipitation');
}


function ForecastChart({forecasts}){const rows=forecasts.slice(0,24).map(r=>({...r,observed_at:r.valid_at}));return <div className="weather-labelled-charts"><ObservationPlot rows={rows} field="temperature_forecast" label="Forecast temperature (°C)" unit="°C" color="#247bd4"/><ObservationPlot rows={rows} field="rainfall_forecast" label="Forecast rainfall (mm)" unit="mm"/></div>;}

export default function WeatherForecast({ weather = [], stations = [] }) {
  const [conditionCode,setConditionCode]=useState(null);
  const [selected, setSelected] = useState("");
  const [forecastData, setForecastData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
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
  }, [selectedStationId]);
  // Leave a pending import bound to its original station, even if the user
  // changes the dropdown while the request is in flight.
  async function importSelectedForecast() {
    if (!selectedStationId || importing) return;
    const requestedStation = selectedStationId;
    setImporting(true);
    setImportMessage('Requesting and saving the latest KMA forecast...');
    try {
      await requestStationForecastImport(fetch, requestedStation);
      if (currentStationRef.current === requestedStation) {
        const refreshed=await fetchStationForecast(fetch,requestedStation);
        setForecastData(refreshed);
        setForecastError('');
        setImportMessage(refreshed.forecasts.length?'KMA forecast retrieved and saved successfully.':'KMA data was saved, but this issue has no upcoming forecast periods.');
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

  const issueIsOld = forecastData && String(forecastData.station_id) === String(selectedStationId)
    && !isRecent(forecastData.latest_issue_at || forecastData.forecasts?.[0]?.issued_at, now, MAX_FORECAST_ISSUE_AGE_MS);

  return (
    <div className="design-weather">
      <section className="card weather-shell">
        <div className="weather-hero weather-hero-animated">
          <WeatherAtmosphere {...weatherAtmosphere(w,details)}/>
          <div className="weather-left">
            <p className="caps">
              {selectedStation?englishStationName(selectedStation.station_name):"SELECT A LOCATION"}{" • CURRENT WEATHER"}
            </p>
            <strong className="huge"><WeatherIcon code={conditionCode}/>{metric(details.temperature, "°C", 1)}</strong>
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
                  <option key={item.station_id} value={item.station_id}>{englishStationName(item.station_name)}</option>
                ))}
              </select>
            </div>
            <div className="weather-details-grid">
              <span>
                Hourly rainfall
                <br />
                <b>{metric(details.rainfall, 'mm')}</b>
              </span>
              <span>
                Humidity
                <br />
                <b>{metric(details.humidity, '%')}</b>
              </span>
              <span>
                Wind
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
        <div className="forecast-section-heading"><div><span className="forecast-eyebrow">THE HOURS AHEAD</span><h3>Hourly forecast</h3><p className="muted">Temperature, rainfall and changing conditions</p></div><span className="forecast-timezone">KST · Seoul time</span></div>
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
            <p className="forecast-issued" title={observed(forecasts[0]?.issued_at)}>Forecast issued {formatForecastTime(forecasts[0]?.issued_at,'date')} · {formatForecastTime(forecasts[0]?.issued_at)} KST</p>
            <div className="forecast-hour-list">
              {forecasts.slice(0, 7).map((item, index) => (
                <article className="forecast-hour-item" key={`${item.valid_at}-${index}`} style={{animationDelay:`${index*55}ms`}}>
                  <div className="forecast-card-top"><span>{formatForecastTime(item.valid_at,'date')}</span>{index===0&&<span className="forecast-next">Next</span>}</div>
                  <time className="forecast-clock" title={`${observed(item.valid_at)} KST`}>{formatForecastTime(item.valid_at)}<small>KST</small></time>
                  <div className="forecast-temperature"><svg viewBox="0 0 24 32" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 19V6a3 3 0 0 1 6 0v13a6 6 0 1 1-6 0Z"/><path d="M12 12v12"/><circle cx="12" cy="24" r="2"/></svg>{metric(item.temperature_forecast, "°C", 1)}</div>
                  <div className="forecast-card-details"><div><span>Rain</span><b>{englishRainfall(item)}</b></div><div><span>Rain chance</span><b>{metric(item.precipitation_probability, '%')}</b></div><div><span>Humidity</span><b>{metric(item.humidity_forecast, '%')}</b></div><div><span>Wind</span><b>{metric(item.wind_speed_forecast, 'm/s')}</b></div></div>
                </article>
              ))}
            </div>
            <button className="forecast-refresh" type="button" disabled={importing} onClick={importSelectedForecast}>
              {importing ? 'Importing...' : 'Refresh forecast'}
            </button>
            {importMessage && <p className="muted">{importMessage}</p>}
          </>
        )}
      </section>

      <div className="weather-forecast-split">
        <section className="card weather-chart">
          <h3>Temperature & precipitation trend</h3>
          <p className="muted">Next available forecast periods</p>
          {forecasts.length > 0 ? <ForecastChart forecasts={forecasts} /> : (
            <p className="muted">Forecast chart is unavailable for this station.</p>
          )}
        </section>

        <WeeklyForecast stationId={selectedStationId} onCondition={setConditionCode}/>
      </div>
    </div>
  );
}
