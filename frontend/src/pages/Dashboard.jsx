import {riskColors} from '../lib/risk';
import { parseTime } from "../lib/time";
import { useEffect, useMemo, useState } from "react";
import { metric } from "../lib/format";

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
function RiverAreaChart({ readings }) {
  const points = [...readings].filter(r => Number.isFinite(timestamp(r.observed_at)) && num(r.water_level) !== null).sort((a,b) => timestamp(a.observed_at) - timestamp(b.observed_at)).slice(-24);
  if (points.length < 2) return <div className="chart-unavailable"><div className="chart-empty-message">Not enough historical observations for a trend.</div></div>;
  const values = points.map(r => num(r.water_level));
  const lo = Math.min(...values), hi = Math.max(...values), spread = Math.max(hi - lo, .1);
  const firstTime = timestamp(points[0].observed_at), duration = timestamp(points.at(-1).observed_at) - firstTime;
  const xy = values.map((v, i) => [12 + (timestamp(points[i].observed_at) - firstTime) * 596 / duration, 182 - ((v - lo + spread * .15) / (spread * 1.3)) * 160]);
  // Catmull-Rom to cubic Bezier: smooth but data-driven, no made-up points.
  const path = xy.reduce((d, p, i) => {
    if (i === 0) return `M${p[0]},${p[1]}`;
    const prev = xy[i-1];
    // Horizontal control points keep the smooth line inside measured extrema.
    const c1x = prev[0] + (p[0] - prev[0]) / 2;
    const c1y = prev[1];
    const c2x = c1x;
    const c2y = p[1];
    return `${d} C${c1x},${c1y} ${c2x},${c2y} ${p[0]},${p[1]}`;
  }, "");
  return <div className="original-area-chart">
    <svg viewBox="0 0 620 200" role="img" aria-label="Observed Taehwa Bridge river water level, smooth teal area chart" style={{width:"100%",height:"auto",display:"block"}}>
      <path d={`${path} L608,190 L12,190 Z`} fill="#bfece4" opacity=".48" />
      <path d={path} stroke="#087f8e" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="190" x2="608" y2="190" stroke="#d9e7e8" />
    </svg>
    <div className="chart-axis"><span>{kst(points[0].observed_at)} KST</span><span>Observed river level (m)</span><span>{kst(points.at(-1).observed_at)} KST</span></div>
  </div>;
}

async function getJson(path, signal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export default function Dashboard({ weather = [], ulsanId = null, riverId = null }) {
  const RIVER_ID = riverId;
  const [history, setHistory] = useState([]);
  const [monitoring,setMonitoring]=useState([]);
  const [official,setOfficial]=useState(null);
  const [alerts, setAlerts] = useState(null);
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
        ["alerts", "/api/alerts", setAlerts, data => data],
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
  const awsStationCode = weatherLatest?.aws_station_code;
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
  const summary=monitoring.find(s=>String(s.station_id)===String(RIVER_ID));
  const riskLevel=summary?.risk_level||'No risk data';
  const riskScore=num(summary?.risk_score);
  const verified=summary?.prediction?.status==='ML_STAGE';
  const rain1h = awsHourly ?? num(combined?.weather?.rainfall_1h);
  const rainfallShown = rainfall6h !== null ? rainfall6h : awsHourly;
  const rainfallDetail = rainfall6h !== null
    ? `Last 6 hours · ${rainStation?.station_name || rainStation || "KMA Ulsan"}`
    : awsHourly !== null
      ? `AWS 1-hour reading · station ${awsStationCode || "unknown"} · ${kst(weatherLatest?.aws_observed_at)} KST (6h total unavailable)`
      : "6h total unavailable; recent AWS 1h reading unavailable";
  const riverChangeText = threeHourChange === null ? "3-hour change unavailable" : `${threeHourChange >= 0 ? "+" : ""}${threeHourChange.toFixed(2)} m / 3h`;

  return <div className="design-overview">
    <section className="card hero-card">
      <div className="hero-copy"><p className="caps">CURRENT FLOOD RISK</p><h2 style={{color:riskColors[riskLevel]||'#6b7280'}}>{riskLevel}</h2><p>Threshold verification: {summary?.threshold_verification||'Not Verified'}</p>
        <p className="muted">{verified ? "Experimental next-hour ML stage classification; not an official warning." : summary?.prediction?.reason || "No trained risk model or current station data."}</p>
      </div>
      <div className="score-box"><span>RISK SCORE</span><strong>{riskScore ?? "—"}</strong><small>{riskScore === null ? "Not calculated" : "ML stage score · 0–100"}</small></div>
    </section>
    <section className="card" style={{marginTop:16,marginBottom:16}}>
      <p className="caps">EXPERIMENTAL RIVER-CONDITION ASSESSMENT · TAEHWA BRIDGE</p>
      {errors.combined ? <p className="muted">Assessment unavailable: {errors.combined}</p> : (() => {
        const assessment = combined?.assessment?.experimental_risk;
        const classification = assessment?.condition_classification;
        const label = classification?.level?.replaceAll('_',' ') || 'No data';
        const status = classification?.status || 'UNAVAILABLE';
        return <>
          <h3 style={{margin:'8px 0'}}>{label}</h3>
          <p className="muted">{classification?.message || 'Awaiting sufficient recent river and rainfall observations.'}</p>
          <p className="muted">Status: {status} · Validation: {classification?.validation_status || 'NOT_VALIDATED'} · Latest river reading: {kst(assessment?.observed_at)} KST</p>
          <p className="muted">Observed 3-hour change: {fmt(assessment?.indicators?.recent_river_changes_m?.['3h'], 'm', 2)} · Observed 3-hour rainfall: {fmt(assessment?.indicators?.observed_rainfall?.rainfall_3h_mm)}</p>
          <p className="muted" style={{fontSize:12}}>Descriptive conditions only. Not a validated flood-risk level, official flood stage, or issued warning.</p>
        </>;
      })()}
    </section>
    <div className="grid4">
      <Kpi title="WATER LEVEL" value={fmt(riverLatest?.water_level, "m", 2)} detail={riverLatest ? `Taehwa Bridge · ${riverChangeText} · ${kst(riverLatest.observed_at)} KST` : errors.history || (RIVER_ID ? "Taehwa Bridge observation unavailable (no readings stored yet)" : "Taehwa Bridge gauge (code 2201670) not found in stations table")} />
      <Kpi title="RAINFALL" value={fmt(rainfallShown)} detail={rainfallDetail} />
      <Kpi title="FORECAST" value={fmtBounded(next6h)} detail={next6h === null ? (errors.forecast ? "Forecast API unavailable" : "Next 6h: missing or unsupported KMA rainfall intervals") : "Next 6 hours · KMA forecast · range, not an exact total when bounded"} />
      <Kpi title="ACTIVE ALERTS" value={errors.alerts ? "—" : alerts?.count ?? "—"} detail={errors.alerts || "Stored project alerts · automatic generation not enabled"} />
    </div>
    <div className="grid-main">
      <section className="card trend-panel"><div className="panel-title"><h3>River level trend</h3><p className="muted">Observed Taehwa Bridge levels · original teal area-chart design</p></div>
        <RiverAreaChart readings={sortedHistory} />
        {errors.history && <p className="muted">River history: {errors.history}</p>}
        <p className="muted" style={{fontSize:12}}>This chart displays measured water levels, not a calculated risk trend. Risk-history scores require a validated model.</p>
      </section>
      <div className="stack">
        <section className="card changes-panel"><h3>What changed?</h3>
          <ul className="status-list">
            <li><i className="status-dot blue" />Rainfall ({awsHourly !== null ? "AWS 1-hour observation" : "latest available 1h"}): <b>{fmt(rain1h)}</b></li>
            <li><i className="status-dot amber" />Taehwa Bridge water-level change: <b>{riverChangeText}</b></li>
            <li><i className="status-dot teal" />Official alert status: <b>{official?.status||"No official feed data"} · {official?.status==='Current'?official.data?.length:'—'} national warnings</b></li>
          </ul>
          <div className="current-weather"><p className="caps">CURRENT WEATHER</p><div className="row"><strong className="big">{metric(weatherLatest?.temperature, "°C", 1)}</strong><span className="muted">{weatherLatest?.station_name || "KMA observation unavailable"}<br />Observed: {kst(weatherLatest?.observed_at)} KST</span></div></div>
        </section>
        <section className="card changes-panel"><h3>Ulsan rainfall forecast</h3><p className="notice">KMA rainfall reference: {combined?.rainfall_reference?.status?.replaceAll("_", " ") || "No data"}. This comparison is not an issued warning.</p><p className="muted">KMA short-term forecast · next 3, 6, 12 and 24 hours</p>
          <div className="overview-rain-grid">{[3,6,12,24].map(hours => <div className="overview-rain-item" key={hours}><span>Next {hours}h</span><strong>{fmtBounded(forecastPeriods[hours])}</strong></div>)}</div>
          <p className="muted" style={{fontSize:12}}>Forecast bounds use official KMA hourly categories; exact amounts and bounded ranges are distinguished. Missing hours remain unavailable.</p>
        </section>
      </div>
    </div>
    <p className="strip">Academic monitoring platform · Observations and experimental predictions are not official flood warnings.</p>
  </div>;
}
