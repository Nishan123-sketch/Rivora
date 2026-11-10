const {millis,fresh}=require('./monitoring-store');
const HOUR=3600000;
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const kst=t=>new Date(t+9*HOUR).toISOString().slice(0,19).replace('T',' ');
function featureSnapshot(water,rain,now=Date.now(),distance=null){
 const issues=[];const rows=water.map(r=>({...r,t:millis(r.observed_at),v:numeric(r.water_level)})).filter(r=>Number.isFinite(r.t)&&r.v!==null).sort((a,b)=>a.t-b.t);
 const latest=rows.at(-1);if(!latest)return {features:null,quality:{status:'DATA_UNAVAILABLE',issues:['MISSING_WATER']}};
 if(!fresh(latest.observed_at,now))issues.push(latest.t>now?'FUTURE_WATER':'STALE_WATER');
 const t=Math.floor(Math.min(now,latest.t)/HOUR)*HOUR;
 const at=time=>rows.findLast(r=>r.t<=time&&r.t>=time-HOUR/4);
 const current=at(t),lags=[1,2,3,6].map(h=>at(t-h*HOUR));
 if(!current||lags.some(r=>!r))issues.push('INCOMPLETE_LEVEL_WINDOWS');
 const history=Array.from({length:72},(_,i)=>at(t-i*HOUR)).filter(Boolean);
 const hourly=new Map(rain.filter(r=>millis(r.observed_at)<=t).map(r=>[millis(r.observed_at),numeric(r.hourly_rainfall)]));
 const rainfall={};for(const h of [1,3,6,12,24]){const values=Array.from({length:h},(_,i)=>hourly.get(t-i*HOUR));rainfall['rain_'+h+'h']=values.every(v=>v!==null&&v!==undefined&&v>=0)?values.reduce((a,b)=>a+b,0):null;}
 const missingRain=Array.from({length:24},(_,i)=>t-i*HOUR).filter(time=>{const v=hourly.get(time);return v===null||v===undefined||v<0;});
 if(Object.values(rainfall).some(v=>v===null))issues.push('INCOMPLETE_RAINFALL_WINDOWS');
 if(distance===null||!Number.isFinite(Number(distance))||Number(distance)>30)issues.push('RAINFALL_GEOGRAPHY_UNVERIFIED');
 const change=(a,b)=>a&&b?a.v-b.v:null;
 const change1=change(current,lags[0]);if(change1!==null&&Math.abs(change1)>5)issues.push('SUSPICIOUS_LEVEL_JUMP_REVIEW');
 const features={level:current?.v??null,change_1h:change1,change_3h:change(current,lags[2]),change_6h:change(current,lags[3]),acceleration_1h:current&&lags[0]&&lags[1]?current.v-2*lags[0].v+lags[1].v:null,
 percentile_72h:current&&history.length>=24?100*history.filter(r=>r.v<=current.v).length/history.length:null,...rainfall,discharge:current?numeric(current.flow_rate):null};
 if(features.percentile_72h===null)issues.push('INSUFFICIENT_PERCENTILE_HISTORY');
 return {observed_at:latest.observed_at,feature_time:kst(t),features,quality:{status:issues.length?'INCOMPLETE':'FRESH',issues,rainfall_coverage:{required_hours:24,available_hours:24-missingRain.length,missing_hours:missingRain.map(kst),ending_at:kst(t)},rainfall_distance_km:distance,forecast_features:'EXCLUDED_WITHOUT_ARCHIVED_AVAILABILITY_EVIDENCE'}};
}
module.exports={featureSnapshot,numeric,kst};
