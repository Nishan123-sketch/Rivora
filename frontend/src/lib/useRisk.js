import {recordPagePerformance} from './clientPerformance';
import {apiFetch} from './apiFetch.js';
import {useEffect,useSyncExternalStore} from 'react';
let snapshot={data:[],loading:true,error:''},pending=null,loadedAt=0;
const listeners=new Set();
let polling;const resume=()=>{if(document.visibilityState!=='hidden'&&Date.now()-loadedAt>=60000)void refreshRisk();};
const subscribe=fn=>{listeners.add(fn);if(listeners.size===1){polling=setInterval(resume,60000);document.addEventListener('visibilitychange',resume);}return()=>{listeners.delete(fn);if(!listeners.size){clearInterval(polling);document.removeEventListener('visibilitychange',resume);}};};
const getSnapshot=()=>snapshot;
const publish=value=>{snapshot=value;listeners.forEach(fn=>fn());};
export async function refreshRisk(){
 if(pending)return pending;
 pending=(async()=>{try{const r=await apiFetch('/api/risk/unified',{signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||!Array.isArray(d.data))throw Error(d.message||'Risk service unavailable');loadedAt=Date.now();recordPagePerformance('risk-data-ready');publish({data:d.data,loading:false,error:''});}catch(e){publish({data:[],loading:false,error:e.message});}finally{pending=null;}})();return pending;
}
export function useRisk(){
 const state=useSyncExternalStore(subscribe,getSnapshot);
 useEffect(()=>{if(Date.now()-loadedAt>=60000)void refreshRisk();},[]);
 return {...state,refresh:refreshRisk};
}
