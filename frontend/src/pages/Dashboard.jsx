import {englishStationName} from '../lib/englishDisplay';
import {overviewRiskMetric} from '../lib/overviewRiskMetric';
import {apiFetch} from '../lib/apiFetch.js';
import {useRisk} from '../lib/useRisk';
import RiskBadge from '../components/RiskBadge';
import HistoryChart from '../components/HistoryChart';
import {riskColors} from '../lib/risk';
import { parseTime } from "../lib/time";
import { useEffect, useMemo, useState } from "react";
import { metric } from "../lib/format";
import '../styles/overview.css';

const HOUR = 3600000;
const num = (v) => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const timestamp = (v) => v ? parseTime(v).getTime() : NaN;
const kst = (v) => v && Number.isFinite(timestamp(v)) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(parseTime(v)) : "No data";
const fmt = (v, unit = "mm", digits = 1) => num(v) === null ? "—" : `${num(v).toFixed(digits)} ${unit}`;

function Kpi({ title, value, detail }) {
  return <section className="card kpi"><p className="caps">{title}</p><strong>{value}</strong><p className="muted">{detail}</p></section>;
}

// Uses the original mockup's teal, smooth, shaded area graph.
// It shows observed water level, never invented risk scores.
function RiverAreaChart({readings}){return <HistoryChart rows={readings} field="water_level" label="Water level (m)"/>;}

async function getJson(path, signal) {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export default function Dashboard({ weather = [], ulsanId = null, riverId = null, riverName = 'Taehwa Bridge', personalized = false }) {
  const RIVER_ID = riverId;
  const {data:unifiedRisk,loading:riskLoading,error:riskError}=useRisk();
  const [history, setHistory] = useState([]);
  const [monitoring,setMonitoring]=useState([]);
  const [official,setOfficial]=useState(null);
  const [combined, setCombined] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [latestWeather, setLatestWeather] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [errors, setErrors] = useState({});
  

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    async function refresh() {
      if (alive) setNow(Date.now());
      const requests = [
        ["monitoring", "/api/monitoring/stations", setMonitoring, data => data.data||[]],
        ["official", "/api/official-alerts", setOfficial, data => data],
        ...(RIVER_ID ? [
        ["history", `/api/rivers/${RIVER_ID}/history?hours=24`, setHistory, data => Array.isArray(data.readings) ? data.readings : []]] : []),
        ["combined", "/api/combined-analysis", setCombined, data => data],
        ["forecast", ulsanId ? `/api/weather/forecast?station_id=${encodeURIComponent(ulsanId)}` : "/api/weather/forecast", setForecast, data => data],
        ["latestWeather", "/api/weather/latest", setLatestWeather, data => Array.isArray(data.data) ? data.data : []]
      ];
      await Promise.all(requests.map(async ([key, url, setter, transform]) => {
        try {
          const data = await getJson(url, controller.signal);
          if (alive) { setter(transform(data)); setErrors(old => ({ ...old, [key]: null })); }
        } catch (e) {
          if (alive && e.name !== "AbortError") { setter(transform({})); setErrors(old => ({ ...old, [key]: e.message })); }
        }
      }));

    }
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => { alive = false; clearInterval(interval); controller.abort(); };
  }, [RIVER_ID, ulsanId]);

  const sortedHistory = useMemo(() => [...history].filter(r => num(r.water_level) !== null && Number.isFinite(timestamp(r.observed_at))).sort((a,b) => timestamp(a.observed_at) - timestamp(b.observed_at)), [history]);
  const riverLatest = sortedHistory.at(-1);
  const threeHourPrevious = riverLatest ? [...sortedHistory].reverse().find(r => timestamp(r.observed_at) <= timestamp(riverLatest.observed_at) - 3 * HOUR) : null;
  const threeHourChange = riverLatest && threeHourPrevious ? num(riverLatest.water_level) - num(threeHourPrevious.water_level) : null;
  const weatherRows = Array.isArray(latestWeather) && latestWeather.length ? latestWeather : weather;
  const weatherLatest = [...weatherRows].filter(r => String(r.station_id) === String(ulsanId)).filter(r => Number.isFinite(timestamp(r.observed_at))).sort((a,b) => timestamp(b.observed_at) - timestamp(a.observed_at))[0];
  // AWS values are kept separate from ASOS rainfall, and expire after three hours.
  const awsTime = timestamp(weatherLatest?.aws_observed_at);
  const awsAge = now - awsTime;
  const awsFresh = Number.isFinite(awsTime) && awsAge >= 0 && awsAge <= 3 * HOUR;
  const awsHourly = awsFresh ? num(weatherLatest?.aws_hourly_rainfall) : null;
  
  const rainfall6h = num(combined?.weather?.rainfall_6h);
  const rainStation = combined?.weather?.station;
  // Aggregate bounds from each upcoming KMA hourly period. Never treat a missing
  // hour as 0, and never turn "less than 1 mm" into an exact amount.
  const forecastPeriods = useMemo(() => {
    const records = forecast?.forecasts || [];
    const start = Math.floor(now / HOUR) * HOUR;
    const map = new Map();
    for (const row of records) {
      const t = timestamp(row.valid_at);
      if (Number.isFinite(t)) map.set(t, map.has(t) ? null : row);
    }
    const result = {};
    for (const hours of [3, 6, 12, 24]) {
      let min = 0, max = 0, upperExclusive = false, complete = true;
      for (let h = 1; h <= hours; h++) {
        const row = map.get(start + h * HOUR);
        if (!row) { complete = false; break; }
        const exact = num(row.rainfall_forecast);
        const lo = exact !== null ? exact : num(row.precipitation_min_mm);
        const hi = exact !== null ? exact : num(row.precipitation_max_mm);
        if (lo === null || hi === null || lo < 0 || hi < lo) { complete = false; break; }
        min += lo;
        max += hi;
        upperExclusive = upperExclusive || (exact === null && Boolean(Number(row.precipitation_max_exclusive)));
      }
      result[hours] = complete ? { min, max, upperExclusive } : null;
    }
    return result;
  }, [forecast, now]);
  const fmtBounded = (result) => {
    if (!result) return "—";
    if (Math.abs(result.max - result.min) < 1e-9) return fmt(result.min);
    if (result.min === 0 && result.upperExclusive) return `Less than ${result.max.toFixed(1)} mm`;
    return `${result.min.toFixed(1)}–${result.max.toFixed(1)} mm${result.upperExclusive ? " (upper bound excluded)" : ""}`;
  };
  const next6h = forecastPeriods[6];
  const baseSummary=monitoring.find(s=>String(s.station_id)===String(RIVER_ID));
  const assessment=unifiedRisk.find(s=>String(s.station_id)===String(RIVER_ID));
  const summary={...baseSummary,risk_level:assessment?.level,risk_score:assessment?.score};
  const riskLevel=summary?.risk_level||(riskLoading?'Checking conditions…':riskError?'Assessment reconnecting':'Not assessable');
  const riskMetric=overviewRiskMetric(assessment);

  const rain1h = awsHourly ?? (personalized ? null : num(combined?.weather?.rainfall_1h));
  const rainfallShown = rainfall6h !== null ? rainfall6h : awsHourly;
  const rainfallDetail = rainfall6h !== null
    ? `Last 6 hours · ${englishStationName(rainStation?.station_name || rainStation) || "KMA Ulsan"}`
    : awsHourly !== null
      ? `Last hour · ${kst(weatherLatest?.aws_observed_at)} KST`
      : "6h total unavailable; recent AWS 1h reading unavailable";
  const riverChangeText = threeHourChange === null ? "3-hour change unavailable" : `${threeHourChange >= 0 ? "+" : ""}${threeHourChange.toFixed(2)} m / 3h`;

  return <div className="design-overview">
    <section className="card overview-hero">
      <div className="overview-heading"><div><p className="caps">YOUR MONITORING OVERVIEW</p><h2>Environmental overview</h2><p className="muted">Water, weather and river conditions in one place.</p></div><span className="overview-location">{riverName}</span></div>
      <div className="overview-network" aria-label="Monitoring network summary"><div><strong>{riskLoading?'—':unifiedRisk.length}</strong><span>Monitored gauges</span></div><div><strong>{riskLoading?'—':unifiedRisk.filter(s=>s.observation_freshness==='FRESH').length}</strong><span>Fresh readings</span></div><div><strong>{official?.status==='Current'?official.data?.length??0:'—'}</strong><span>National weather warnings</span></div></div>
      <div className="overview-assessment"><div><span className="caps">WATER-LEVEL COMPARISON</span><div className="overview-risk"><strong style={{color:riskColors[riskLevel]||'#6b7280'}}>{riskLevel}</strong><RiskBadge assessment={assessment}/></div><p className="muted">Follow official emergency advice. This comparison is not an issued warning.</p></div>
      <div className="overview-reference" title={riskMetric.explanation}><span>{riskMetric.title}</span><strong>{riskMetric.value}</strong><small>{riskMetric.detail}</small><small>{riskMetric.explanation}</small></div></div>
    </section>
    <div className="grid4">
      <Kpi title="WATER LEVEL" value={fmt(riverLatest?.water_level, "m", 2)} detail={riverLatest ? `${riverName} · ${riverChangeText} · ${kst(riverLatest.observed_at)} KST` : errors.history || (RIVER_ID ? `${riverName} observation unavailable (no readings stored yet)` : "Monitoring gauge is not available")} />
      <Kpi title="RAINFALL" value={fmt(rainfallShown)} detail={rainfallDetail} />
      <Kpi title="FORECAST" value={<>{fmtBounded(next6h).replace(' (upper bound excluded)','')}{next6h?.upperExclusive&&next6h.min>0&&<small className="overview-bound-note">Upper bound excluded</small>}</>} detail={next6h === null ? (errors.forecast ? "Forecast API unavailable" : "Next 6h: missing or unsupported KMA rainfall intervals") : "Rain expected · next 6 hours"} />
      <Kpi title="NATIONAL WARNINGS" value={official?.status==='Current'?official.data?.length??0:"—"} detail={official?.status==='Current'?"Official weather warnings · all types":"Warning feed reconnecting"} />
    </div>
    <div className="grid-main">
      <section className="card trend-panel"><div className="panel-title"><div><h3>River level trend</h3><p className="muted">{riverName} · measured water-level history</p></div><span className="overview-period">Last 24 hours</span></div>
        <RiverAreaChart readings={sortedHistory} />
        {errors.history && <p className="muted">River history: {errors.history}</p>}
        <p className="muted" style={{fontSize:12}}>Measured water levels · KST</p>
      </section>
      <div className="stack">
        <section className="card changes-panel"><h3>Recent conditions</h3>
          <ul className="status-list">
            <li><i className="status-dot blue" />Rainfall ({awsHourly !== null ? "AWS 1-hour observation" : "latest available 1h"}): <b>{fmt(rain1h)}</b></li>
            <li><i className="status-dot amber" />{riverName} water-level change: <b>{riverChangeText}</b></li>
            <li><i className="status-dot teal" />National warning status: <b>{official?.status||"Warning status unavailable"} · {official?.status==='Current'?official.data?.length:'—'} national warnings</b></li>
          </ul>
          <div className="current-weather"><p className="caps">CURRENT WEATHER</p><div className="row"><strong className="big">{metric(weatherLatest?.temperature, "°C", 1)}</strong><span className="muted">{englishStationName(weatherLatest?.station_name)||"Awaiting weather"}<br />Observed: {kst(weatherLatest?.observed_at)} KST</span></div></div>
        </section>
        <section className="card changes-panel"><h3>Ulsan rainfall forecast</h3><p className="muted">Expected rainfall · next 24 hours</p>
          <div className="overview-rain-grid">{[3,6,12,24].map(hours => <div className="overview-rain-item" key={hours}><span>Next {hours}h</span><strong>{fmtBounded(forecastPeriods[hours])}</strong></div>)}</div>
          <p className="muted" style={{fontSize:12}}>Forecasts may change as conditions develop.</p>
        </section>
      </div>
    </div>
    <p className="strip">Academic monitoring platform · Observations and experimental predictions are not official flood warnings.</p>
  </div>;
}
