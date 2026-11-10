const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const db=require('./db');const {featureSnapshot,kst}=require('./advanced-ml-features');
const {currentOfficial,prioritize}=require('./warning-timeline');const {englishStationName,englishRiverName}=require('./display-names');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const networkPath=path.join(__dirname,'reports/advanced-level-network.json');
function networkReport(){return require('./level-artifact-service').readReport()}
async function latestWarningModel(){const [rows]=await db.query("SELECT report FROM ml_model_versions WHERE prediction_type='WARNING_ISSUANCE' ORDER BY created_at DESC,model_version DESC LIMIT 1");return rows[0]?parse(rows[0].report):{status:'MODEL_UNAVAILABLE',probability_available:false,reason:'TRAINING_NOT_RUN',model_version:null};}
async function officialHistory(station){
 const [[events],[coverage]]=await Promise.all([db.execute('SELECT * FROM hr_flood_warning_history WHERE station_code=? ORDER BY issued_at',[station.external_station_id]),db.execute('SELECT * FROM ml_source_coverage WHERE station_code=? ORDER BY start_at',[station.external_station_id])]);
 return {status:currentOfficial(events,coverage),events,coverage:coverage.map(c=>({start_at:c.start_at,end_at:c.end_at,status:c.status})),station_code:station.external_station_id};
}
async function liveFeatures(id,{database=db,now=Date.now(),repairRain=require('./hrfco-feature-history').ensureRecentRain,recentRain=require('./hrfco-feature-history').recentRain,repairWaitMs=2500}={}){
 const db=database;
 const [water]=await db.execute('SELECT observed_at,water_level,flow_rate FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 2500',[id]);
 const [[link]]=await db.execute("SELECT * FROM station_rainfall_links WHERE station_id=? AND verification_status IN ('VERIFIED','AUTO_NEAREST')",[id]);
 let rain=[];if(link&&water.length)[rain]=await db.execute('SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=? AND observed_at>=DATE_SUB(?,INTERVAL 30 HOUR) AND observed_at<=? ORDER BY observed_at',[link.aws_station_code,water[0].observed_at,water[0].observed_at]);
 let hydro=water.length?await recentRain(db,id,water[0].observed_at):null;
 let rainLink=hydro?{aws_station_code:hydro.link.rainfall_station_code,gauge_name:hydro.link.gauge_name,distance_km:hydro.link.distance_km}:link;
 if(hydro)rain=hydro.rows;
 let snapshot=featureSnapshot(water,rain,now,rainLink?.distance_km??null),repairStatus='NOT_NEEDED';
 if(water.length&&snapshot.quality.issues.includes('INCOMPLETE_RAINFALL_WINDOWS')){
  let timer;
  const recovery=Promise.resolve().then(()=>repairRain(db,id,water[0].observed_at)).then(()=>{detailsCache.delete(Number(id));return 'CHECKED';},e=>{console.warn('[ML rainfall repair]',e.code||e.name);return 'UNAVAILABLE';});
  try{repairStatus=await Promise.race([recovery,new Promise(resolve=>{timer=setTimeout(()=>resolve('IN_PROGRESS'),repairWaitMs);})]);}finally{clearTimeout(timer);}
  if(repairStatus==='CHECKED'){
   hydro=await recentRain(db,id,water[0].observed_at);
   if(hydro){rain=hydro.rows;rainLink={aws_station_code:hydro.link.rainfall_station_code,gauge_name:hydro.link.gauge_name,distance_km:hydro.link.distance_km};}
   snapshot=featureSnapshot(water,rain,now,rainLink?.distance_km??null);
  }
 }
 snapshot.quality.rainfall_repair_status=repairStatus;
 if(snapshot.features)await db.execute('INSERT INTO ml_feature_snapshots(station_id,observed_at,generated_at,features,quality) VALUES(?,?,UTC_TIMESTAMP(),?,?) ON DUPLICATE KEY UPDATE generated_at=VALUES(generated_at),features=VALUES(features),quality=VALUES(quality)',[id,snapshot.feature_time,JSON.stringify(snapshot.features),JSON.stringify(snapshot.quality)]);
 const lastRain=rain.filter(r=>r.hourly_rainfall!=null&&Number(r.hourly_rainfall)>=0).at(-1);
 return {...snapshot,latest_rainfall_observation:lastRain?{observed_at:lastRain.observed_at,rainfall_mm:Number(lastRain.hourly_rainfall),role:'LAST_REPORTED_HOUR_NOT_A_REPLACEMENT_FOR_MISSING_MODEL_WINDOWS'}:null,rainfall_station:rainLink?{provider:hydro?'HRFCO':'KMA_AWS',name:englishStationName(rainLink.gauge_name),code:rainLink.aws_station_code,distance_km:Number(rainLink.distance_km),role:'NEARBY_POINT_PROXY_NOT_CATCHMENT'}:null,water,rain};
}
function experimentalForStation(station,snapshot){
 if(station.measurement_compatibility?.verified===false)return {status:'UNAVAILABLE',reason:'MEASUREMENT_REFERENCE_NOT_VERIFIED'};
 const {evaluateHistory}=require('./experimental-gauge-screening');const {rainfallContext,assess}=require('./experimental-flood-potential');
 if(!snapshot.features||snapshot.quality.issues.some(s=>['STALE_WATER','FUTURE_WATER','RAINFALL_GEOGRAPHY_UNVERIFIED','SUSPICIOUS_LEVEL_JUMP_REVIEW'].includes(s)))return {status:'UNAVAILABLE',reason:'CRITICAL_INPUT_QUALITY_FAILURE'};
 const gauge={station_id:station.station_id,wamis_code:station.external_station_id,observed_at:snapshot.feature_time,water_level_m:snapshot.features.level,observation_status:'FRESH',observed_conditions:{previous_hour_change_m:snapshot.features.change_1h}};
 const screening=evaluateHistory(gauge,snapshot.water);const rainStation=snapshot.rainfall_station;
 const rainfall=rainfallContext(rainStation?{station_id:rainStation.code,station_name:rainStation.name,distance_km:rainStation.distance_km}:null,snapshot.rain.map(r=>({...r,rainfall:r.hourly_rainfall})),Date.now());
 for(const h of [3,6,12,24])if(rainfall['observed_'+h+'h'])rainfall['observed_'+h+'h'].measurement_sources=[snapshot.rainfall_station?.provider==='HRFCO'?'HRFCO_LINKED_POINT':'KMA_AWS_LINKED_POINT'];
 const potential=assess(gauge,screening,rainfall);return {...potential,experimental_risk:{status:'NOT_VALIDATED',grade:null,reason:'EXPERIMENTAL_RISK_GRADE_NOT_VALIDATED'}};
}
function validProbability(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;}
function runInference(payload){return new Promise((resolve,reject)=>{
 const child=require('node:child_process').spawn(process.env.PYTHON_BIN||'python',[path.join(__dirname,'ml/advanced_warning.py'),'infer'],{cwd:__dirname,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='',size=0;
 const timer=setTimeout(()=>{child.kill();reject(Error('INFERENCE_TIMEOUT'))},30000);
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>65536){child.kill();reject(Error('INFERENCE_RESPONSE_TOO_LARGE'))}else text+=chunk;});
 child.stderr.on('data',()=>{});child.on('error',()=>{clearTimeout(timer);reject(Error('PYTHON_RUNTIME_UNAVAILABLE'))});
 child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('MODEL_INFERENCE_FAILED'));try{resolve(JSON.parse(text))}catch{reject(Error('INVALID_INFERENCE_RESPONSE'))}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
 });}
async function warningPrediction(station,features,official,report){
 const now=Date.now();const base={station_id:Number(station.station_id),station_code:station.external_station_id,observed_at:features.feature_time||null,issued_at:kst(now),valid_at:kst(now+3*3600000),horizon_hours:3,
  prediction_type:'NEW_OFFICIAL_WARNING_ISSUANCE',model_name:report.model_name||null,model_version:report.model_version||null,probability:null,prediction_value:null,level:null,
  validation_status:report.status,data_quality_status:features.quality.status,status:report.status==='VALIDATED_WARNING_FORECAST'?'FORECAST_UNAVAILABLE':report.status,reason:report.reason||null};
 if(report.status!=='VALIDATED_WARNING_FORECAST'||!report.probability_available)return base;
 if(!require('./level-availability').warningEvidence(report).probability_enabled)return {...base,status:'FORECAST_UNAVAILABLE',reason:'VALIDATION_EVIDENCE_INCONSISTENT'};
 const age=now-Date.parse(report.generated_at);
 if(!Number.isFinite(age)||age<0||age>7*86400000)return {...base,status:'MODEL_UNAVAILABLE',reason:'MODEL_REPORT_OUTDATED'};
 if(features.quality.status!=='FRESH')return {...base,reason:'INCOMPLETE_OR_STALE_FEATURES'};
 const expectedRain=report.rainfall_sources?.[String(station.station_id)];if(expectedRain&&(expectedRain.provider!==(features.rainfall_station?.provider||'KMA_AWS')||String(expectedRain.code)!==String(features.rainfall_station?.code)))return {...base,reason:'MODEL_RAINFALL_SOURCE_MISMATCH'};
 if(official.status==='UNKNOWN')return {...base,reason:'OFFICIAL_WARNING_STATUS_UNKNOWN'};
 if(official.status!=='NONE')return {...base,status:'ONGOING_OFFICIAL_WARNING',reason:'NEW_ISSUANCE_MODEL_NOT_APPLIED_TO_ONGOING_WARNING'};
 if(!report.station_ids?.includes(Number(station.station_id)))return {...base,reason:'STATION_OUTSIDE_VALIDATED_SCOPE'};
 if((report.test?.positive_warning_events||0)<10||!report.calibration_method)return {...base,reason:'VALIDATION_EVIDENCE_INCOMPLETE'};
 try{const result=await runInference({station_id:station.station_id,features:features.features,rainfall_source:features.rainfall_station,artifact_name:report.artifact_name,artifact_sha256:report.artifact_sha256});
  if(!validProbability(result.probability)||!['Low','Moderate','High'].includes(result.level))return {...base,reason:'INVALID_MODEL_PROBABILITY'};
  return {...base,...result,status:'VALIDATED_WARNING_FORECAST',reason:null,prediction_value:result.probability};
 }catch(e){return {...base,reason:e.message};}
}
async function savePredictions(id,predictions){for(const p of predictions){const issued=p.issued_at||kst(Date.now());const key=p.forecast_id||crypto.createHash('sha256').update([id,p.prediction_type,p.horizon_hours,issued.slice(0,16)].join('|')).digest('hex');await db.execute('INSERT IGNORE INTO ml_advanced_predictions(prediction_id,station_id,observed_at,issued_at,valid_at,horizon_hours,prediction_type,model_version,prediction_value,validation_status,quality_status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[key,id,p.observed_at||null,issued,p.valid_at||null,p.horizon_hours,p.prediction_type,p.model_version||null,p.prediction_value??null,p.validation_status||'UNAVAILABLE',p.data_quality_status||'UNAVAILABLE',p.reason||null]);}}
let overviewCache=null;let overviewPending=null;
async function overview({refresh=false}={}){
 if(refresh)overviewCache=null;
 if(overviewCache&&Date.now()-overviewCache.at<60000)return overviewCache.data;if(overviewPending)return overviewPending;
 overviewPending=(async()=>{
 const now=Date.now(),availabilityModule=require('./level-availability');
 const stations=await require('./official-warning-priority').overlay(await require('./ml-network-stages').snapshot(db,now));
 const report=networkReport(),model=await latestWarningModel(),warning=availabilityModule.warningEvidence(model);
 let training=null;try{training=JSON.parse(fs.readFileSync(path.join(__dirname,'reports/level-upgrade/training.json'),'utf8'));}catch{}
 const utc=t=>new Date(t).toISOString().slice(0,19).replace('T',' ');
 const [coverage]=await db.execute("SELECT DISTINCT station_code FROM ml_source_coverage WHERE status='COMPLETE' AND start_at<=? AND end_at BETWEEN ? AND ? AND checked_at>=?",[kst(now),kst(now-20*60000),kst(now),utc(now-20*60000)]);
 const [events]=await db.query('SELECT COUNT(*) records,COUNT(DISTINCT station_code) stations FROM hr_flood_warning_history');
 const evaluated=new Map((report?.stations||[]).map(s=>[String(s.station_id),s]));
 const modelFresh=!!report&&now-Date.parse(report.generated_at)>=0&&now-Date.parse(report.generated_at)<24*3600000;
 const rows=stations.map(s=>{
 const m=evaluated.get(String(s.station_id)),availability=availabilityModule.stationState(m,now),fresh=modelFresh&&s.data_status==='FRESH';
 return {station_id:s.station_id,station_code:s.external_station_id,station_name:englishStationName(s.station_name,s.external_station_id),station_name_original:s.station_name,river_name_original:s.river_name_ko,river:englishRiverName(s.river_name_en,s.river_name_ko),level:s.level,source:s.display_source||'Verified flood stage',observed_at:s.observed_at,water_level:s.water_level,
 level_forecast_available:fresh&&availability.ready_horizons.length>0,level_output_available:fresh&&(availability.ready_horizons.length+availability.baseline_horizons.length)>0,
 level_availability:availability.status,ready_horizons:availability.ready_horizons,baseline_horizons:availability.baseline_horizons,level_horizons:availability.horizons.map(h=>({horizon_hours:h.horizon_hours,status:h.availability,reason:h.reason,valid_at:h.valid_at,baseline_evidence:require('./level-baseline-reasons').baselineEvidence(h)})),
 experimental_available:fresh&&!!m?.experimental_grade,warning_forecast_available:warning.probability_enabled&&model.station_ids?.includes(Number(s.station_id))||false,
 data_status:s.data_status,model_status:m?.status||'NOT_EVALUATED',model_reason:s.data_status==='STALE'?'STALE_OBSERVATION':availability.reason};});
 const accepted=availabilityModule.acceptanceCounts(training,rows),counts=availabilityModule.overviewCounts(rows,coverage,training,warning);
 const snapshot={id:crypto.createHash('sha256').update(JSON.stringify([now,report?.generated_at,training?.generated_at,model.model_version])).digest('hex').slice(0,16),as_of:new Date(now).toISOString(),forecast_generated_at:report?.generated_at||null,acceptance_generated_at:accepted.source_generated_at,warning_evaluated_at:warning.evaluated_at,warning_model_version:model.model_version||null,acceptance_source_available:accepted.source_available,forecast_training_manifest_matches:!!training&&report?.training_report_generated_at===training.generated_at};
 const result={snapshot,level_repair:availabilityModule.repairSummary(),data_enrichment:require('./ml-enrichment-status').enrichmentStatus(),generated_at:snapshot.as_of,counts,latest_model_update:report?.generated_at||null,
 level_training:training?{eligible_stations:training.eligible_stations,trained_candidate_models:training.trained_candidate_models,accepted_advanced_models:accepted.accepted_station_horizon_models,accepted_model_stations:accepted.accepted_model_stations,generated_at:training.generated_at}:null,
 pipeline_status:report?.pipeline_status||null,warning_model:{scope:'NETWORK_WIDE_WARNING_ISSUANCE',status:model.status,reason:model.reason,model_version:model.model_version,evaluated_at:warning.evaluated_at,dataset:model.dataset||null},warning_evidence:warning,warning_history:events[0],stations:rows};overviewCache={at:Date.now(),data:result};return result;
 })().finally(()=>overviewPending=null);return overviewPending;
}
const detailsCache=new Map(),detailsPending=new Map();
async function detail(id,{refresh=false}={}){
 if(refresh)detailsCache.delete(id);
 if(detailsCache.has(id)&&Date.now()-detailsCache.get(id).at<60000)return detailsCache.get(id).data;if(detailsPending.has(id))return detailsPending.get(id);
 const task=(async()=>{const station=await require('./risk-engine').assessStation(Number(id));if(!station?.threshold_verified)return null;
 const [links]=await db.execute("SELECT river_id FROM river_gauge_links WHERE station_id=? AND verification_status='VERIFIED' LIMIT 1",[Number(id)]);
 const river=require('./river-network-registry').getCatalog().find(r=>r.river_id===links[0]?.river_id);
 Object.assign(station,{river_id:river?.river_id,river_name_en:river?.name_en,river_name_ko:river?.name_ko});
 const [levelOutlook,official,features,model]=await Promise.all([require('./ai-water-level-outlook').getOutlook(id),officialHistory(station),liveFeatures(id),latestWarningModel()]);
 const warning=await warningPrediction(station,features,official.status,model);
 const experimental=experimentalForStation(station,features);
 const exp=experimental.experimental_risk||null;
 const assessment=prioritize({official:official.status,stage:station,warning,experimental:exp});
 const forecasts=(levelOutlook?.horizons||[]).map(h=>({...h,station_id:Number(id),station_code:station.external_station_id,issued_at:h.issued_at||kst(Date.now()),observed_at:h.observed_at||features.observed_at||null,valid_at:h.valid_at||null,model_name:h.model_kind||null,model_version:h.model_version||'rivora-level-v3',prediction_type:'RIVER_LEVEL',prediction_value:h.predicted_level_m,data_quality_status:h.data_quality_status||(h.forecast_status==='AVAILABLE'?'FRESH':'UNAVAILABLE')}));
 const floodStageOutlook=require('./flood-stage-outlook').evaluateFloodStageOutlook(station,forecasts);
 await savePredictions(id,[...forecasts,warning]);
 const data={station:{station_id:Number(id),station_code:station.external_station_id,name:englishStationName(station.station_name,station.external_station_id),river:englishRiverName(station.river_name_en,station.river_name_ko)},generated_at:new Date().toISOString(),assessment,observed_stage:station,official_warning:official.status,official_history:official.events.slice(-50).reverse(),official_coverage:official.coverage,
  level_availability:require('./level-availability').stationState({horizons:forecasts}),warning_evidence:require('./level-availability').warningEvidence(model),level_quality:levelOutlook?.data_quality||null,level_pipeline:levelOutlook?.pipeline_health||null,level_artifact:levelOutlook?.artifact_name||null,level_forecasts:forecasts,flood_stage_outlook:floodStageOutlook,warning_prediction:warning,warning_model_report:model,features:{...features,water:undefined,rain:undefined},experimental:experimental?{...experimental,experimental_risk:exp}:null,
  history:features.water.filter(w=>{const age=Date.now()-require('./monitoring-store').millis(w.observed_at);return age>=0&&age<=72*3600000}).reverse(),
  explanation:{method:model.explanation?.method||'Observed inputs only; no fitted warning-model contribution available',contributions:model.explanation?.values||[],forecast_rainfall:'Not used for training without archived availability evidence'}};
 const cacheMs=features.quality.issues.includes('INCOMPLETE_RAINFALL_WINDOWS')?5000:60000;
 detailsCache.set(id,{at:Date.now()-(60000-cacheMs),data});return data;})();detailsPending.set(id,task);return task.finally(()=>detailsPending.delete(id));
}
module.exports={overview,detail,latestWarningModel,officialHistory,warningPrediction,validProbability,networkReport,liveFeatures,experimentalForStation};
