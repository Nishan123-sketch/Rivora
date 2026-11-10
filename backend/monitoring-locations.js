'use strict';
const fs=require('fs'),path=require('path');
const {englishStationName,englishRiverName,romanizeKorean}=require('./display-names');
const provinces={'서울특별시':'Seoul','부산광역시':'Busan','대구광역시':'Daegu','인천광역시':'Incheon','광주광역시':'Gwangju','대전광역시':'Daejeon','울산광역시':'Ulsan','세종특별자치시':'Sejong','경기도':'Gyeonggi','강원도':'Gangwon','강원특별자치도':'Gangwon','충청북도':'North Chungcheong','충청남도':'South Chungcheong','전라북도':'North Jeolla','전북특별자치도':'North Jeolla','전라남도':'South Jeolla','경상북도':'North Gyeongsang','경상남도':'South Gyeongsang','제주특별자치도':'Jeju'};
let metadata;
function addressIndex(){
 if(metadata)return metadata;
 const index=new Map();
 for(const name of ['official-network-snapshot.json','official-network-snapshot-Nakdong.json','official-network-snapshot-Yeongsan.json','official-network-snapshot-Nakdong-Yeongsan.json']){
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'reference-data',name),'utf8'));for(const source of d.sources||[]){const url=source.url||source.endpoint;let host;try{host=new URL(url).hostname;}catch{continue;}if(!/^(?:www\.)?(?:hrfco|nakdongriver|yeongsanriver|geumriver)\.go\.kr$/.test(host))continue;
   for(const r of source.rows||[]){const code=String(r.wlobscd||r.obscd||'');const parts=String(r.addr||'').trim().split(/\s+/);if(!/^\d{7}$/.test(code)||!provinces[parts[0]]||parts.length<2)continue;
    index.set(code,{province:provinces[parts[0]],district:romanizeKorean(parts[1]),administrative_source:url,metadata_checked_at:d.checked_at||null});
   }
  }}catch{/* Missing source metadata is displayed as unavailable, never inferred from distance. */}
 }
 metadata=index;return index;
}
function locationRows(rows,index=addressIndex()){
 return rows.map(r=>({...r,coordinate_verified:verifiedCoordinates(r),station_name:englishStationName(r.station_name,r.station_code),river_name:englishRiverName(r.river_name_en,r.river_name_ko),...(index.get(String(r.station_code))||{province:'Administrative area unavailable',district:'Not documented',administrative_source:null})}));
}
function verifiedCoordinates(r){
 if(r.latitude==null||r.longitude==null||r.latitude===''||r.longitude==='')return false;
 if(!Number.isFinite(Number(r.latitude))||!Number.isFinite(Number(r.longitude))||Number(r.latitude)<33||Number(r.latitude)>39.5||Number(r.longitude)<124||Number(r.longitude)>132)return false;
 try{const u=new URL(r.coordinate_source_url);return ['http:','https:'].includes(u.protocol)&&/^(?:www\.)?(?:wamis|hrfco|nakdongriver|geumriver|yeongsanriver)\.go\.kr$/.test(u.hostname);}catch{return false;}
}
function nearestStation(location,rows){
 const rad=x=>x*Math.PI/180;
 return rows.filter(verifiedCoordinates).map(r=>{const a=rad(Number(r.latitude)-location.latitude),b=rad(Number(r.longitude)-location.longitude);const v=Math.sin(a/2)**2+Math.cos(rad(location.latitude))*Math.cos(rad(Number(r.latitude)))*Math.sin(b/2)**2;return {...r,distance_km:2*6371*Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))))};}).sort((a,b)=>a.distance_km-b.distance_km||a.station_id-b.station_id)[0]||null;
}
async function registrationLocation({location,stationId,province},db,readCatalog=catalog,now=Date.now()){
 const bad=message=>Object.assign(Error(message),{status:400});
 if(!location||typeof location.latitude!=='number'||typeof location.longitude!=='number'||!Number.isFinite(location.latitude)||!Number.isFinite(location.longitude)||Math.abs(location.latitude)>90||Math.abs(location.longitude)>180||typeof location.captured_at!=='number'||!Number.isFinite(location.captured_at)||now-location.captured_at<0||now-location.captured_at>5*60000)throw bad('Enable Location and obtain a fresh browser location before registering.');
 const nearest=nearestStation(location,await readCatalog(db));
 if(!nearest)throw bad('No eligible monitoring station has verified coordinates. Please retry later.');
 if(Number(nearest.station_id)!==stationId)throw bad('The detected station changed. Retry location detection before registering.');
 if(province!==nearest.province)throw bad('Use the documented monitoring area shown for your detected station. Province selection does not establish warning coverage.');
 // Coordinates are transient validation input, never written to user preferences.
 return nearest;
}
async function catalog(db=require('./db')){
 const [rows]=await db.execute("SELECT DISTINCT s.station_id,s.external_station_id station_code,s.station_name,s.latitude,s.longitude,s.coordinate_source_url,l.river_id,l.source_river_name river_name_ko FROM stations s JOIN river_gauge_links l ON l.station_id=s.station_id WHERE s.data_source='RIVER_GAUGE' AND s.external_station_id IS NOT NULL AND l.verification_status='VERIFIED' ORDER BY s.station_id,l.river_id");
 const rivers=new Map(require('./river-network-registry').getCatalog().map(r=>[r.river_id,r]));
 const allowed=await require('./official-station-policy').ids();
 return locationRows(rows.filter(r=>allowed.has(String(r.station_id))).map(r=>({...r,river_name_en:rivers.get(r.river_id)?.name_en||null})));
}
module.exports={catalog,locationRows,addressIndex,verifiedCoordinates,nearestStation,registrationLocation};
