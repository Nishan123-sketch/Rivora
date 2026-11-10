'use strict';
// Database evidence is rendered deterministically; a language model cannot invent facts.
const {resolvePlaces}=require('./place-resolver');
const {englishStationName}=require('./display-names');
const {timeRequest}=require('./chat-context');
const {millis}=require('./monitoring-store');
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
// Public catalog only; conversation context is never cached or shared.
const stationCatalogCache=new WeakMap();
function intent(q,previous=[]){
 q=require('./assistant-language').normalizeQuestion(q);
 if(/(?:trapped|stranded|water entering|swept away|drowning|고립|물에 갇|익사)/i.test(q))return 'emergency';
 if(require('./assistant-identity').identityAnswer(q))return 'identity';
 if(require('./assistant-identity').projectAnswer(q))return 'project';
 if(!/current|today|now|status|latest|현재|지금/i.test(q)&&/(?:what (?:is|does)|explain|meaning|means|difference|무슨 뜻|설명).*(?:\badvisory\b|\bwarning\b|\bthreshold\b|\bridge\b|\bmae\b|\brmse\b|flood probability|경보|주의보)/i.test(q))return 'explain';
 if(/how (?:does|can) rivora (?:work|help)|what (?:is rivora|can rivora do|are rivora.s features)|rivora features|system status|시스템 상태/i.test(q))return 'project';
 if(/highest.*(?:rise|rising)|which ones|what.*happening/i.test(q))return 'data';
 if(/\b(?:find|search)\b|\b\d{7}\b|which station.*(?:discuss|talk)|how many.*rivers/i.test(q))return 'data';
 if(/\b(?:weather|temperature|rain(?:fall)?|wind|humidity|flood(?:ing)?|risk|safe|river|bridge|water level|forecast(?:s|ing)?|prediction(?:s)?|model|mae|rmse|warning(?:s)?|station(?:s)?|history|historical|yesterday|tomorrow)\b|날씨|기온|강우|비가|풍속|바람|홍수|수위|예보|경보|어제|내일/i.test(q))return 'data';
 if(/there|that|same|next|그곳|거기/i.test(q)&&previous.some(m=>m.role==='user'&&intent(m.content)==='data'))return 'data';
 return 'casual';
}
function freshness(at,now=Date.now()){
 const t=millis(at);return !Number.isFinite(t)?'MISSING':t>now?'FUTURE':now-t>3*3600000?'STALE':'FRESH';
}
function evidence(station,metric,value,unit,at,source,now=Date.now(),extra={}){
 const invalid=finite(value)&&(/rain|wind|humidity|probability/.test(metric)&&Number(value)<0||/humidity|probability/.test(metric)&&Number(value)>100),valid=finite(value)&&!invalid;
 return {status:invalid?'INVALID':valid?'AVAILABLE':'MISSING',evidence_type:'OBSERVATION',station_id:station.station_id,station_name:englishStationName(station.station_name,station.external_station_id),metric,value:valid?Number(value):null,unit,observed_at:at?String(at).replace(' ','T')+(/Z$|[+-]\d\d:\d\d$/.test(String(at))?'':'+09:00'):null,issued_at:null,valid_at:null,retrieved_at:new Date(now).toISOString(),source,freshness:freshness(at,now),missing_fields:valid?[]:[metric],limitations:invalid?['Invalid measurement range']:[],...extra};
}
function riverSource(url){try{const host=new URL(url).hostname;if(/(?:^|\.)wamis\.go\.kr$/.test(host))return 'WAMIS';if(/(?:^|\.)(?:hrfco|nakdongriver|geumriver|yeongsanriver)\.go\.kr$/.test(host))return 'Official flood-control office';}catch{}return 'Stored river observation';}
function render(e,korean=false){
 const label={temperature_forecast:'Forecast temperature',rainfall_forecast:'Forecast rainfall',wind_speed_forecast:'Forecast wind',precipitation_probability:'Rain chance',humidity_forecast:'Forecast humidity',water_level:korean?'수위':'Water level',temperature:korean?'기온':'Temperature',hourly_rainfall:korean?'시간 강우량':'Hourly rainfall',wind_speed:korean?'풍속':'Wind speed',humidity:korean?'습도':'Humidity'}[e.metric]||e.metric;
 if(e.status!=='AVAILABLE')return `${label}: ${korean?'자료 없음':'not available'}.`;
 return `${label}: **${e.value} ${e.unit}** · ${e.station_name} · ${e.observed_at||e.valid_at} · ${e.source}${e.freshness==='FRESH'?'':` · ${e.freshness} (${korean?'현재 관측 아님':'not a current observation'})`}.`;
}
async function answer(q,{stationId,previous=[],language='auto',db=require('./db'),now=Date.now(),signal,getUnified=require('./risk-engine').getUnified}={}){
 q=require('./assistant-language').normalizeQuestion(q);
 const identity=require('./assistant-identity').identityAnswer(q);
 if(identity&&intent(q)!=='emergency')return {answer:identity,mode:'PROJECT_IDENTITY',intent:'identity',developer:'Nishan',evidence:[],station_ids:[],tools:[],retrieved_at:new Date(now).toISOString()};
 previous=previous.map(m=>m.role==='user'?{...m,content:require('./assistant-language').normalizeQuestion(m.content)}:m);
 const recalled=require('./assistant-recall').recall(q,previous);
 if(recalled)return {answer:recalled,mode:'CONVERSATION_RECALL',evidence:[],station_ids:[],tools:[],retrieved_at:new Date(now).toISOString()};
 q=require('./assistant-followups').contextualQuestion(q,previous);
 const memory=require('./assistant-followups').conversationState(previous),choice=require('./assistant-followups').candidateChoice(q,memory.candidates||[]);
 const type=(choice.candidate||choice.needs_clarification||choice.rejected)?'data':intent(q,previous),ko=language!=='en'&&/[가-힣]/.test(q),base={mode:'DATABASE_GROUNDED',retrieved_at:new Date(now).toISOString(),station_ids:[],evidence:[],tools:[],intent:type,interpretation:require('./assistant-followups').interpret(q)};
 if(type==='emergency'){const guidance=require('./config/assistant-emergency.json');return {...base,mode:'EMERGENCY_GUIDANCE',guidance_source:{authority:guidance.authority,source_url:guidance.source_url,reviewed_at:guidance.reviewed_at},answer:ko?guidance.ko:guidance.en};}
 if(type==='explain')return {...base,mode:'EXPLANATION',answer:ko?'주의보와 경보 기준은 관측소마다 다릅니다. 수위를 기준과 비교한 결과는 정부가 발령한 경보와 다릅니다. MAE는 예측값의 평균 절대 오차입니다. 실험적 수위 예측은 홍수 발생 확률이 아닙니다.':require('./assistant-concepts').explain(q)};
 if(type==='project')return {...base,mode:'PROJECT_GUIDANCE',tools:['verified_project_knowledge'],knowledge:require('./assistant-identity').KNOWLEDGE,answer:require('./assistant-identity').projectAnswer(q)||'Rivora monitors recorded weather and river conditions. What would you like to know about its features or data sources?'};

 if(/which ones/i.test(q)&&Array.isArray(memory.rivers))return {...base,session_context:memory,tools:['prior_verified_river_catalog'],answer:'The rivers in that result are '+memory.rivers.map(r=>r.name).join(', ')+'. This is the previously retrieved catalog result, not a new live-coverage assessment.'};
 if(type==='casual')return null;
 if(choice.rejected)return {...base,status:'NEEDS_CLARIFICATION',session_context:{candidates:[]},answer:'Which station name or official station code should I look for?'};
 const query=async(sql,p=[])=>{signal?.throwIfAborted();const [rows]=await db.execute(sql,p);signal?.throwIfAborted();return rows;};
 if(/highest.*(?:rise|rising)/i.test(q)){
  const rows=(await getUnified()).filter(r=>r.data_status==='FRESH'&&freshness(r.observed_at,now)==='FRESH'&&finite(r.rise_1h)&&r.rise_1h>0&&Number(r.rise_interval_1h_minutes)===60).sort((a,b)=>b.rise_1h-a.rise_1h);
  const r=rows[0];if(!r)return {...base,tools:['rank_verified_level_changes'],answer:'No comparable fresh positive 60-minute rises are available in the monitored dataset. This does not establish safety.'};
  return {...base,tools:['rank_verified_level_changes'],station_ids:[r.station_id],session_context:{station_id:r.station_id,station_code:r.external_station_id,candidates:[],subject:'river water level'},evidence:[evidence(r,'water_level_change',r.rise_1h,'m',r.observed_at,r.observation_source_url||'Stored river observations',now)],answer:`Among available fresh 60-minute comparisons, ${englishStationName(r.station_name,r.external_station_id)} has the largest positive rise: +${Number(r.rise_1h).toFixed(2)} m, ending ${r.observed_at} KST. This ranks measured changes, not flood danger.`};
 }
 if(/how many.*rivers/i.test(q)&&/ulsan|울산/i.test(q)){
  const catalog=require('./river-network-registry').getCatalog().filter(r=>r.region_id==='ulsan');
  const ids=catalog.map(r=>r.river_id);
  const linked=ids.length?await query("SELECT DISTINCT river_id FROM river_gauge_links WHERE verification_status='VERIFIED' AND river_id IN ("+ids.map(()=>'?').join(',')+")",ids):[];
  const rivers=catalog.filter(r=>linked.some(l=>l.river_id===r.river_id));
  return {...base,session_context:{rivers:rivers.map(r=>({id:r.river_id,name:r.name_en})),region:'Ulsan'},tools:['verified_river_catalog'],river_count:rivers.length,answer:`Rivora has verified gauge links for ${rivers.length} cataloged Ulsan rivers: ${rivers.map(r=>r.name_en).join(', ')||'none'}. This counts rivers, not gauges, and does not imply every gauge is currently live. Nationwide entries without verified Ulsan region attribution are outside this count.`};
 }
 const cached=stationCatalogCache.get(db);
 const stations=cached&&now>=cached.at&&now-cached.at<60000?cached.rows:await query("SELECT station_id,station_name,external_station_id,data_source,latitude,longitude FROM stations WHERE data_source='KMA' OR EXISTS (SELECT 1 FROM flood_thresholds f WHERE f.station_id=stations.station_id AND f.verification_status='VERIFIED')");
 if(stations!==cached?.rows)stationCatalogCache.set(db,{at:now,rows:stations});
 let selected=stationId?stations.find(s=>String(s.station_id)===String(stationId)):null;
 const resolve=text=>resolvePlaces(text,stations.map(s=>({...s,aliases:[englishStationName(s.station_name,s.external_station_id)]})));
 const remembered=stations.find(s=>memory.station_id!=null&&String(s.station_id)===String(memory.station_id)||memory.station_code!=null&&String(s.external_station_id)===String(memory.station_code));
 if(!selected&&choice.candidate)selected=stations.find(s=>String(s.station_id)===String(choice.candidate.station_id)||String(s.external_station_id)===String(choice.candidate.station_code));
 let candidates=choice.needs_clarification?(memory.candidates||[]).map(c=>stations.find(s=>String(s.station_id)===String(c.station_id)||String(s.external_station_id)===String(c.station_code))).filter(Boolean).map(s=>({station_id:s.station_id,station_code:s.external_station_id,station_name:s.station_name,confidence:1})):resolve(q);
 const inherits=require('./assistant-followups').inheritsLocation(q);
 if(!selected&&!choice.needs_clarification&&remembered&&inherits&&!candidates.some(c=>c.confidence>=.95))selected=remembered;
 if(!selected&&!choice.needs_clarification&&!candidates.length&&inherits)for(const m of [...previous].reverse().filter(m=>m.role==='user')){candidates=resolvePlaces(m.content,stations.map(s=>({...s,aliases:[englishStationName(s.station_name,s.external_station_id)]})));if(candidates.length)break;}
 if(!selected&&!choice.needs_clarification&&candidates[0]?.confidence>=0.95&&(!candidates[1]||candidates[0].confidence-candidates[1].confidence>0.05))selected=stations.find(s=>s.station_id===candidates[0].station_id);
 base.tools.push('resolve_location');
 if(!selected){const relevant=candidates.filter(c=>c.confidence>=Math.max(.7,(candidates[0]?.confidence||0)-.1)).map(c=>({...c,station_name:englishStationName(c.station_name,c.station_code)}));return {...base,status:'NEEDS_CLARIFICATION',candidates:relevant,session_context:{candidates:relevant,pending_question:memory.pending_question||q},answer:'Which monitoring station do you mean?'+(relevant.length?'\n'+relevant.map((c,i)=>`${i+1}. ${c.station_name} [station code ${c.station_code}]`).join('\n'):' Please provide its name or official station code.')};}
 base.session_context={station_id:selected.station_id,station_code:selected.external_station_id,candidates:[],subject:require('./assistant-followups').subject(q)||memory.subject||'',pending_question:null};
 if(choice.candidate)q=memory.pending_question||'current water level';
 base.station_ids=[selected.station_id];const id=selected.station_id;let weather=selected;
 if(selected.data_source!=='KMA'){const nearest=require('./geo').nearest(selected,stations.filter(s=>s.data_source==='KMA'));weather=nearest?.distance_km<=30?nearest:null;}
 if(/which station.*(?:discuss|talk)|^(?:find|search)\b/i.test(q))return {...base,answer:`We are discussing ${englishStationName(selected.station_name,selected.external_station_id)} [station code ${selected.external_station_id}]. What would you like to check: water level, rainfall, history or forecasts?`};
 if(/compare/i.test(q)&&remembered&&Number(remembered.station_id)!==Number(selected.station_id)){
  const ids=[remembered,selected];const readings=await Promise.all(ids.map(s=>query('SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[s.station_id])));
  const evidenceRows=ids.map((s,i)=>evidence(s,'water_level',readings[i][0]?.water_level??null,'m',readings[i][0]?.observed_at,riverSource(readings[i][0]?.source_url),now));
  return {...base,station_ids:ids.map(s=>s.station_id),session_context:{...base.session_context,compared_station_ids:ids.map(s=>s.station_id)},tools:['compare_station_observations'],evidence:evidenceRows,answer:evidenceRows.map(e=>render(e,ko)).join('\n\n')+'\n\nThese gauges can use different vertical datums and local reference levels. I cannot subtract their absolute levels to infer relative danger without compatible datum evidence.'};
 }
 if(/(?:official|confirmed).*warnings?/i.test(q)&&!/yesterday|history|historical/i.test(q)){
  const code=String(selected.external_station_id);
  const [coverage,events]=await Promise.all([query('SELECT * FROM ml_source_coverage WHERE station_code=? ORDER BY end_at DESC LIMIT 4',[code]),query('SELECT * FROM hr_flood_warning_history WHERE station_code=? ORDER BY issued_at DESC LIMIT 100',[code])]);
  const official=require('./warning-timeline').currentOfficial(events,coverage,now);
  return {...base,tools:['get_official_warning'],official_warning:official,answer:`${englishStationName(selected.station_name,selected.external_station_id)} (station ${code}): official warning status is ${official.status}. `+(official.status==='UNKNOWN'?'Fresh complete official coverage is unavailable; I cannot confirm either a warning or its absence.':`Source: HRFCO; coverage through ${official.as_of} KST. This reports official issuance status, not physical safety.`)};
 }
 if(/compar(?:e|ison).*another (?:river|station)/i.test(q))return {...base,status:'NEEDS_CLARIFICATION',answer:'Which second station or official station code should I compare with '+englishStationName(selected.station_name,selected.external_station_id)+'?'};
 if(/(?:ris(?:e|en)|changed?|trend|fall).*(?:six|6|three|3|hour)|(?:six|6|three|3).*(?:hour).*(?:rise|change)/i.test(q)){
  const h=/six|6/.test(q)?6:/three|3/.test(q)?3:1;
  const latestRows=await query('SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[id]);const latest=latestRows[0];
  if(!latest||freshness(latest.observed_at,now)!=='FRESH'||!finite(latest.water_level))return {...base,tools:['get_level_change'],answer:'A fresh measured water level is unavailable for this comparison.'};
  const at=millis(latest.observed_at)-h*3600000,kst=t=>new Date(t+9*3600000).toISOString().slice(0,19).replace('T',' ');
  const older=await query('SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at DESC LIMIT 1',[id,kst(at-15*60000),kst(at)]);const prior=older[0];
  if(!prior||!finite(prior.water_level))return {...base,tools:['get_level_change'],answer:'The earlier observation needed for that change is missing. I will not interpolate a level.'};
  const delta=Number(latest.water_level)-Number(prior.water_level),minutes=(millis(latest.observed_at)-millis(prior.observed_at))/60000;
  return {...base,tools:['get_level_change'],evidence:[evidence(selected,'water_level',latest.water_level,'m',latest.observed_at,riverSource(latest.source_url),now),evidence(selected,'water_level',prior.water_level,'m',prior.observed_at,riverSource(prior.source_url),now,{evidence_type:'HISTORICAL_OBSERVATION'})],answer:`${englishStationName(selected.station_name,selected.external_station_id)} changed by ${delta>=0?'+':''}${delta.toFixed(2)} m over ${minutes} minutes, from ${prior.water_level} m at ${prior.observed_at} KST to ${latest.water_level} m at ${latest.observed_at} KST. These are measured endpoints, not a forecast.`};
 }
 const temporal=timeRequest(q,new Date(now)),historical=/history|historical|yesterday|어제/i.test(q)||temporal.explicit&&temporal.date<new Date(now+9*3600000).toISOString().slice(0,10);
 const parts=[`### ${englishStationName(selected.station_name,selected.external_station_id)} [station code ${selected.external_station_id}]`];
 if(/model|mae|rmse|accuracy|why.*predict|explain.*predict|모델|오차/i.test(q)){
  base.tools.push('explain_prediction');const rows=await query("SELECT model_version,created_at,report FROM ml_model_versions WHERE station_id=? AND prediction_type='RIVER_LEVEL' ORDER BY created_at DESC LIMIT 1",[id]);
  // Registry report shape differs by model version; present saved evidence, not invented feature weights.
  let report=rows[0]?.report;try{if(typeof report==='string')report=JSON.parse(report);}catch{report=null;}
  if(report){base.model_report={model_version:rows[0].model_version,created_at:rows[0].created_at,report};parts.push('A saved station model report is available. Its chronological holdout metrics describe water-level error, not flood-event accuracy.');for(const h of report.horizons||[]){const m=h.holdout?.chosen_method==='PERSISTENCE'?h.holdout?.persistence:h.holdout?.model;if(m&&finite(m.mae_m))parts.push(`+${h.horizon_hours}h · ${h.model_kind||'saved model'} · MAE ${Number(m.mae_m)} m${finite(m.rmse_m)?`; RMSE ${Number(m.rmse_m)} m`:''}.`);}}else parts.push('No saved station model evaluation is available. I cannot provide an accuracy percentage or feature contributions.');
  return {...base,answer:parts.join('\n\n')};
 }
 if(temporal.at&&millis(temporal.at)<=now){
  base.tools.push('get_history');
  const rows=await query('SELECT observed_at,water_level FROM water_readings WHERE station_id=? AND observed_at=? LIMIT 1',[id,temporal.at]);
  if(rows[0])base.evidence.push(evidence(selected,'water_level',rows[0].water_level,'m',rows[0].observed_at,'WAMIS',now,{evidence_type:'HISTORICAL_OBSERVATION'}));
  if(weather){const met=await query('SELECT observed_at,temperature,hourly_rainfall,wind_speed,humidity FROM weather_readings WHERE station_id=? AND observed_at=? LIMIT 1',[weather.station_id,temporal.at]);if(met[0])for(const [metric,unit]of [['temperature','°C'],['hourly_rainfall','mm'],['wind_speed','m/s']])base.evidence.push(evidence(weather,metric,met[0][metric],unit,met[0].observed_at,'KMA',now,{evidence_type:'HISTORICAL_OBSERVATION'}));}
  return {...base,answer:parts.concat(base.evidence.length?base.evidence.map(e=>render(e,ko)):[`No observation matches ${temporal.at} KST exactly.`]).join('\n\n')};
 }
 if(historical){
  base.tools.push('get_history');const start=temporal.date+' 00:00:00',end=new Date(Date.parse(temporal.date)+86400000).toISOString().slice(0,10)+' 00:00:00';
  if(/warning|advisory|경보|주의보/i.test(q)){
   base.tools.push('get_official_warning');const records=await query('SELECT issued_at,action,severity,source FROM hr_flood_warning_history WHERE station_code=? AND issued_at>=? AND issued_at<? ORDER BY issued_at LIMIT 100',[String(selected.external_station_id),start,end]);
   base.warning_history=records;parts.push(`${temporal.date} KST · stored official bulletin history.`);
   for(const r of records)parts.push(`${r.issued_at} KST · ${r.action} · ${r.severity} · ${r.source||'HRFCO'}`);
   if(!records.length)parts.push('No bulletin is stored for this date. The archive is incomplete; this does not establish that no warning was issued.');
   return {...base,answer:parts.join('\n\n')};
  }
  const rows=await query('SELECT observed_at,water_level FROM water_readings WHERE station_id=? AND observed_at>=? AND observed_at<? ORDER BY observed_at LIMIT 1500',[id,start,end]);
  const values=rows.filter(r=>finite(r.water_level));parts.push(temporal.date+' KST');
  if(values.length){const nums=values.map(r=>Number(r.water_level));parts.push(`${nums.length} recorded water readings. Minimum ${Math.min(...nums)} m; maximum ${Math.max(...nums)} m; mean ${(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(3)} m.`);base.evidence=values.map(r=>evidence(selected,'water_level',r.water_level,'m',r.observed_at,'WAMIS',now,{evidence_type:'HISTORICAL_OBSERVATION'}));}
  if(weather){const met=await query('SELECT observed_at,temperature,hourly_rainfall,wind_speed FROM weather_readings WHERE station_id=? AND observed_at>=? AND observed_at<? ORDER BY observed_at LIMIT 1500',[weather.station_id,start,end]);for(const [metric,unit]of [['temperature','°C'],['wind_speed','m/s']]){const valid=met.filter(r=>finite(r[metric]));if(valid.length){const nums=valid.map(r=>Number(r[metric]));parts.push(`${metric}: minimum ${Math.min(...nums)} ${unit}; maximum ${Math.max(...nums)} ${unit}; ${nums.length} readings at ${englishStationName(weather.station_name)}.`);base.evidence.push(...valid.map(r=>evidence(weather,metric,r[metric],unit,r.observed_at,'KMA',now,{evidence_type:'HISTORICAL_OBSERVATION'})));}}}
  if(!base.evidence.length)parts.push('No stored observations for this date.');return {...base,answer:parts.join('\n\n')};
 }

 const future=/forecast|prediction|tomorrow|next|week|예보|내일|\bwill\b.*(?:rain|wind|weather|flood)/i.test(q)||temporal.at&&millis(temporal.at)>now;
 if(future){
  if(/river|level|flood|수위|홍수/i.test(q)){base.tools.push('get_water_level_prediction');const rows=await query("SELECT * FROM ml_advanced_predictions WHERE station_id=? AND prediction_type='RIVER_LEVEL' AND valid_at>? AND issued_at<=? AND valid_at<? ORDER BY issued_at DESC LIMIT 18",[id,new Date(Math.max(now,temporal.explicit?millis(temporal.at||temporal.date+' 00:00:00'):now)+9*3600000).toISOString().slice(0,19).replace('T',' '),new Date(now+9*3600000).toISOString().slice(0,19).replace('T',' '),new Date((temporal.explicit?Date.parse(temporal.date)+86400000:now+7*86400000+9*3600000)).toISOString().slice(0,19).replace('T',' ')]);const seen=new Set();for(const r of rows){if(seen.has(r.horizon_hours)||!finite(r.prediction_value)||r.quality_status!=='FRESH'||freshness(r.observed_at,now)!=='FRESH')continue;seen.add(r.horizon_hours);const e=evidence(selected,'water_level_forecast',r.prediction_value,'m',null,'Rivora experimental model',now,{evidence_type:'EXPERIMENTAL_FORECAST',status:'AVAILABLE',freshness:'FRESH',issued_at:r.issued_at,valid_at:r.valid_at,model_version:r.model_version});base.evidence.push(e);parts.push(`+${r.horizon_hours}h: ${e.value} m · valid ${r.valid_at} KST · experimental.`);}if(/week|7.day|7일|일주일/i.test(q))parts.push('Seven-day river forecasts are not supported; only saved short-horizon predictions can be shown.');parts.push(seen.size?'These are experimental level forecasts, not flood probabilities or issued warnings.':'No fresh saved level prediction is available. Seven-day river forecasts are not supported.');
  }else if(/week|7.day|7일|일주일/i.test(q)){
   base.tools.push('get_weather_forecast');let rows=[];if(weather){try{rows=await query('SELECT fetched_at,payload FROM weekly_weather_snapshots WHERE station_id=? LIMIT 1',[weather.station_id]);}catch{parts.push('Stored seven-day forecast source is unavailable.');}}
   let payload=rows[0]?.payload;try{if(typeof payload==='string')payload=JSON.parse(payload);}catch{payload=null;}
   const fetched=payload?.fetched_at?Date.parse(payload.fetched_at):NaN;
   if(payload&&Number.isFinite(fetched)&&now-fetched>=0&&now-fetched<6*3600000){for(const d of (payload.days||[]).slice(0,7)){parts.push(`${d.date}: ${finite(d.low)?d.low:'unavailable'}–${finite(d.high)?d.high:'unavailable'} °C; rain chance ${finite(d.rain_chance)?d.rain_chance+'%':'unavailable'}.`);for(const [metric,value,unit]of [['minimum_temperature_forecast',d.low,'°C'],['maximum_temperature_forecast',d.high,'°C'],['precipitation_probability',d.rain_chance,'%']])base.evidence.push(evidence(weather,metric,value,unit,null,payload.provider||'Open-Meteo',now,{evidence_type:'WEATHER_FORECAST',freshness:'FRESH',issued_at:payload.fetched_at,valid_at:d.date+'T00:00:00+09:00'}));}parts.push('Stored daily weather forecast, not a river-level forecast.');}else parts.push('No fresh stored seven-day weather forecast is available. Chat does not generate missing forecasts.');
  }else{
   base.tools.push('get_weather_forecast');
   const rows=weather?await query('SELECT issued_at,valid_at,temperature_forecast,rainfall_forecast,wind_speed_forecast,humidity_forecast,precipitation_probability,source FROM weather_forecasts WHERE station_id=? AND valid_at>=? AND issued_at=(SELECT MAX(issued_at) FROM weather_forecasts WHERE station_id=?) ORDER BY valid_at LIMIT 24',[weather.station_id,temporal.at||temporal.date+' 00:00:00',weather.station_id]):[];
   const wanted=/wind|풍속|바람/i.test(q)?[['wind_speed_forecast','m/s']]:/rain|강우|강수/i.test(q)?[['rainfall_forecast','mm'],['precipitation_probability','%']]:[['temperature_forecast','°C'],['rainfall_forecast','mm'],['precipitation_probability','%']];
   for(const r of rows.slice(0,8))for(const [metric,unit]of wanted){const age=now-millis(r.issued_at),quality=age<0?'FUTURE':age>12*3600000?'STALE':'FRESH';const e=evidence(weather,metric,r[metric],unit,null,r.source||'KMA',now,{evidence_type:'WEATHER_FORECAST',issued_at:String(r.issued_at).replace(' ','T')+'+09:00',valid_at:String(r.valid_at).replace(' ','T')+'+09:00',freshness:quality});base.evidence.push(e);parts.push(render(e,ko));}
   if(rows.length>8)parts.push('Showing the first eight stored forecast hours for this request.');
   if(!rows.length)parts.push('No stored weather forecast is available for this location and time.');
  }

  return {...base,answer:parts.join('\n\n')};
 }
 const waterOnly=/water level|river level/i.test(q)&&!/rain|weather|wind|humidity|flood|risk/i.test(q);
 base.tools.push('get_latest_readings');
 const water=selected.data_source!=='KMA'?await query('SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[id]):[];
 const met=weather&&!waterOnly?await query('SELECT observed_at,temperature,hourly_rainfall,wind_speed,humidity FROM weather_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[weather.station_id]):[];
 if(!waterOnly&&!finite(met[0]?.hourly_rainfall)){
  const ownAws=selected.data_source==='KMA';
  const rain=ownAws?await query('SELECT observed_at,hourly_rainfall,aws_station_code FROM aws_rainfall_readings WHERE aws_station_code=? ORDER BY observed_at DESC LIMIT 1',[String(selected.external_station_id)]):await query("SELECT a.observed_at,a.hourly_rainfall,a.aws_station_code FROM station_rainfall_links l JOIN aws_rainfall_readings a ON a.aws_station_code=l.aws_station_code WHERE l.station_id=? AND l.verification_status IN ('VERIFIED','AUTO_NEAREST') ORDER BY a.observed_at DESC LIMIT 1",[id]);
  if(rain[0])base.evidence.push(evidence(selected,'hourly_rainfall',rain[0].hourly_rainfall,'mm',rain[0].observed_at,(ownAws?'KMA AWS ':'Nearby KMA AWS ')+rain[0].aws_station_code,now,{limitations:ownAws?[]:['Nearby rainfall gauge; not measured at the river gauge.']}));
 }
 if(selected.data_source!=='KMA')base.evidence.push(evidence(selected,'water_level',water[0]?.water_level??null,'m',water[0]?.observed_at||null,riverSource(water[0]?.source_url),now));
 for(const [metric,unit]of [['temperature','°C'],['hourly_rainfall','mm'],['wind_speed','m/s'],['humidity','%']])if(met[0]&&(!/wind|풍속|바람/i.test(q)||metric==='wind_speed')){
  if(metric==='hourly_rainfall'&&!finite(met[0][metric])&&base.evidence.some(e=>e.metric===metric&&e.status==='AVAILABLE'))continue;
  base.evidence.push(evidence(weather,metric,met[0][metric],unit,met[0].observed_at,'KMA',now));
 }
 const requested=/wind|풍속|바람/i.test(q)?['wind_speed']:/rain|강우|강수/i.test(q)&&!/flood|risk|홍수/i.test(q)?['hourly_rainfall']:/temp|기온/i.test(q)?['temperature']:/water level|river|flood|risk|수위|홍수/i.test(q)?(waterOnly?['water_level']:['water_level','hourly_rainfall']):null;const visible=requested?base.evidence.filter(e=>requested.includes(e.metric)):base.evidence;parts.push(...visible.map(e=>render(e,ko)));if(!visible.length)parts.push('No observation is stored for this station.');
 if(/risk|flood|warning|safe|홍수|경보/i.test(q)){
  base.tools.push('get_risk_assessment','get_official_warning');const thresholds=await query('SELECT * FROM flood_thresholds WHERE station_id=? LIMIT 1',[id]);
  // Reuse the canonical verified-stage evaluator without its unrelated history queries.
  const stage=require('./risk-engine').evaluate({station:selected,latest:water[0],threshold:thresholds[0],now});
  base.stage_assessment=stage;
  parts.push(`Verified stage comparison: ${stage?.threshold_verified&&stage?.data_status==='FRESH'&&stage.level?stage.level:'not assessable'}. This is not an issued warning.`);
  if(stage?.threshold_verified)parts.push(`Advisory ${stage.advisory_stage_m} m; warning ${stage.warning_stage_m} m. Source: ${stage.source_url}`);
  const coverage=await query("SELECT * FROM ml_source_coverage WHERE station_code=? AND status='COMPLETE' ORDER BY end_at DESC LIMIT 4",[String(selected.external_station_id)]);
  const events=await query('SELECT * FROM hr_flood_warning_history WHERE station_code=? ORDER BY issued_at DESC LIMIT 100',[String(selected.external_station_id)]);
  const official=require('./warning-timeline').currentOfficial(events,coverage,now);base.official_warning=official;parts.push(`Official warning status: ${official.status}. ${official.status==='UNKNOWN'?'Fresh complete official coverage is unavailable; this does not mean no warning.':''}`);
 }
 if(met.length&&weather&&weather.station_id!==id)parts.push('Weather observations are from the named nearby station, not this river gauge.');
 return {...base,answer:parts.join('\n\n')};
}
module.exports={intent,freshness,evidence,render,answer,finite};
