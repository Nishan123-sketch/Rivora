'use strict';
const config=require('./config/risk-config');
const {measurementType}=require('./gauge-risk-safety');
const HOUR=3600000;
const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const time=v=>v instanceof Date?v.getTime():Date.parse(String(v||'').replace(' ','T')+(/Z$|[+-]\d\d:\d\d$/.test(String(v))?'':'+09:00'));
const clamp=v=>Math.max(0,Math.min(100,v));
function evaluate({station,latest,threshold,history=[],historyStats=null,rain=[],forecast=[],now=Date.now(),referenceEntries}){
 const observed=time(latest?.observed_at),value=num(latest?.water_level);
 const out={station_id:station.station_id,level:null,score:null,tier:'C',basis:'Not assessable',reasons:[],percentile:null,rise_1h:null,rise_3h:null,rain_3h:null,rain_6h:null,forecast_rain_3h:null,observed_at:latest?.observed_at||null,data_status:'MISSING',method_version:config.version,calibration_status:'UNVALIDATED_PROJECT_ESTIMATE',official_warning:false};
 const knownTwo=require('./official-two-stage').twoStageEvidence(station,threshold);
 const knownFour=require('./verified-risk-evidence').stageEvidence({...threshold,external_station_id:station.external_station_id});
 out.threshold_verified=!!knownTwo||knownFour.verified;
 if(out.threshold_verified)Object.assign(out,{source_url:threshold.source_url,advisory_stage_m:knownTwo?.advisory??knownFour.levels?.[1],warning_stage_m:knownTwo?.warning??knownFour.levels?.[2],severe_stage_m:knownFour.verified?knownFour.levels?.[3]:null,threshold_scheme:knownTwo?'TWO_STAGE':'FOUR_STAGE'});
 const stop=reason=>({...out,reasons:[reason],data_status:reason});
 if(station.data_source!=='RIVER_GAUGE'||measurementType(station.station_name)==='POTENTIAL_DAM_OR_RESERVOIR')return stop('EXCLUDED_MEASUREMENT_TYPE');
 if(value===null||!Number.isFinite(observed))return stop('MISSING');
 if(observed>now)return stop('FUTURE_TIMESTAMP');
 if(now-observed>config.freshnessHours*HOUR)return stop('STALE');
 out.data_status='FRESH';out.observation_freshness='FRESH';
 for(const hours of [1,3,6]){const target=observed-hours*HOUR;const before=history.filter(r=>num(r.water_level)!==null&&Number.isFinite(time(r.observed_at))&&Math.abs(time(r.observed_at)-target)<=HOUR/2).sort((a,b)=>Math.abs(time(a.observed_at)-target)-Math.abs(time(b.observed_at)-target))[0];out['rise_'+hours+'h']=before?value-num(before.water_level):null;out['rise_interval_'+hours+'h_minutes']=before?Math.round((observed-time(before.observed_at))/60000):null;}
 const rainTimes=rain.map(r=>time(r.observed_at)).filter(t=>Number.isFinite(t)&&t<=observed&&now-t<=config.freshnessHours*HOUR);
 const rainEnd=rainTimes.length?Math.max(...rainTimes):NaN;
 out.rainfall_observed_at=Number.isFinite(rainEnd)?rain.find(r=>time(r.observed_at)===rainEnd).observed_at:null;
 const total=(records,hours,field,forward=false)=>{const anchor=forward?observed:rainEnd;const values=Array.from({length:hours},(_,i)=>records.find(r=>Math.abs(time(forward?r.valid_at:r.observed_at)-(Math.floor(anchor/HOUR)*HOUR+(forward?i+1:-i)*HOUR))<60000));return values.every(r=>r&&num(r[field])!==null&&num(r[field])>=0)?values.reduce((sum,r)=>sum+num(r[field]),0):null;};
 out.rain_3h=total(rain,3,'hourly_rainfall');out.rain_6h=total(rain,6,'hourly_rainfall');out.forecast_rain_3h=total(forecast,3,'rainfall_forecast',true);
 const compatibility=require('./measurement-compatibility').compatibility(station,latest,threshold,referenceEntries);
 out.measurement_compatibility=compatibility;
 if(!compatibility.verified)return {...out,level:null,score:null,tier:'C',basis:'Not assessed',assessment_status:'NOT_ASSESSED',reasons:[compatibility.reason],assessment_note:compatibility.note};
 if(!out.threshold_verified)return {...out,level:null,score:null,tier:'C',basis:'Not assessed',assessment_status:'NOT_ASSESSED',reasons:['OFFICIAL_STAGES_NOT_VERIFIED'],assessment_note:'Published station thresholds have not been verified. Historical screening is not a validated flood classification.'};
 const official=require('./official-two-stage');
 const twoStage=official.twoStageEvidence(station,threshold);
 if(twoStage)return {...out,...official.compareTwoStage(value,twoStage),tier:'A',basis:'Verified official advisory/warning thresholds',reasons:['VERIFIED_TWO_STAGE_THRESHOLDS','COMPARISON_ONLY_NOT_AN_ISSUED_WARNING'],calibration_status:'DOCUMENTED_STAGE_COMPARISON'};
 const evidence=require('./verified-risk-evidence').stageEvidence({...threshold,external_station_id:station.external_station_id});
 const levels=evidence.levels;
 if(evidence.verified){
  return {...out,tier:'A',basis:'Official stage thresholds',level:value>=levels[3]?'Severe':value>=levels[2]?'High':value>=levels[1]?'Moderate':'Low',reasons:['VERIFIED_STATION_THRESHOLDS'],source_url:threshold.source_url,calibration_status:'DOCUMENTED_STAGE_COMPARISON'};
 }
 out.reasons.push(evidence.reason);
 const unique=new Map();
 for(const r of history){const t=time(r.observed_at),v=num(r.water_level);if(Number.isFinite(t)&&t<observed&&t>=observed-(config.historyDays+1)*24*HOUR&&v!==null)unique.set(Math.floor(t/HOUR),{t,v});}
 const rows=[...unique.values()].sort((a,b)=>a.t-b.t),span=historyStats?.first_observed_at?(observed-time(historyStats.first_observed_at))/(24*HOUR):rows.length?(observed-rows[0].t)/(24*HOUR):0;
 out.history_hours=historyStats?Number(historyStats.hours):rows.length;out.history_span_days=span;out.history_coverage=Math.min(1,out.history_hours/(config.historyDays*24));
 out.percentile=historyStats?(Number(historyStats.samples)?100*(Number(historyStats.less)+0.5*Number(historyStats.equal))/Number(historyStats.samples):null):rows.length?100*(rows.filter(r=>r.v<value).length+0.5*rows.filter(r=>r.v===value).length)/rows.length:null;
 for(const h of [1,3]){const before=rows.findLast(r=>Math.abs(r.t-(observed-h*HOUR))<=HOUR/4);out['rise_'+h+'h']=before?value-before.v:null;}
 if(span<config.historyDays||out.history_coverage<config.minCoverage)return {...out,data_status:'INSUFFICIENT_HISTORY',reasons:[...out.reasons,'INSUFFICIENT_HISTORY'],required_days:config.historyDays};
 const rises=[out.rise_1h,out.rise_3h===null?null:out.rise_3h/3].filter(v=>v!==null);
 const rainfall=[[out.rain_3h,config.rainScaleMm.three],[out.rain_6h,config.rainScaleMm.six],[out.forecast_rain_3h,config.rainScaleMm.forecast]].filter(([v])=>v!==null);
 if(!rises.length)out.reasons.push('RISE_DATA_MISSING');if(!rainfall.length)out.reasons.push('RAINFALL_DATA_MISSING');
 // Missing components are omitted and disclosed, never interpreted as zero rainfall.
 const components=[[out.percentile,config.weights.percentile],...(rises.length?[[clamp(Math.max(...rises)/config.riseScaleMPerHour*100),config.weights.rise]]:[]),...(rainfall.length?[[clamp(Math.max(...rainfall.map(([v,s])=>v/s))*100),config.weights.rain]]:[])];
 const score=Math.round(components.reduce((s,[v,w])=>s+v*w,0)/components.reduce((s,[,w])=>s+w,0));
 return {...out,tier:'B',basis:"Estimate relative to this station's history",score,level:score>=config.cutoffs.severe?'Severe':score>=config.cutoffs.high?'High':score>=config.cutoffs.moderate?'Moderate':'Low',reasons:[...out.reasons,'UNVALIDATED_HISTORY_ESTIMATE'],percentile:Number(out.percentile.toFixed(2))};
}
async function assessStation(id,{db=require('./db'),now=Date.now()}={}){
 const [[station]]=await db.execute('SELECT * FROM stations WHERE station_id=?',[id]);if(!station)return null;
 const [[latest]]=await db.execute('SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[id]);
 const [[threshold]]=await db.execute('SELECT * FROM flood_thresholds WHERE station_id=?',[id]);
 const observedAt=latest?.observed_at||'1970-01-01';
 let historyStats=null,history=[];
 const verified=require('./verified-risk-evidence').stageEvidence({...threshold,external_station_id:station.external_station_id}).verified||!!require('./official-two-stage').twoStageEvidence(station,threshold);
 if(!verified){
 [[historyStats]]=await db.execute("SELECT MIN(observed_at) AS first_observed_at,COUNT(DISTINCT DATE_FORMAT(observed_at,'%Y-%m-%d %H')) AS hours,COUNT(*) AS samples,SUM(water_level<?) AS less,SUM(water_level=?) AS equal FROM water_readings WHERE station_id=? AND observed_at>=DATE_SUB(?,INTERVAL 366 DAY) AND observed_at<? AND water_level IS NOT NULL",[num(latest?.water_level),num(latest?.water_level),id,observedAt,observedAt]);
 
 }
 [history]=await db.execute('SELECT observed_at,water_level FROM water_readings WHERE station_id=? AND observed_at>=DATE_SUB(?,INTERVAL 7 HOUR) AND observed_at<? ORDER BY observed_at',[id,observedAt,observedAt]);
 const [[link]]=await db.execute("SELECT * FROM station_rainfall_links WHERE station_id=? AND verification_status IN ('VERIFIED','AUTO_NEAREST')",[id]);
 let rain=[],forecast=[];
 if(link){[rain]=await db.execute('SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=? ORDER BY observed_at DESC LIMIT 12',[link.aws_station_code]);
 [forecast]=await db.execute("SELECT f.valid_at,f.rainfall_forecast FROM weather_forecasts f JOIN stations s ON s.station_id=f.station_id JOIN (SELECT station_id,MAX(issued_at) issued_at FROM weather_forecasts GROUP BY station_id) issue ON issue.station_id=f.station_id AND issue.issued_at=f.issued_at WHERE s.data_source='KMA' AND s.external_station_id=? ORDER BY f.valid_at DESC LIMIT 72",[link.aws_station_code]);}
 return {...station,...evaluate({station,latest,threshold,history,historyStats,rain,forecast,now}),water_level:num(latest?.water_level),water_observed_at:latest?.observed_at||null,observation_source_url:latest?.source_url||null,rainfall_link:link||null};
}
function createService({db,now=Date.now}={}){
 let cached=null,pending=null;
 async function all({force=false}={}){
  if(!force&&cached&&now()-cached.at<config.cacheMs)return cached.data;
  if(pending)return pending;
 pending=(async()=>{const connection=db||require('./db');const data=await require('./risk-bulk').bulkAssess(connection,now(),evaluate);const [riverLinks]=await connection.query("SELECT station_id,river_id FROM river_gauge_links WHERE verification_status='VERIFIED' ORDER BY river_id");const catalog=require('./river-network-registry').getCatalog();const [designations]=await connection.query('SELECT station_code,designation,source_url,authority FROM official_station_registry');for(const row of data){const link=riverLinks.find(l=>String(l.station_id)===String(row.station_id));const river=catalog.find(r=>r.river_id===link?.river_id);const designation=designations.find(d=>String(d.station_code)===String(row.external_station_id));if(designation?.designation==='PUBLISHED_THRESHOLD'&&row.tier==='A')row.basis='Official caution/alert reference levels at a non-designated gauge';Object.assign(row,{station_designation:designation?.designation||'UNCONFIRMED',designation_source_url:designation?.source_url||null,authority:designation?.authority||null,river_id:river?.river_id||null,river_name_en:river?.name_en||null,river_name_ko:river?.name_ko||null});}cached={at:now(),data};return data;})().finally(()=>pending=null);return pending;
 }
 return {all};
}
const service=createService();
module.exports={evaluate,assessStation,getUnified:async options=>require('./official-warning-priority').overlay((await service.all(options)).filter(r=>r.threshold_verified===true)),createService,time,num};

