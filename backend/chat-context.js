'use strict';

// Keep the assistant's evidence small, current, and strictly source-backed.
// No personal alert subscriptions, email addresses or passwords enter the prompt.
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { dateRange } = require('./monitoring-store');
const catalog=require('./river-network-registry').getCatalog();
const {englishStationName,englishRiverName}=require('./display-names');

const MAX_STATIONS = 5;
const HOUR_MS = 3600000;

function timeRequest(question, now = new Date()) {
  const today = new Date(now.getTime() + 9 * HOUR_MS).toISOString().slice(0, 10);
  const explicit = String(question).match(/\b\d{4}-\d{2}-\d{2}\b/);
  const date = explicit?.[0] || (/\byesterday\b|어제/i.test(question)
    ? new Date(now.getTime() + 9 * HOUR_MS - 86400000).toISOString().slice(0, 10)
    : /tomorrow|내일/i.test(question)?new Date(now.getTime()+9*HOUR_MS+86400000).toISOString().slice(0,10):today);
  dateRange({ start: date, end: date }); // Reject impossible dates.
  const ampm = String(question).match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  const clock = String(question).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const hour = ampm ? Number(ampm[1]) % 12 + (ampm[3].toLowerCase() === 'pm' ? 12 : 0)
    : clock ? Number(clock[1]) : null;
  const minute = ampm ? ampm[2] || '00' : clock ? clock[2] : '00';
  return {
    date, hour,
    at: hour === null ? null : `${date} ${String(hour).padStart(2, '0')}:${minute}:00`,
    timezone: 'Asia/Seoul',
    explicit: !!explicit || /today|tomorrow|yesterday|오늘|어제|\bam\b|\bpm\b/i.test(question) || !!clock
  };
}

function bareNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickStationIds(question, explicitId, previous, stations, riverLinks) {
  const all = [String(question || ''), ...(previous || []).filter(m => m.role === 'user').slice(-3).map(m => m.content)];
  if (explicitId != null && String(explicitId).trim()) {
    const selected = stations.find(s => String(s.station_id) === String(explicitId));
    return selected ? [selected.station_id] : [];
  }
  const find = text => {
    const lower = text.toLocaleLowerCase();
    const weatherOnly=/weather|temperature|rain|forecast/i.test(text)&&!/river|water level|flood/i.test(text);
    const candidates=weatherOnly&&!/bridge|gauge|dam|river/i.test(text)?stations.filter(s=>s.data_source==='KMA'):stations;
    const direct = candidates.filter(s =>
      lower.includes(englishStationName(s.station_name,s.external_station_id).toLowerCase()) ||
      lower.includes(String(s.station_name).toLocaleLowerCase()) ||
      new RegExp(`\\bstation\\s*(?:id\\s*)?#?${s.station_id}\\b`, 'i').test(text) ||
      (s.external_station_id && new RegExp(`\\b${s.external_station_id}\\b`).test(text))
    );
    if(direct.length)return direct;
    const matchingRivers = catalog.filter(r => [r.name_ko, englishRiverName(r.name_en,r.name_ko), r.name_en, r.name_en?.replace(/\s+(river|stream)$/i, '')]
      .filter(Boolean).some(name => name.length > 2 && lower.includes(name.toLocaleLowerCase())));
    const matches = new Set(direct.map(s => String(s.station_id)));
    for (const r of matchingRivers) {
      for (const link of riverLinks) if (link.river_id === r.river_id) matches.add(String(link.station_id));
    }
    if (/\bulsan\b|울산/i.test(text) && !matches.size) {
      for (const s of stations) if (s.data_source === 'KMA' && /ulsan|울산/i.test(s.station_name)) matches.add(String(s.station_id));
    }
    if(!matches.size){const candidates=require('./place-resolver').resolvePlaces(text,stations);if(candidates[0]?.confidence>=0.75&&(!candidates[1]||candidates[0].confidence-candidates[1].confidence>0.05))matches.add(String(candidates[0].station_id));}
    return stations.filter(s => matches.has(String(s.station_id)));
  };
  for (const q of all) {
    const match = find(q);
    if (match.length) return match.slice(0, MAX_STATIONS).map(s => s.station_id);
  }
  return [];
}

async function optionalSelect(db, sql, params, context, label) {
  try {
    const [records] = await db.execute(sql, params);
    return records;
  } catch (err) {
    context.unavailable_sources.push(`${label}: ${err.code || 'QUERY_FAILED'}`);
    return [];
  }
}

function loadModelEvaluation(station) {
  const reportPath = path.join(__dirname, 'reports', 'all-river-ml-validation.json');
  try {
    const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const match = raw.reports?.find(row => Number(row.station_id) === Number(station.station_id) &&
      String(row.wamis_code) === String(station.external_station_id));
    if (!match) return null;
    return {
      evaluated_at: raw.generated_at || null,
      model: 'EXPERIMENTAL_WATER_LEVEL_RIDGE',
      status: match.status,
      test_windows: match.test_windows ?? null,
      ridge_mae_m: match.ridge?.mae_m ?? null,
      persistence_mae_m: match.baseline?.mae_m ?? null,
      improvement_percent: match.improvement_percent ?? null,
      official_flood_validation: false
    };
  } catch { return null; }
}

async function buildContext(question, stationId, previous = [], db = pool) {
  const temporal = timeRequest(question);
  const context = {
    project: {
      name: 'Weather and Flood Risk Forecasting',
      type: 'Educational prototype; not an official warning service',
      backend: 'Node.js/Express and MySQL', frontend: 'React/Vite and MapLibre',
      observed_weather_source: 'Korea Meteorological Administration (KMA)',
      observed_river_source: 'WAMIS',
      water_level_ml: 'One-hour experimental Ridge regression or persistence; forecasts are not flood probabilities',
      flood_prediction_note: 'Only report a flood-event probability if a verified event-label model actually supplied one',
      official_warnings_note: 'Issued government warnings are separate from project risk assessments'
    },
    retrieved_at: new Date().toISOString(),
    timezone: 'Asia/Seoul', requested_time: temporal,
    unavailable_sources: [], selected_station_ids: [], stations: [],
    selection_note: '', official_alerts: null
  };

  let stations = await optionalSelect(db,
    'SELECT station_id, station_name, external_station_id, data_source,latitude,longitude FROM stations ORDER BY station_name LIMIT 1500',
    [], context, 'station_catalog');
  if(db===pool)stations=await require('./official-station-policy').publicStations(stations);
  const links = await optionalSelect(db,
    "SELECT river_id,station_id FROM river_gauge_links WHERE verification_status='VERIFIED'",
    [], context, 'verified_river_links');
  const catalogAvailable = !context.unavailable_sources.some(source => source.startsWith('station_catalog:'));
  const riverLinksAvailable = !context.unavailable_sources.some(source => source.startsWith('verified_river_links:'));
  context.network = {
    station_count_in_catalog: catalogAvailable ? stations.length : null,
    linked_verified_gauges: riverLinksAvailable ? new Set(links.map(l => String(l.station_id))).size : null,
    monitored_rivers: riverLinksAvailable ? new Set(links.map(l => l.river_id)).size : null,
    catalog_limited_to: 1500
  };

  const allIds = pickStationIds(question, stationId, previous, stations, links);
  context.selected_station_ids = allIds;
  context.selection_note = allIds.length ?
    'Records are limited to matched/selected stations. No other station is implicitly represented.' :
    'No particular station was matched. Ask the user for a location or gauge for local measurements; do not assume conditions elsewhere.';

  const requestedExact = temporal.at;
  const requestedBounds = dateRange({ start: temporal.date, end: temporal.date });
  for (const id of allIds) {
    const s = stations.find(s => String(s.station_id) === String(id));
    if (!s) continue;
    const entry = {
      station_id: s.station_id, station_name: englishStationName(s.station_name,s.external_station_id),
      external_station_id: s.external_station_id, source: s.data_source,
      latest_water: [], latest_weather: [], latest_rainfall: [],
      latest_prediction: [], weather_forecasts: [],
      observations_at_requested_time: null, validated_thresholds: null,
      water_level_model_evaluation: loadModelEvaluation(s)
    };

    entry.latest_water = await optionalSelect(db,
      'SELECT observed_at,water_level,flow_rate FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 2',
      [id], context, `water_${id}`);
    const nearby=s.data_source==='KMA'?null:require('./geo').nearest(s,stations.filter(x=>x.data_source==='KMA'));const weatherId=s.data_source==='KMA'?id:nearby?.station_id;
    entry.nearby_weather_station=nearby?{station_name:englishStationName(nearby.station_name),distance_km:nearby.distance_km}:null;
    entry.latest_weather = await optionalSelect(db,
      'SELECT observed_at,temperature,humidity,wind_speed,hourly_rainfall,rainfall FROM weather_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 2',
      [weatherId||id], context, `weather_${id}`);

    const rainLink = await optionalSelect(db,
      "SELECT aws_station_code FROM station_rainfall_links WHERE station_id=? AND verification_status IN ('VERIFIED','AUTO_NEAREST') LIMIT 1",
      [id], context, `rainfall_link_${id}`);
    const awsCode = rainLink[0]?.aws_station_code || (s.data_source === 'KMA' ? s.external_station_id : null);
    if (awsCode) {
      entry.latest_rainfall = await optionalSelect(db,
        'SELECT observed_at,hourly_rainfall,daily_rainfall FROM aws_rainfall_readings WHERE aws_station_code=? ORDER BY observed_at DESC LIMIT 8',
        [String(awsCode)], context, `aws_${id}`);
      entry.rainfall_source = { provider: 'KMA AWS', station_code: String(awsCode),
        verified_mapping: !!rainLink.length || s.data_source === 'KMA' };
    }
    entry.latest_prediction = await optionalSelect(db,
      'SELECT observed_at,valid_at,generated_at,model_version,predicted_water_level,risk_score,risk_level,status,reason FROM prediction_history WHERE station_id=? ORDER BY prediction_id DESC LIMIT 2',
      [id], context, `prediction_${id}`);
    entry.weather_forecasts = weatherId ? await optionalSelect(db,
      'SELECT issued_at,valid_at,rainfall_forecast,temperature_forecast,precipitation_probability,source FROM weather_forecasts WHERE station_id=? AND issued_at=(SELECT MAX(issued_at) FROM weather_forecasts WHERE station_id=?) ORDER BY valid_at LIMIT 48',
      [weatherId, weatherId], context, `forecast_${id}`) : [];

    if(weatherId&&/forecast|tomorrow|next|week|weather/i.test(question)){try{entry.weekly_forecast=await require('./weekly-weather').weekly(weatherId);}catch{context.unavailable_sources.push('weekly_forecast: UNAVAILABLE');}}
    const thresholds = await optionalSelect(db,
      'SELECT interest_level_m,caution_level_m,alert_level_m,severe_level_m,advisory_level_m,warning_level_m,verification_status,verified_at,source_url FROM flood_thresholds WHERE station_id=? LIMIT 1',
      [id], context, `thresholds_${id}`);
    const threshold = thresholds[0];
    entry.validated_thresholds = threshold?.verification_status === 'VERIFIED' && threshold.source_url && threshold.verified_at ? threshold : null;
    entry.threshold_status = entry.validated_thresholds ? 'DOCUMENTED_VERIFIED' : 'UNVERIFIED_OR_UNAVAILABLE';

    if (requestedExact) {
      const [waterAt, weatherAt, rainAt, forecastAt] = await Promise.all([
        optionalSelect(db, 'SELECT observed_at,water_level FROM water_readings WHERE station_id=? AND observed_at=? LIMIT 1', [id, requestedExact], context, `water_at_${id}`),
        optionalSelect(db, 'SELECT observed_at,temperature,hourly_rainfall FROM weather_readings WHERE station_id=? AND observed_at=? LIMIT 1', [weatherId||id, requestedExact], context, `weather_at_${id}`),
        awsCode ? optionalSelect(db, 'SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=? AND observed_at=? LIMIT 1', [String(awsCode), requestedExact], context, `aws_at_${id}`) : Promise.resolve([]),
        s.data_source === 'KMA' ? optionalSelect(db, 'SELECT issued_at,valid_at,rainfall_forecast,temperature_forecast,source FROM weather_forecasts WHERE station_id=? AND valid_at=? ORDER BY issued_at DESC LIMIT 1', [id, requestedExact], context, `forecast_at_${id}`) : Promise.resolve([])
      ]);
      entry.observations_at_requested_time = { time: requestedExact,
        water: waterAt[0] || null, weather: weatherAt[0] || null,
        aws: rainAt[0] || null, weather_forecast: forecastAt[0] || null };
    } else if (temporal.explicit && temporal.date !== new Date(Date.now() + 9 * HOUR_MS).toISOString().slice(0, 10)) {
      entry.selected_date_water = await optionalSelect(db,
        'SELECT observed_at,water_level FROM water_readings WHERE station_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at ASC LIMIT 25',
        [id, ...requestedBounds], context, `water_date_${id}`);
      entry.selected_date_weather = await optionalSelect(db,
        'SELECT observed_at,temperature,hourly_rainfall FROM weather_readings WHERE station_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at ASC LIMIT 25',
        [id, ...requestedBounds], context, `weather_date_${id}`);
    }
    if((temporal.explicit||/history|historical/i.test(question))&&temporal.date<=new Date(Date.now()+9*HOUR_MS).toISOString().slice(0,10)){entry.historical_water=await optionalSelect(db,'SELECT COUNT(*) AS samples,MIN(water_level) AS minimum,MAX(water_level) AS maximum,AVG(water_level) AS average FROM water_readings WHERE station_id=? AND observed_at BETWEEN ? AND ?',[id,...requestedBounds],context,'historical_water');entry.historical_weather=await optionalSelect(db,'SELECT COUNT(*) AS samples,MIN(temperature) AS minimum,MAX(temperature) AS maximum,AVG(temperature) AS average FROM weather_readings WHERE station_id=? AND observed_at BETWEEN ? AND ?',[weatherId||id,...requestedBounds],context,'historical_weather');}
    // Preserve true zero as a valid observation; never replace missing data with zero.
    entry.latest_water = entry.latest_water.map(r => ({ ...r, water_level: bareNumber(r.water_level) }));
    if(db===pool){try{entry.unified_risk=(await require('./risk-engine').getUnified()).find(r=>String(r.station_id)===String(id))||null;}catch{context.unavailable_sources.push('unified_risk: QUERY_FAILED');}}
    context.stations.push(entry);
  }

  try {
    const official = await require('./official-alerts').latestOfficialAlerts(db);
    context.official_alerts = { status: official.status, fetched_at: official.fetched_at || null,
      source: official.source, data: (official.data || []).slice(0, 15),
      truncated: (official.data || []).length > 15 };
  } catch (err) {
    context.unavailable_sources.push(`official_alerts: ${err.code || 'QUERY_FAILED'}`);
    context.official_alerts = { status: 'UNAVAILABLE', data: [] };
  }
  return context;
}

module.exports = { timeRequest, buildContext, pickStationIds };
