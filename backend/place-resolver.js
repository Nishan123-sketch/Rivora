'use strict';
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/-gun\b/g,' county').replace(/(\d)(bridge|gyo)\b/g,'$1 $2').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const aliases={'2201670':['taehwa bridge','taehwagyo','태화교','taehwa river'],'152':['ulsan','울산'],'1015636':['gapyeong county seonchon 2 bridge','seonchon 2 bridge','seonchon2gyo','선촌2교']};
function distance(a,b){let last=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,last[j]+1,last[j-1]+(a[i-1]===b[j-1]?0:1));last=row;}return last[b.length];}
function resolvePlaces(query,stations){
 const text=normalize(query),words=text.split(' ');
 const explicitCode=text.match(/\b(?:station|code)\s+(\d{3,7})\b/)||text.match(/^(\d{3,7})$/);
 const codes=explicitCode?[explicitCode[1]]:words.filter(w=>/^\d{7}$/.test(w));
 return stations.map(s=>{const stationName=String(s.station_name||'');const parenthetical=[...stationName.matchAll(/\(([^)]+)\)/g)].map(m=>m[1]);const names=[stationName,...parenthetical,...(aliases[s.external_station_id]||[]),...(s.aliases||[])].map(normalize).filter(Boolean);let confidence=0;
  if(codes.length)return {station_id:s.station_id,station_code:s.external_station_id,station_name:s.station_name,data_source:s.data_source,confidence:codes.includes(String(s.external_station_id))?1:0};
  for(const name of names){if(text===name||(` ${text} `).includes(` ${name} `)){confidence=1;break;}if(words.some(w=>w.length>=4&&!['bridge','county','city','station','river'].includes(w)&&name.split(' ').includes(w)))confidence=Math.max(confidence,.85);const n=name.split(' ').length;for(let i=0;i<words.length;i++){const part=words.slice(i,i+n).join(' ');if(Math.min(name.length,part.length)<4)continue;confidence=Math.max(confidence,1-distance(name,part)/Math.max(name.length,part.length));}}
  return {station_id:s.station_id,station_code:s.external_station_id,station_name:s.station_name,data_source:s.data_source,confidence:Number(confidence.toFixed(3))};
 }).filter(s=>s.confidence>=0.55).sort((a,b)=>b.confidence-a.confidence).slice(0,5);
}
module.exports={normalize,distance,resolvePlaces};
