export const token = () => sessionStorage.getItem('weather_flood_token');
export async function request(path, body, method = 'POST') {
 const response = await fetch('/api'+path, {method, headers:{'Content-Type':'application/json', ...(token()?{Authorization:'Bearer '+token()}:{})}, ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data = await response.json();
 if(!response.ok || data.success===false) throw new Error(data.message || 'Request failed');
 return data;
}
