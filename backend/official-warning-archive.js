'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const PAST='https://www.hrfco.go.kr/flood/downloadPastCSV.do',CURRENT='https://www.hrfco.go.kr/flood/downloadCurrentCSV.do';
const clean=s=>String(s||'').replace(/\s+/g,'').replaceAll('지점','');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function csv(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=c;}row.push(field);if(row.some(Boolean))rows.push(row);return rows;}
function archiveRows(past,current,metadata,now=Date.now(),firstYear){
 const year=new Date(now+9*3600000).getUTCFullYear(),startYear=firstYear??year-2,rows=[];const errors=[];
 for(const [text,isCurrent] of [[past,false],[current,true]])for(const r of csv(text)){
  if(r.length<(isCurrent?3:4))continue;const at=isCurrent?r[1]:r[2];
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(at)||Number(at.slice(0,4))<startYear||Number(at.slice(0,4))>year)continue;
  const station=isCurrent?r[2]:r[1],matches=metadata.filter(m=>clean(m.obsnm).length>3&&clean(station).includes(clean(m.obsnm)));
  if(matches.length!==1){errors.push('AMBIGUOUS_ARCHIVE_STATION');continue;}
  const number=r[0].match(/(20\d\d)\s*-\s*(\d+)/);if(!number||number[1]!==at.slice(0,4)){errors.push('INVALID_BULLETIN_YEAR');continue;}
  rows.push({station_code:String(matches[0].wlobscd),issued_at:at+':00',kind:isCurrent?r[2]:r[3],bulletin:r[0],number:Number(number[2]),year:Number(number[1])});
 }
 const sequences={};for(let y=startYear;y<=year;y++){const numbers=new Set(rows.filter(r=>r.year===y).map(r=>r.number));const max=Math.max(0,...numbers);const missing=Array.from({length:max},(_,i)=>i+1).filter(n=>!numbers.has(n));sequences[y]={count:numbers.size,max,missing};if(!max||missing.length)errors.push('INCOMPLETE_YEAR_NUMBER_SEQUENCE_'+y);}
 return {rows,errors:[...new Set(errors)],sequences};
}
function reviewArchive({past,current,metadata,events,now=Date.now(),firstYear}){
 const parsed=archiveRows(past,current,metadata,now,firstYear);const errors=[...parsed.errors];
 for(const row of parsed.rows){row.matches=events.filter(e=>String(e.station_code)===row.station_code&&e.issued_at===row.issued_at);if(row.matches.length!==1)errors.push('MISSING_OR_AMBIGUOUS_TYPED_EVENT');else if((row.kind.includes('해제'))!==(row.matches[0].action==='CANCEL'))errors.push('ARCHIVE_ACTION_MISMATCH');}
 const codes=new Set(parsed.rows.map(r=>r.station_code)),startYear=firstYear??new Date(now+9*3600000).getUTCFullYear()-2;
 if(events.some(e=>codes.has(String(e.station_code))&&e.issued_at>=startYear+'-01-01'&&e.issued_at<=new Date(now+9*3600000).toISOString().slice(0,19).replace('T',' ')&&!parsed.rows.some(r=>r.station_code===String(e.station_code)&&r.issued_at===e.issued_at)))errors.push('API_EVENTS_MISSING_FROM_PUBLIC_ARCHIVE');
 const coverage=[];if(!errors.length)for(const station_code of codes){const rows=parsed.rows.filter(r=>r.station_code===station_code).sort((a,b)=>a.issued_at.localeCompare(b.issued_at));const anchor=rows.find(r=>r.kind.includes('해제')&&r.matches[0].action==='CANCEL');if(!anchor)continue;
  coverage.push({station_code,start_at:anchor.issued_at,end_at:new Date(now+9*3600000).toISOString().slice(0,19).replace('T',' '),status:'COMPLETE',initial_state:'NONE',reviewed_complete:true,source_url:PAST,evidence:JSON.stringify({scope:'HAN_PUBLISHED_WARNING_ARCHIVE_ONLY',basis:'Continuous yearly bulletin numbering; every recent CSV row uniquely station-matched and bidirectionally reconciled with typed API events; initial NONE anchored to an explicit all-warning cancellation.',anchor_event_id:anchor.matches[0].event_id,anchor_kind:anchor.kind,past_url:PAST,current_url:CURRENT,past_sha256:hash(past),current_sha256:hash(current),rows_reconciled:parsed.rows.length,sequences:parsed.sequences})});
 }
 return {generated_at:new Date(now).toISOString(),status:errors.length?'REVIEW_REQUIRED':'RECONCILED',records:parsed.rows.length,station_codes:[...codes],coverage,errors:[...new Set(errors)],sequences:parsed.sequences};
}
let metadataCache=null,pending=null;
async function fetchText(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('ARCHIVE_HTTP_'+r.status);const bytes=await r.arrayBuffer();let text=new TextDecoder('utf-8').decode(bytes);if(text.includes('�'))text=new TextDecoder('euc-kr').decode(bytes);return text;}
async function run(db=require('./db')){
 const [past,current]=await Promise.all([fetchText(PAST),fetchText(CURRENT)]);
 if(!metadataCache||Date.now()-metadataCache.at>24*3600000){const key=require('./hrfco-fetch-history').configuredKey(process.env.HRFCO_SERVICE_KEY);if(!/^[a-zA-Z0-9-]{20,120}$/.test(key))throw Error('HRFCO_KEY_UNAVAILABLE');const r=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(key)}/waterlevel/info.json`,{signal:AbortSignal.timeout(15000)});const data=await r.json();if(!Array.isArray(data.content))throw Error('OFFICIAL_METADATA_UNAVAILABLE');metadataCache={at:Date.now(),rows:data.content};}
 // Import newly published typed notices before checking the CSV archive, so an
 // API notice ahead of the CSV immediately prevents a false no-warning state.
 try{const key=require('./hrfco-fetch-history').configuredKey(process.env.HRFCO_SERVICE_KEY);const r=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(key)}/fldfct/list.json`,{signal:AbortSignal.timeout(15000)});const d=await r.json();if(Array.isArray(d.content))await require('./hrfco-warning-history').importResponse(db,d);}catch{/* Never interpret an unavailable or 990 response as an absence of warnings. */}
 let [events]=await db.query("SELECT station_code,issued_at,severity,action,event_id FROM hr_flood_warning_history WHERE issued_at>=CONCAT(YEAR(UTC_TIMESTAMP()+INTERVAL 9 HOUR)-2,'-01-01')");
 const parsed=archiveRows(past,current,metadataCache.rows);const dates=[...new Set(parsed.rows.filter(r=>!events.some(e=>String(e.station_code)===r.station_code&&e.issued_at===r.issued_at)).map(r=>new Date(Date.parse(r.issued_at.slice(0,10))+86400000).toISOString().slice(0,10).replaceAll('-','')))];
 if(dates.length){for(let i=0;i<dates.length;i+=60)await require('./advanced-hrfco-import').importHistoricalDays(dates.slice(i,i+60),{db});[events]=await db.query("SELECT station_code,issued_at,severity,action,event_id FROM hr_flood_warning_history WHERE issued_at>=CONCAT(YEAR(UTC_TIMESTAMP()+INTERVAL 9 HOUR)-2,'-01-01')");}
 const result=reviewArchive({past,current,metadata:metadataCache.rows,events});
 if(result.errors.length){const [old]=await db.execute("SELECT coverage_id,evidence FROM ml_source_coverage WHERE source_url=? AND status='COMPLETE'",[PAST]);for(const row of old){let evidence;try{evidence=typeof row.evidence==='string'?JSON.parse(row.evidence):row.evidence;}catch{continue;}if(evidence?.scope==='HAN_PUBLISHED_WARNING_ARCHIVE_ONLY'){evidence.live_status_blocked=true;await db.execute('UPDATE ml_source_coverage SET evidence=? WHERE coverage_id=?',[JSON.stringify(evidence),row.coverage_id]);}}}
 for(const raw of result.coverage){const c=require('./advanced-hrfco-import').validateCoverage(raw);const id=hash(['published-Han-archive-v1',c.station_code,c.start_at].join('|'));await db.execute("INSERT INTO ml_source_coverage(coverage_id,station_code,start_at,end_at,status,initial_state,source_url,evidence,checked_at) VALUES(?,?,?,?,'COMPLETE','NONE',?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE end_at=VALUES(end_at),evidence=VALUES(evidence),checked_at=VALUES(checked_at)",[id,c.station_code,c.start_at,c.end_at,c.source_url,c.evidence]);}
 const dir=path.join(__dirname,'reports');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'official-warning-archive-review.json'),JSON.stringify(result,null,2));return result;
}
function refresh(db){if(pending)return pending;pending=run(db).finally(()=>pending=null);return pending;}
function start(){const tick=()=>refresh().catch(e=>console.warn('[official archive]',e.code||e.name));void tick();const timer=setInterval(tick,10*60000);timer.unref();return timer;}
if(require.main===module){require('dotenv').config();const db=require('./db');refresh(db).then(r=>console.log(JSON.stringify({status:r.status,records:r.records,coverage:r.coverage.length,errors:r.errors}))).catch(e=>{console.error(e.code||e.name);process.exitCode=1;}).finally(()=>db.end());}
module.exports={csv,archiveRows,reviewArchive,refresh,start};
