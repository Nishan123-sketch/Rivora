export function nearestRegistrationStation(position,stations){
 const {latitude,longitude}=position?.coords||{};
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('Your browser did not return valid coordinates. Please retry.');
 const rad=x=>x*Math.PI/180;
 const ranked=stations.filter(s=>s.coordinate_verified===true&&s.latitude!=null&&s.longitude!=null&&s.latitude!==''&&s.longitude!==''&&Number.isFinite(Number(s.latitude))&&Number.isFinite(Number(s.longitude))).map(s=>{
  const a=rad(Number(s.latitude)-latitude),b=rad(Number(s.longitude)-longitude),v=Math.sin(a/2)**2+Math.cos(rad(latitude))*Math.cos(rad(Number(s.latitude)))*Math.sin(b/2)**2;
  return {...s,distance_km:2*6371*Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))))};
 }).sort((a,b)=>a.distance_km-b.distance_km||a.station_id-b.station_id);
 if(!ranked.length)throw Error('No eligible monitoring station has verified coordinates. Please retry later.');
 return ranked[0];
}
export function registrationPosition(geolocation){
 if(!geolocation)return Promise.reject(Error('Location is unavailable in this browser. Use a secure connection and retry.'));
 return new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,e=>reject(Error(e.code===1?'Location permission was denied. Enable it in your browser settings, then retry.':e.code===3?'Location detection timed out. Please retry.':'Your location is unavailable. Check your device location settings, then retry.')),{enableHighAccuracy:false,timeout:12000,maximumAge:0}));
}
