// Public API origin only; secrets always stay in backend/.env.
export function apiUrl(input){
 const base=import.meta.env?.VITE_API_BASE_URL;
 return base&&typeof input==='string'&&input.startsWith('/api/')?new URL(input,base).href:input;
}
export function apiFetch(input,options){
 if(typeof input!=='string'||!input.startsWith('/api/'))return globalThis.fetch(apiUrl(input),options);
 const method=(options?.method||'GET').toUpperCase();
 return globalThis.fetch(apiUrl(input),{credentials:'include',...options,headers:{...(!['GET','HEAD','OPTIONS'].includes(method)?{'X-Rivora-Request':'1'}:{}),...options?.headers}});
}
