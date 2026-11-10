'use strict';
function twoStageEvidence(station,t){
 if(t?.verification_status!=='VERIFIED'||!t.verified_at)return null;
 let source;try{source=new URL(t.source_url);}catch{return null;}
 const allowed={'www.nakdongriver.go.kr':['/sumun/brief.do','/sumun/rthd.do'],'www.geumriver.go.kr':['/html/flood/floodPopup.jsp'],'www.yeongsanriver.go.kr':['/','/sumun/waterDetail.do']};
 if(source.protocol!=='https:'||!allowed[source.hostname]?.includes(source.pathname))return null;
 if(source.hostname==='www.yeongsanriver.go.kr'&&source.pathname==='/sumun/waterDetail.do'&&source.searchParams.get('wlobscd')!==String(station.external_station_id))return null;
 const reference=String(t.reference_source||'');
 if(!reference.includes('SCHEME:TWO_STAGE;')||!reference.includes('WAMIS:'+station.external_station_id+';')||!/(?:^|;)DATUM:(?:CONFIRMED|REQUIRES_INDEPENDENT_REVIEW)(?:;|$)/.test(reference))return null;
 const advisory=Number(t.advisory_level_m),warning=Number(t.warning_level_m);
 if(t.advisory_level_m==null||t.warning_level_m==null||!Number.isFinite(advisory)||!Number.isFinite(warning)||advisory>=warning)return null;
 return {advisory,warning,source_url:t.source_url,verified_at:t.verified_at};
}
function compareTwoStage(value,e){return {level:value>=e.warning?'High':value>=e.advisory?'Moderate':'Low',threshold_stage:value>=e.warning?'AT_OR_ABOVE_WARNING':value>=e.advisory?'AT_OR_ABOVE_ADVISORY':'BELOW_ADVISORY',advisory_stage_m:e.advisory,warning_stage_m:e.warning,threshold_scheme:'TWO_STAGE',source_url:e.source_url,verified_at:e.verified_at};}
module.exports={twoStageEvidence,compareTwoStage};
