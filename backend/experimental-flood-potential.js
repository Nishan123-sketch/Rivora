'use strict';
// Evidence-led monitoring, not a trained flood-event model or official warning.
// Nearby KMA observations are explicitly regional proxies, NEVER gauge-specific rain.
const {kstTime} = require('./verified-risk-evidence');
const CACHE_MS = 10 * 60 * 1000;
const HOUR = 3600000;
let cache = null;
let inFlight = null;
const numeric = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (value, digits=2) => Number(value.toFixed(digits));
function kstString(ms) { return new Date(ms + 9*HOUR).toISOString().slice(0,19).replace('T',' '); }
function distanceKm(a,b,c,d) {
  const vals=[a,b,c,d].map(numeric);
  if(vals.some(x=>x===null))return Infinity;
  const [lat1,lon1,lat2,lon2]=vals.map(x=>x*Math.PI/180);
  const deltaLat=lat2-lat1,deltaLon=lon2-lon1;
  const x=Math.sin(deltaLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(deltaLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function rainfallContext(station,weather,now) {
  if(!station) return {status:'UNAVAILABLE',reason:'NO_LOCATION_MATCHED_KMA_STATION'};
  // Rainfall values must be actual non-null, non-negative hourly readings. Gaps are unknown, not 0.
  const byHour = new Map();
  // Prefer exact ASOS hourly observations; use AWS hourly measurements only
  // when the KMA station's external ID matches the AWS station code exactly.
  // A missing value is never treated as zero, and daily totals are NOT hourly.
  for(const row of weather){
    const ms=kstTime(row.observed_at), mm=numeric(row.rainfall);
    if(!Number.isFinite(ms)||ms>now||mm===null||mm<0)continue;
    const key=Math.floor(ms/HOUR);
    const source=row.rain_source==='KMA_AWS_SAME_STATION'?'KMA_AWS_SAME_STATION':'KMA_ASOS';
    if(!byHour.has(key)||source==='KMA_ASOS')byHour.set(key,{mm,source});
  }
  const lastHour=Math.floor(now/HOUR)-1;
  const aggregate = hours => {
    let total=0,count=0;const sources=new Set();
    for(let h=lastHour-hours+1;h<=lastHour;h++){
      if(byHour.has(h)){count++;total+=byHour.get(h).mm;sources.add(byHour.get(h).source);}
    }
    return {hours,available_hours:count,expected_hours:hours,status:count===hours?'COMPLETE':'INCOMPLETE',rainfall_mm:count===hours?round(total):null,measurement_sources:[...sources]};
  };
  return {status:'REGIONAL_PROXY_NOT_CATCHMENT_RAINFALL',station_id:station.station_id,
    station_name:station.station_name,distance_km:round(station.distance_km,1),
    observed_3h:aggregate(3),observed_6h:aggregate(6),
    observed_12h:aggregate(12),observed_24h:aggregate(24),
    caveat:'Nearby KMA ASOS/AWS point rainfall is regional context only, not verified upstream catchment rainfall. AWS fallback only shares the same station code. Missing hours are never treated as dry.'};
}

// KMA village-forecast rainfall is an *issued forecast*, not a future observation.
// Numeric categories may be ranges; use the minimum and maximum, never a made-up midpoint.
function forecastRainContext(station, rows, now) {
  const base = {status:'UNAVAILABLE',hours:6,expected_hours:6,available_hours:0,
    rainfall_min_mm:null,rainfall_max_mm:null,issued_at:null,
    source:'KMA_VILAGE_FCST_REGIONAL_PROXY',
    caveat:'KMA forecast for a nearby station is NOT a verified catchment-wide rainfall forecast.'};
  if(!station) return {...base,reason:'NO_NEARBY_KMA_STATION'};
  const byValidHour = new Map();
  const ceilingHour = Math.floor(now/HOUR)*HOUR+HOUR;
  for (const row of rows || []) {
    const issued=kstTime(row.issued_at), valid=kstTime(row.valid_at);
    if(!Number.isFinite(issued)||!Number.isFinite(valid)||issued>now||
      issued<now-24*HOUR||valid<ceilingHour||valid>=ceilingHour+6*HOUR||
      (valid-ceilingHour)%HOUR!==0)continue;
    const exact=numeric(row.rainfall_forecast),low=numeric(row.precipitation_min_mm),
      high=numeric(row.precipitation_max_mm);
    let minimum=null,maximum=null;
    if(exact!==null&&exact>=0){minimum=exact;maximum=exact;}
    else if(low!==null&&high!==null&&low>=0&&high>=low){minimum=low;maximum=high;}
    if(minimum===null)continue;
    const previous=byValidHour.get(valid);
    if(!previous||issued>previous.issued){
      byValidHour.set(valid,{issued,minimum,maximum});
    }
  }
  const results=[];
  for(let hour=0;hour<6;hour++){
    const value=byValidHour.get(ceilingHour+hour*HOUR);
    if(value)results.push(value);
  }
  if(results.length!==6)return {...base,status:'INCOMPLETE',available_hours:results.length,
    reason:'FORECAST_HOURLY_COVERAGE_INCOMPLETE'};
  const min=results.reduce((s,r)=>s+r.minimum,0);
  const max=results.reduce((s,r)=>s+r.maximum,0);
  const newest=Math.max(...results.map(r=>r.issued));
  return {...base,status:'COMPLETE',available_hours:6,
    rainfall_min_mm:round(min),rainfall_max_mm:round(max),
    issued_at:kstString(newest),reason:null};
}

function assess(gauge, screening, rainfall, forecastRainfall = null) {
  const base = {station_id:Number(gauge.station_id),wamis_code:String(gauge.wamis_code||''),status:'UNAVAILABLE',
    category:null,classification_type:'EXPERIMENTAL_FLOOD_POTENTIAL_INDICATORS_V1',
    is_official_warning:false,official_flood_risk:gauge.risk_level ?? null,
    official_risk_basis:gauge.risk_basis ?? null,flood_probability:null,
    validation_status:'NOT_VALIDATED_AGAINST_FLOOD_EVENTS',
    observed_at:gauge.observed_at ?? null,water_level_m:numeric(gauge.water_level_m),
    observed_conditions:gauge.observed_conditions ?? null,
    level_screening:screening?.status==='EXPERIMENTAL_SCREENING'?screening:null,
    regional_rainfall:rainfall,forecast_rainfall:forecastRainfall,
    limitations:'This is evidence-based monitoring, not a calibrated flood-risk probability, safety rating or official flood warning.'};
  if(gauge.observation_status!=='FRESH')return {...base,reason:'WATER_LEVEL_NOT_FRESH'};
  if(screening?.status!=='EXPERIMENTAL_SCREENING')return {...base,reason:screening?.reason||'INSUFFICIENT_LEVEL_HISTORY'};
  const trend=numeric(gauge.observed_conditions?.previous_hour_change_m);
  const high=screening.screening_level==='UNUSUALLY_HIGH_RELATIVE_LEVEL';
  const elevated=screening.screening_level==='ELEVATED_RELATIVE_LEVEL';
  const rising=trend!==null&&trend>0;
  // Require complete rainfall windows before treating rainfall as evidence.
  const rain6=rainfall?.observed_6h?.status==='COMPLETE'?rainfall.observed_6h.rainfall_mm:null;
  const rain24=rainfall?.observed_24h?.status==='COMPLETE'?rainfall.observed_24h.rainfall_mm:null;
  const rainPresent=rain6!==null&&rain6>0||rain24!==null&&rain24>0;
  // Descriptive categories, NOT trained thresholds or flood-event severity.
  const category=high&&(rising||rainPresent)?'MULTIPLE_ELEVATED_INDICATORS':
    high||elevated&&(rising||rainPresent)?'ELEVATED_INDICATORS':
    elevated||rising&&rainPresent?'SOME_ELEVATED_INDICATORS':'NO_ELEVATED_INDICATORS_DETECTED';
  const signals=[];
  if(high)signals.push('ABOVE_STATION_HISTORICAL_P95');
  else if(elevated)signals.push('ABOVE_STATION_HISTORICAL_P90');
  if(rising)signals.push('WATER_LEVEL_RISING_LAST_HOUR');
  if(rainPresent)signals.push('REGIONAL_KMA_RAINFALL_OBSERVED');
  return {...base,status:'EXPERIMENTAL_INDICATORS',category,signals,
    limitations:'Non-validated heuristic indicators only. No elevated indicators does NOT mean low flood risk or safety; KMA rainfall is a nearby regional proxy.'};
}
async function calculate(db, now=Date.now(), loadScreening) {
  const [{getAssessments}, {getScreening}] = [require('./verified-risk-evidence'),require('./experimental-gauge-screening')];
  const [gauges,screeningResult,geoResult,metResult] = await Promise.all([
    getAssessments(db,now),(loadScreening||getScreening)(db),
    db.query(`SELECT station_id, station_name, latitude, longitude, data_source, external_station_id
      FROM stations WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND data_source IN ('KMA','RIVER_GAUGE')`),
    db.execute(`SELECT station_id, DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at, rainfall
      FROM weather_readings WHERE observed_at >= ? AND observed_at <= ? AND rainfall IS NOT NULL`,
      [kstString(now-26*HOUR),kstString(now)])
  ]);
  const geometry=new Map(geoResult[0].map(x=>[String(x.station_id),x]));
  const weatherStations=geoResult[0].filter(x=>x.data_source==='KMA');
  const rainByStation=new Map();
  for(const row of metResult[0]){
    const id=String(row.station_id);
    if(!rainByStation.has(id))rainByStation.set(id,[]);
    rainByStation.get(id).push({...row,rain_source:'KMA_ASOS'});
  }
  // Optional AWS enhancement; the historical weather table alone can be incomplete.
  // The AWS table is never required to keep the flood-potential endpoint working.
  let awsFallbackAvailable=true;
  try{
    const [awsRows]=await db.execute(`SELECT aws_station_code,
      DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at, hourly_rainfall
      FROM aws_rainfall_readings
      WHERE observed_at >= ? AND observed_at <= ? AND hourly_rainfall IS NOT NULL`,
      [kstString(now-26*HOUR),kstString(now)]);
    const stationByProviderCode=new Map();
    for(const station of weatherStations){
      const code=String(station.external_station_id||'');
      if(/^\d+$/.test(code)){
        if(!stationByProviderCode.has(code))stationByProviderCode.set(code,[]);
        stationByProviderCode.get(code).push(String(station.station_id));
      }
    }
    for(const row of awsRows){
      const ids=stationByProviderCode.get(String(row.aws_station_code))||[];
      for(const id of ids){
        if(!rainByStation.has(id))rainByStation.set(id,[]);
        rainByStation.get(id).push({observed_at:row.observed_at,
          rainfall:row.hourly_rainfall,rain_source:'KMA_AWS_SAME_STATION'});
      }
    }
  }catch(error){
    awsFallbackAvailable=false;
    // Absence of AWS measurements leaves those hours UNKNOWN, not dry.
    console.warn('[Flood potential] Optional AWS hourly fallback unavailable:',error.code||error.message);
  }
  // Optional future rain, based strictly on KMA forecasts issued BEFORE the
  // assessment time. If the source is absent/old we keep it unavailable.
  const futureRainByStation=new Map();
  let forecastRainAvailable=true;
  try {
    const stationIds=weatherStations.map(x=>x.station_id);
    if(stationIds.length===0)throw new Error('NO_NEARBY_KMA_STATION_METADATA');
    const stationPlaceholders=stationIds.map(() => '?').join(',');
    const [fcstRows]=await db.execute(`SELECT station_id,
      DATE_FORMAT(issued_at,'%Y-%m-%d %H:%i:%s') AS issued_at,
      DATE_FORMAT(valid_at,'%Y-%m-%d %H:%i:%s') AS valid_at,
      rainfall_forecast,precipitation_min_mm,precipitation_max_mm
      FROM weather_forecasts WHERE source='KMA_VILAGE_FCST'
      AND station_id IN (${stationPlaceholders})
      AND issued_at>=? AND issued_at<=? AND valid_at>=? AND valid_at<=?`,
      [...stationIds,kstString(now-24*HOUR),kstString(now),kstString(Math.floor(now/HOUR)*HOUR+HOUR),
        kstString(Math.floor(now/HOUR)*HOUR+7*HOUR)]);
    for(const f of fcstRows){
      const key=String(f.station_id);
      if(!futureRainByStation.has(key))futureRainByStation.set(key,[]);
      futureRainByStation.get(key).push(f);
    }
  } catch(error) {
    forecastRainAvailable=false;
    console.warn('[Flood potential] Optional KMA forecast rainfall unavailable:',error.code||error.message);
  }
  const screenings=new Map((screeningResult.data||[]).map(x=>[String(x.station_id),x]));
  const data=gauges.map(g=>{
    const geo=geometry.get(String(g.station_id));
    const candidates=[];
    if(geo)for(const kma of weatherStations){
      const km=distanceKm(geo.latitude,geo.longitude,kma.latitude,kma.longitude);
      if(km<=25)candidates.push({...kma,distance_km:km});
    }
    candidates.sort((a,b)=>a.distance_km-b.distance_km);
    // Prefer the closest station with both complete rain windows. If none
    // qualifies, choose the nearest actual KMA observation and mark gaps.
    const selected=candidates.find(k=>{
      const r=rainfallContext(k,rainByStation.get(String(k.station_id))||[],now);
      return r.observed_6h.status==='COMPLETE'&&r.observed_24h.status==='COMPLETE';
    })||candidates[0]||null;
    return assess(g,screenings.get(String(g.station_id)),
      rainfallContext(selected,selected?rainByStation.get(String(selected.station_id))||[]:[],now),
      forecastRainContext(selected,selected?futureRainByStation.get(String(selected.station_id))||[]:[],now));
  });
  return {success:true,generated_at:new Date(now).toISOString(),total_gauges:data.length,
    assessed_experimental:data.filter(x=>x.status==='EXPERIMENTAL_INDICATORS').length,
    unavailable:data.filter(x=>x.status!=='EXPERIMENTAL_INDICATORS').length,
    official_warning_coverage:'NOT_CHECKED',aws_same_station_fallback_available:awsFallbackAvailable,
    kma_forecast_rainfall_query_available:forecastRainAvailable,
    note:'Experimental monitoring indicators only; they are not official flood-risk levels or validated event predictions.',data};
}
async function getFloodPotential(db=require('./db')) {
  if(cache&&Date.now()-cache.at<CACHE_MS)return cache.value;
  if(!inFlight)inFlight=calculate(db).then(value=>{cache={at:Date.now(),value};return value;}).finally(()=>{inFlight=null;});
  return inFlight;
}
module.exports={assess,rainfallContext,forecastRainContext,distanceKm,calculate,getFloodPotential};
