const {millis}=require('./monitoring-store');
const eventOrder=(a,b)=>millis(a.issued_at)-millis(b.issued_at)||(a.action==='ISSUE'?1:0)-(b.action==='ISSUE'?1:0)||(a.severity==='WARNING'?1:0)-(b.severity==='WARNING'?1:0);
function applyEvent(state,event){
 if(event.action==='ISSUE')return event.severity;
 if(event.action==='CANCEL'&&state===event.severity)return 'NONE';
 return state;
}
function timelineState(events,at,initial='UNKNOWN',start=-Infinity){
 return events.filter(e=>millis(e.issued_at)>=start&&millis(e.issued_at)<=at).sort(eventOrder).reduce(applyEvent,initial);
}
function coveringInterval(coverage,t,end=t){return coverage.filter(c=>c.status==='COMPLETE'&&millis(c.start_at)<=t&&millis(c.end_at)>=end&&['NONE','ADVISORY','WARNING'].includes(c.initial_state)).sort((a,b)=>millis(b.start_at)-millis(a.start_at))[0];}
function futureLabel(events,coverage,t,hours=3){
 const end=t+hours*3600000,c=coveringInterval(coverage,t,end);
 let state=c?timelineState(events,t,c.initial_state,millis(c.start_at)):'UNKNOWN';const ongoing=state;
 const future=events.filter(e=>millis(e.issued_at)>t&&millis(e.issued_at)<=end).sort(eventOrder);
 for(const e of future){if(e.action==='ISSUE'&&e.severity!==state)return {label:1,event_id:e.event_id,event_at:e.issued_at,ongoing,reason:'CONFIRMED_NEW_ISSUANCE'};state=applyEvent(state,e);}
 return {label:c?0:null,ongoing,reason:c?'COMPLETE_WARNING_COVERAGE':'UNKNOWN_WARNING_COVERAGE'};
}
function liveBlocked(evidence){
 try{return (typeof evidence==='string'?JSON.parse(evidence):evidence)?.live_status_blocked===true;}catch{return false;}
}
function currentOfficial(events,coverage,now=Date.now()){
 const c=coverage.filter(c=>!liveBlocked(c.evidence)&&c.status==='COMPLETE'&&['NONE','ADVISORY','WARNING'].includes(c.initial_state)&&millis(c.start_at)<=now&&millis(c.end_at)<=now&&now-millis(c.end_at)<=20*60000).sort((a,b)=>millis(b.end_at)-millis(a.end_at))[0];const checked=Date.parse(String(c?.checked_at||'').replace(' ','T')+'Z');
 if(!c||!Number.isFinite(checked)||now-checked<0||now-checked>20*60000)return {status:'UNKNOWN',level:null,reason:'NO_FRESH_COMPLETE_WARNING_COVERAGE'};
 const state=timelineState(events,millis(c.end_at),c.initial_state,millis(c.start_at));
 return {status:state,level:state==='WARNING'?'High':state==='ADVISORY'?'Moderate':null,reason:null,source:'HRFCO',checked_at:c.checked_at,as_of:c.end_at};
}
function prioritize({official,stage,warning,experimental}){
 if(official?.level&&['ADVISORY','WARNING'].includes(official.status))return {level:official.level,source:'Official warning'};
 if(stage?.tier==='A'&&stage?.data_status==='FRESH'&&stage.level)return {level:stage.level==='Severe'?'High':stage.level,source:'Verified flood stage'};
 if(warning?.status==='VALIDATED_WARNING_FORECAST'&&warning.data_quality_status==='FRESH'&&Number.isFinite(warning.probability)&&warning.probability>=0&&warning.probability<=1)return {level:warning.level,source:'ML forecast'};
 if(experimental?.status==='EXPERIMENTAL_GRADE'&&experimental.grade)return {level:experimental.grade,source:'Experimental'};
 return {level:null,source:'No data'};
}
module.exports={applyEvent,timelineState,coveringInterval,futureLabel,currentOfficial,prioritize};
