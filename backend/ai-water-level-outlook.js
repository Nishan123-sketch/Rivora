'use strict';
// Transparent data-driven adaptation of Korea's multi-horizon river-level forecasting
// WORKFLOW, not Korea's proprietary AI model or an official flood-risk prediction.
const HOUR=3600000;
const HORIZONS=[1,3,6];
const LIMIT=4000;
const MIN_TRAIN=150;
const MIN_TEST=40;
const LAMBDA=5;
const CACHE_MS=60000;
const cache=new Map();
const inflight=new Map();
const finite=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const round=(v,n=3)=>Number(v.toFixed(n));
function parseKst(s){
  const x=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if(!x)return NaN;
  const [y,m,d,h,mi,se]=x.slice(1).map(Number);
  const t=Date.UTC(y,m-1,d,h-9,mi,se);
  const check=new Date(t+9*HOUR);
  return check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d&&check.getUTCHours()===h&&check.getUTCMinutes()===mi&&check.getUTCSeconds()===se?t:NaN;
}
function kstString(ms){return new Date(ms+9*HOUR).toISOString().slice(0,19).replace('T',' ');}
function distancesKm(lat1,lon1,lat2,lon2){
  if([lat1,lon1,lat2,lon2].some(x=>finite(x)===null))return Infinity;
  const p=Math.PI/180, dlat=(lat2-lat1)*p,dlon=(lon2-lon1)*p;
  const a=Math.sin(dlat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dlon/2)**2;
  return 6371*2*Math.asin(Math.min(1,Math.sqrt(a)));
}
function cleanReadings(input){
  const m=new Map();
  for(const r of input||[]){
    const t=parseKst(r.observed_at),level=finite(r.water_level);
    if(Number.isFinite(t)&&level!==null)m.set(t,level);
  }
  return [...m].sort((a,b)=>a[0]-b[0]).map(([time,level])=>({time,level}));
}
function cleanRain(input){
  const m=new Map();
  for(const r of input||[]){
    const t=parseKst(r.observed_at),mm=finite(r.rainfall);
    if(Number.isFinite(t)&&t%HOUR===0&&mm!==null&&mm>=0)m.set(t,mm);
  }
  return m;
}
function makeRows(levels,rainByTime=new Map(),horizon=1){
  const m=new Map(levels.map(r=>[r.time,r.level]));
  const samples=[];
  for(const r of levels){
    const t=r.time;
    const l1=m.get(t-HOUR),l3=m.get(t-3*HOUR),l6=m.get(t-6*HOUR),future=m.get(t+horizon*HOUR);
    if([l1,l3,l6,future].some(x=>x===undefined))continue;
    let rain6=0,completeRain=true;
    for(let h=0;h<6;h++){
      const v=rainByTime.get(t-h*HOUR);
      if(v===undefined){completeRain=false;break;}
      rain6+=v;
    }
    samples.push({t,level:r.level,features:[r.level-l1,r.level-l3,r.level-l6],
      rain6:completeRain?rain6:null,target:future-r.level,actual:future});
  }
  return samples;
}
function solve(matrix,vector){
  const n=vector.length,mat=matrix.map((r,i)=>[...r,vector[i]]);
  for(let c=0;c<n;c++){
    let pivot=c;
    for(let r=c+1;r<n;r++)if(Math.abs(mat[r][c])>Math.abs(mat[pivot][c]))pivot=r;
    if(Math.abs(mat[pivot][c])<1e-11)return null;
    [mat[c],mat[pivot]]=[mat[pivot],mat[c]];
    const div=mat[c][c];for(let k=c;k<=n;k++)mat[c][k]/=div;
    for(let r=0;r<n;r++)if(r!==c){const mult=mat[r][c];for(let k=c;k<=n;k++)mat[r][k]-=mult*mat[c][k];}
  }
  return mat.map(r=>r[n]);
}
function trainRidge(rows,useRain){
  const features=rows.map(r=>useRain?[...r.features,r.rain6]:r.features);
  const n=features[0].length;
  const means=Array.from({length:n},(_,i)=>features.reduce((s,r)=>s+r[i],0)/features.length);
  const scales=means.map((v,i)=>Math.sqrt(features.reduce((s,r)=>s+(r[i]-v)**2,0)/features.length)||1);
  const size=n+1,xtx=Array.from({length:size},()=>Array(size).fill(0)),xty=Array(size).fill(0);
  for(let i=0;i<rows.length;i++){
    const x=[1,...features[i].map((v,j)=>(v-means[j])/scales[j])];
    for(let j=0;j<size;j++){
      xty[j]+=x[j]*rows[i].target;
      for(let k=0;k<size;k++)xtx[j][k]+=x[j]*x[k];
    }
  }
  for(let i=1;i<size;i++)xtx[i][i]+=LAMBDA;
  const coef=solve(xtx,xty);
  return coef?{coef,means,scales,useRain}:null;
}
function modelChange(model,row){
  const features=model.useRain?[...row.features,row.rain6]:row.features;
  if(features.some(v=>v===null||v===undefined))return null;
  return model.coef[0]+features.reduce((sum,v,i)=>sum+model.coef[i+1]*(v-model.means[i])/model.scales[i],0);
}
function errors(pred,actual){
  const diff=pred.map((p,i)=>p-actual[i]);
  return {pairs:diff.length,mae_m:round(diff.reduce((s,v)=>s+Math.abs(v),0)/diff.length,4),
    rmse_m:round(Math.sqrt(diff.reduce((s,v)=>s+v*v,0)/diff.length),4)};
}
function regimeEvaluation(training,testing,model,chosen){
 const sorted=training.map(r=>r.level).sort((a,b)=>a-b),cut=sorted[Math.floor((sorted.length-1)*.9)];
 const groups={wet:testing.filter(r=>r.rain6!==null&&r.rain6>0),dry:testing.filter(r=>r.rain6===0),upper_training_decile:testing.filter(r=>r.level>=cut)};
 const results={};for(const [name,rows] of Object.entries(groups)){results[name]={samples:rows.length,status:rows.length>=MIN_TEST?'EVALUATED':'LIMITED_SAMPLES',chosen:rows.length?errors(rows.map(r=>chosen==='RIDGE'?r.level+modelChange(model,r):r.level),rows.map(r=>r.actual)):null,persistence:rows.length?errors(rows.map(r=>r.level),rows.map(r=>r.actual)):null};}
 return {basis:'Wet means observed prior-six-hour point rainfall > 0; upper decile is derived from training levels only, not official flood thresholds.',upper_training_decile_cutoff_m:cut,groups:results};
}
function evaluateHorizon(readings,rain,horizon,now=Date.now()){
  const values=cleanReadings(readings);
  const base={horizon_hours:horizon,forecast_status:'UNAVAILABLE',predicted_level_m:null,
    model_kind:null,validation_status:'NO_CHRONOLOGICAL_EVALUATION',
    prediction_type:'RIVER_WATER_LEVEL_NOT_FLOOD_PROBABILITY'};
  if(values.length<MIN_TRAIN+MIN_TEST+20)return {...base,reason:'INSUFFICIENT_HISTORICAL_HOURLY_LEVELS',available_readings:values.length};
  const latest=values.at(-1),age=(now-latest.time)/HOUR;
  if(age<0||age>3)return {...base,reason:'STALE_OR_FUTURE_RIVER_LEVEL',observation_age_hours:round(age,2)};
  const lookup=new Map(values.map(r=>[r.time,r.level]));
  // Ten-minute live observations can coexist with historical hourly data.
  // Use an actual recent complete window, never fabricate or forward-fill lags.
  const complete=[...values].reverse().find(r=>now-r.time<=3*HOUR&&r.time+horizon*HOUR>now&&[1,3,6].every(h=>lookup.has(r.time-h*HOUR)));
  const recent=complete||latest;
  if(recent.time+horizon*HOUR<=now)return {...base,reason:'OBSERVATION_TOO_OLD_FOR_REQUESTED_HORIZON'};
  if(lookup.has(recent.time-HOUR)&&Math.abs(recent.level-lookup.get(recent.time-HOUR))>5)return {...base,reason:'SUSPICIOUS_LEVEL_JUMP_REVIEW'};
  // Build samples with outcomes from strictly later readings; no future rainfall.
  const all=makeRows(values,cleanRain(rain),horizon);
  if(all.length<MIN_TRAIN+MIN_TEST+6)return {...base,reason:'TOO_FEW_CONSECUTIVE_HISTORICAL_WINDOWS',usable_samples:all.length};
  // Three strictly chronological partitions: older training data, later model-selection
  // validation data, and final untouched test data. Selecting the model on the
  // test split would inflate the claimed forecast performance.
  const valTime=all[Math.floor(all.length*.65)].t;
  const testTime=all[Math.floor(all.length*.82)].t;
  const embargo=(6+horizon)*HOUR;
  const training=all.filter(s=>s.t<valTime-embargo);
  const validation=all.filter(s=>s.t>=valTime&&s.t<testTime-embargo);
  const testing=all.filter(s=>s.t>=testTime);
  if(training.length<MIN_TRAIN||validation.length<MIN_TEST||testing.length<MIN_TEST)
    return {...base,reason:'INSUFFICIENT_CHRONOLOGICAL_SPLIT',train:training.length,validation:validation.length,test:testing.length};
  const currentMap=new Map(values.map(r=>[r.time,r.level]));
  const row={features:[recent.level-currentMap.get(recent.time-HOUR),recent.level-currentMap.get(recent.time-3*HOUR),recent.level-currentMap.get(recent.time-6*HOUR)]};
  const currentLagsAvailable=row.features.every(Number.isFinite);
  let currentRain=0,hasRain=true; const rainByTime=cleanRain(rain);
  for(let h=0;h<6;h++){
    const v=rainByTime.get(recent.time-h*HOUR);
    if(v===undefined){hasRain=false;break;} currentRain+=v;
  }
  row.rain6=hasRain?currentRain:null;
  // Choose rain-capable variant only if inputs are genuinely present in each
  // time slice; missing observations never become artificial zero rainfall.
  const useRain=hasRain&&training.filter(r=>r.rain6!==null).length>=MIN_TRAIN&&
    validation.filter(r=>r.rain6!==null).length>=MIN_TEST&&
    testing.filter(r=>r.rain6!==null).length>=MIN_TEST;
  const trainRows=useRain?training.filter(r=>r.rain6!==null):training;
  const validationRows=useRain?validation.filter(r=>r.rain6!==null):validation;
  const testRows=useRain?testing.filter(r=>r.rain6!==null):testing;
  if(validationRows.length<MIN_TEST||testRows.length<MIN_TEST)
    return {...base,reason:'INCOMPLETE_RAINFALL_EVALUATION'};
  const model=trainRidge(trainRows,useRain);
  const validationBaseline=errors(validationRows.map(r=>r.level),validationRows.map(r=>r.actual));
  const validationRidge=model?errors(validationRows.map(r=>r.level+modelChange(model,r)),validationRows.map(r=>r.actual)):null;
  // The validation set alone chooses the variant. The final test is untouched.
  const chosen=currentLagsAvailable&&validationRidge&&validationRidge.mae_m+1e-10<validationBaseline.mae_m*.95?'RIDGE':'PERSISTENCE';
  const persistence=errors(testRows.map(r=>r.level),testRows.map(r=>r.actual));
  const ml=model?errors(testRows.map(r=>r.level+modelChange(model,r)),testRows.map(r=>r.actual)):null;
  // For live predictions train the selected model using all historical samples
  // whose targets are already observed; holdout scores remain strictly out-of-sample.
  const fullRows=useRain?all.filter(r=>r.rain6!==null):all;
  const fitted=chosen==='RIDGE'?trainRidge(fullRows,useRain):null;
  const delta=fitted?modelChange(fitted,row):0;
  return {...base,forecast_status:'AVAILABLE',reason:null,
    predicted_level_m:round(recent.level+delta),observed_level_m:round(recent.level),
    observed_at:kstString(recent.time),valid_at:kstString(recent.time+horizon*HOUR),
    latest_observed_at:kstString(latest.time),issued_at:new Date(now).toISOString(),model_observation_age_minutes:Math.round((now-recent.time)/60000),
    model_kind:chosen,model_features:chosen==='PERSISTENCE'?'LAST_OBSERVED_WATER_LEVEL':useRain?'PAST_WATER_LEVEL_AND_PAST_6H_POINT_RAINFALL':'PAST_WATER_LEVEL_ONLY',fallback_reason:!currentLagsAvailable?'CURRENT_LAG_GAPS_PERSISTENCE_BASELINE_USED':null,
    rainfall_station_is_regional_proxy:useRain,
    validation_status:'CHRONOLOGICAL_HOLDOUT_LEVEL_ONLY',
    holdout:{periods:{training:{from:kstString(trainRows[0].t),to:kstString(trainRows.at(-1).t)},validation:{from:kstString(validationRows[0].t),to:kstString(validationRows.at(-1).t)},test:{from:kstString(testRows[0].t),to:kstString(testRows.at(-1).t)}},train_samples:trainRows.length,test_samples:testRows.length,
      validation_samples:validationRows.length,validation_persistence:validationBaseline,validation_ridge:validationRidge,
      persistence,model:ml,chosen_method:chosen,minimum_horizon_gap_hours:6+horizon,regimes:regimeEvaluation(trainRows,testRows,model,chosen)},
    note:'Independent water-level forecast evaluated against a persistence baseline; NOT a validated future flood-event probability or an official government forecast.'};
}
async function analyzeGauge(db,stationId,now=Date.now()){
  const [stations]=await db.execute(`SELECT station_id,station_name,external_station_id,latitude,longitude
    FROM stations s WHERE s.station_id=? AND s.data_source='RIVER_GAUGE' AND EXISTS (
      SELECT 1 FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED'
    ) LIMIT 1`,[stationId]);
  if(!stations.length)return null;
  const station=stations[0];
  const [readings]=await db.execute(`SELECT DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at,water_level
    FROM water_readings WHERE station_id=? AND water_level IS NOT NULL
      AND ((MINUTE(observed_at)=0 AND SECOND(observed_at)=0)
        OR observed_at>=UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 12 HOUR)
    ORDER BY observed_at DESC LIMIT ${LIMIT}`,[stationId]);
  const [kma]=await db.query(`SELECT station_id,station_name,latitude,longitude FROM stations
    WHERE data_source='KMA' AND latitude IS NOT NULL AND longitude IS NOT NULL`);
  const nearest=kma.map(s=>({...s,distance_km:distancesKm(station.latitude,station.longitude,s.latitude,s.longitude)}))
    .filter(s=>s.distance_km<=25).sort((a,b)=>a.distance_km-b.distance_km)[0]||null;
  let rain=[];
  let hydroLink=null;try{const [[h]]=await db.execute('SELECT * FROM hr_rainfall_links WHERE station_id=? AND distance_km<=25',[stationId]);hydroLink=h;}catch(e){if(e.code!=='ER_NO_SUCH_TABLE')throw e;}
  const [rainLinks]=await db.execute("SELECT aws_station_code,distance_km FROM station_rainfall_links WHERE station_id=? AND verification_status IN ('VERIFIED','AUTO_NEAREST') AND distance_km<=25 LIMIT 1",[stationId]);
  const linkedRain=rainLinks[0];
  if(hydroLink&&readings.length){
    [rain]=await db.execute('SELECT observed_at,rainfall_mm AS rainfall FROM hr_rainfall_history WHERE station_code=? AND observed_at>=? ORDER BY observed_at',[hydroLink.rainfall_station_code,readings.at(-1).observed_at]);
  }else if(linkedRain&&readings.length){
    [rain]=await db.execute(`SELECT DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at,hourly_rainfall AS rainfall FROM aws_rainfall_readings WHERE aws_station_code=? AND observed_at>=? AND hourly_rainfall IS NOT NULL ORDER BY observed_at ASC`,[linkedRain.aws_station_code,readings.at(-1).observed_at]);
  }else if(nearest&&readings.length){
    const oldest=readings.at(-1).observed_at;
    [rain]=await db.execute(`SELECT DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at,hourly_rainfall AS rainfall
      FROM weather_readings WHERE station_id=? AND observed_at>=? ORDER BY observed_at ASC`,[nearest.station_id,oldest]);
  }
  const horizons=HORIZONS.map(h=>evaluateHorizon(readings,rain,h,now));
  return {success:true,station_id:stationId,station_name:station.station_name,
    wamis_code:station.external_station_id,generated_at:new Date(now).toISOString(),
    prediction_horizons_hours:HORIZONS,
    rainfall_context:hydroLink?{provider:'HRFCO',station_code:hydroLink.rainfall_station_code,distance_km:Number(hydroLink.distance_km),type:'POINT_HOURLY_RAINFALL_NOT_CATCHMENT'}:linkedRain?{provider:'KMA_AWS',aws_station_code:linkedRain.aws_station_code,distance_km:Number(linkedRain.distance_km),type:'LINKED_POINT_HOURLY_RAINFALL_NOT_CATCHMENT'}:nearest?{kma_station_id:nearest.station_id,distance_km:round(nearest.distance_km,1),type:'NEAREST_STATION_NOT_CATCHMENT'}:null,
    horizons,official_warning_issued:null,calibrated_flood_probability:null,
    prediction_label:'Independent experimental 1/3/6-hour water-level forecast — not Korean government AI',
    disclaimer:'No official warning, no claim of future inundation; level forecasts do not equal flood-risk grades.'};
}
async function getLegacyOutlook(id,db=require('./db')){
  const key=Number(id);
  if(!Number.isSafeInteger(key)||key<1)throw new Error('INVALID_STATION_ID');
  if(cache.has(key)&&Date.now()-cache.get(key).at<CACHE_MS)return cache.get(key).data;
  if(!inflight.has(key))inflight.set(key,analyzeGauge(db,key).then(result=>{
    cache.set(key,{at:Date.now(),data:result});return result;
  }).finally(()=>inflight.delete(key)));
  return inflight.get(key);
}
// The old fitting helpers remain for regression fixtures. Live routes load artifacts.
async function getOutlook(id){const key=Number(id);if(!Number.isSafeInteger(key)||key<1)throw Error('INVALID_STATION_ID');return require('./level-artifact-service').forecast(key);}
module.exports={parseKst,kstString,cleanReadings,cleanRain,makeRows,trainRidge,evaluateHorizon,analyzeGauge,getOutlook,regimeEvaluation};
