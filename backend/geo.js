const coordinate=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const located=s=>s&&coordinate(s.latitude)&&coordinate(s.longitude)&&Number(s.latitude)>=33&&Number(s.latitude)<=39.5&&Number(s.longitude)>=124&&Number(s.longitude)<=132;
function haversine(a,b){const rad=x=>x*Math.PI/180;const dlat=rad(b.latitude-a.latitude),dlon=rad(b.longitude-a.longitude);return 6371*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2));}
function nearest(gauge,stations){if(!located(gauge))return null;return stations.filter(located).map(s=>({...s,distance_km:haversine(gauge,s)})).sort((a,b)=>a.distance_km-b.distance_km)[0]||null;}
module.exports={located,haversine,nearest};
