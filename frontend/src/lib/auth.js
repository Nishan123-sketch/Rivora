import {apiFetch} from './apiFetch.js';
export const token = () => sessionStorage.getItem('weather_flood_token');
export function monitoringDestination(preferences=[]){const preference=preferences.find(p=>Number.isSafeInteger(Number(p.station_id))&&Number(p.station_id)>0)||null;return {page:preference?'Overview Dashboard':'Onboarding',preference};}
export async function request(path, body, method = 'POST', options = {}) {
 const response = await apiFetch('/api'+path, {...options,method, headers:{'Content-Type':'application/json', ...(token()?{Authorization:'Bearer '+token()}:{})}, ...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(response.status===401&&path==='/auth/session'&&token()){sessionStorage.removeItem('weather_flood_token');return request(path,body,method,options);}
 const data = await response.json();
 if(!response.ok || data.success===false) throw new Error(data.message || 'Request failed');
 return data;
}
