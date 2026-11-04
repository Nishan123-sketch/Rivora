'use strict';

// Transparent data-only response when a conversational language model is offline.
// This is intentionally narrow. It cannot invent answers or replace an LLM.
const toNumber = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const numberText = (v, unit) => toNumber(v) == null ? 'not available' : `${toNumber(v)} ${unit}`;

function fresh(time) {
  const ms = Date.parse(String(time || '').replace(' ', 'T') + '+09:00');
  return Number.isFinite(ms) && Date.now() >= ms && Date.now() - ms <= 3 * 3600000;
}

function monitoringAnswer(question, context) {
  const q = question.toLowerCase();
  const projectQuestion = /what (is|does)|about (this|the) (project|system)|how (does|is).*(work|built)|features|technolog|architecture|data sources|source of data|project overview|what can you do|help|कसरी|परियोजना|프로젝트|시스템/i.test(q);
  const wantsRisk = /flood|risk|warning|alert|danger|safe|홍수|위험|경보/i.test(q);
  const wantsML = /model|ridge|machine learning|ml |accurac|prediction|forecast|예측/i.test(q);
  const wantsAll = /all rivers|how many|nationwide|network|total gauges|전체|몇 개/i.test(q);

  if (!context.stations.length) {
    const n = context.network || {};
    const introduction = `**Weather and Flood Risk Forecasting** is an educational monitoring prototype built with React, Express and MySQL. It uses KMA weather data and WAMIS water-level observations. Its current one-hour water-level forecasts are experimental or persistence-based, not official flood warnings.`;
    if (projectQuestion || wantsAll) {
      return `${introduction}\n\n**Available monitoring network (from the database):** ${n.monitored_rivers ?? 'unknown'} monitored rivers and ${n.linked_verified_gauges ?? 'unknown'} verified linked gauges. The network count reflects the current database, not proof of live data at every station.\n\n**What I can check:** River gauge readings, their observation times, weather observations, available KMA forecasts, historical model evaluations and the status of the official warning feed. Choose a station or mention its name for local conditions.\n\n*Data-only answer: connect a local Ollama model for more flexible conversation.*`;
    }
    if (wantsRisk) {
      return `I cannot identify a currently flooded or safe river without verifying station-specific thresholds and current official warnings. The database contains ${n.linked_verified_gauges ?? 'an unknown number of'} verified linked gauges, but that is **not** the same as verified flood-risk classification.\n\nChoose a river or station to inspect its actual water level and data freshness. For emergencies, follow the relevant Korean government flood-control authority.\n\n*Data-only answer; no live flood-event probability has been calculated.*`;
    }
    return `I can look up recorded Korean weather conditions, river levels, KMA rainfall and forecasts, and experimental prediction results.\n\n**Which city, river, or monitoring station would you like to check?** For example: "Taehwa Bridge water level" or "Ulsan rainfall".\n\n*My conversational language model is currently unavailable; this is a limited data-only response.*`;
  }

  const lines = [];
  for (const s of context.stations) {
    lines.push(`### ${s.station_name} (station ${s.station_id})`);
    lines.push(`**Source:** ${s.source}${s.external_station_id ? `, provider code ${s.external_station_id}` : ''}.`);
    if (context.requested_time?.at) {
      const e = s.observations_at_requested_time;
      lines.push(`**Requested time:** ${context.requested_time.at} KST.`);
      if (e?.water) lines.push(`- Observed water level: ${numberText(e.water.water_level, 'm')}.`);
      if (e?.weather) lines.push(`- Observed temperature: ${numberText(e.weather.temperature, '°C')}; observed hourly rain: ${numberText(e.weather.hourly_rainfall, 'mm')}.`);
      if (e?.aws) lines.push(`- KMA AWS hourly rainfall: ${numberText(e.aws.hourly_rainfall, 'mm')}.`);
      if (e?.weather_forecast) lines.push(`- KMA forecast issued ${e.weather_forecast.issued_at}: temperature ${numberText(e.weather_forecast.temperature_forecast, '°C')}, rainfall ${numberText(e.weather_forecast.rainfall_forecast, 'mm')}.`);
      if (!e?.water && !e?.weather && !e?.aws && !e?.weather_forecast) lines.push('- No observation or stored forecast matches that exact hour. I will not substitute a latest reading.');
      continue;
    }
    const water = s.latest_water?.[0];
    const weather = s.latest_weather?.[0];
    const rainfall = s.latest_rainfall?.[0];
    if (water) lines.push(`- **Water level:** ${numberText(water.water_level, 'm')} at ${water.observed_at} KST (${fresh(water.observed_at) ? 'fresh' : 'stale'}).`);
    else if (s.source === 'RIVER_GAUGE' || s.source === 'KWATER') lines.push('- **Water level:** no stored observation is available.');
    if (weather) lines.push(`- **Weather:** ${numberText(weather.temperature, '°C')} at ${weather.observed_at} KST; observed hourly rainfall ${numberText(weather.hourly_rainfall, 'mm')}.`);
    if (rainfall) lines.push(`- **KMA AWS rainfall:** ${numberText(rainfall.hourly_rainfall, 'mm')} for ${rainfall.observed_at} KST (${fresh(rainfall.observed_at) ? 'fresh' : 'stale'}).`);
    if (!water && !weather && !rainfall) lines.push('- No recent stored observations were returned.');
    const latestForecast = (s.weather_forecasts || []).find(f => {
      const t = Date.parse(String(f.valid_at).replace(' ', 'T') + '+09:00');
      return Number.isFinite(t) && t > Date.now();
    });
    if (latestForecast) lines.push(`- **Next stored KMA weather forecast:** ${latestForecast.valid_at} KST, temperature ${numberText(latestForecast.temperature_forecast, '°C')}, rainfall ${numberText(latestForecast.rainfall_forecast, 'mm')} (issued ${latestForecast.issued_at}).`);
    const predicted = s.latest_prediction?.find(p => p.predicted_water_level != null);
    if (predicted && wantsML) lines.push(`- **Stored experimental prediction:** ${numberText(predicted.predicted_water_level, 'm')} for ${predicted.valid_at} KST (${predicted.status}, ${predicted.model_version}). This may be a past forecast; check its validity time.`);
    if (wantsML && s.water_level_model_evaluation) {
      const ev = s.water_level_model_evaluation;
      lines.push(`- **Historical model backtest:** ${ev.status}; experimental Ridge MAE ${numberText(ev.ridge_mae_m, 'm')}, persistence MAE ${numberText(ev.persistence_mae_m, 'm')}; evaluated ${ev.evaluated_at || 'unknown date'}. Not validation of flood probabilities.`);
    }
    if (wantsRisk) lines.push(`- **Flood threshold:** ${s.threshold_status === 'DOCUMENTED_VERIFIED' ? 'Source-backed threshold record exists, but official warning issuance still requires a separate source.' : 'Unverified/unavailable. The measured level does not establish a flood-warning state.'}`);
  }
  if (wantsRisk) lines.push(`\n**Official warning feed:** ${context.official_alerts?.status || 'unavailable'}. Its status is not a statement that a warning has or has not been issued for this gauge. Experimental model output is not an official warning.`);
  if (context.unavailable_sources?.length) lines.push(`\nSome sources were unavailable: ${context.unavailable_sources.map(s => s.split(':')[0]).join(', ')}.`);
  lines.push('\n*Data-only response based on stored observations; for richer explanations, connect a language model.*');
  return lines.join('\n');
}

module.exports = { monitoringAnswer, fresh };
