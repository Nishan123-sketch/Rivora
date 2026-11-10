import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiFetch,apiUrl} from '../src/lib/apiFetch.js';
test('same-origin API URLs and third-party URLs remain intact when no remote origin is configured',async()=>{assert.equal(apiUrl('/api/stations'),'/api/stations');assert.equal(apiUrl('https://tile.openstreetmap.org/1/1/1.png'),'https://tile.openstreetmap.org/1/1/1.png');const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>({url,options});assert.deepEqual(await apiFetch('/api/stations',{method:'GET'}),{url:'/api/stations',options:{credentials:'include',method:'GET',headers:{}}});}finally{globalThis.fetch=original;}});

test('only Rivora API mutations attach the CSRF marker and credentials',async()=>{const old=globalThis.fetch;try{globalThis.fetch=async(url,options)=>({url,options});const r=await apiFetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'}});assert.equal(r.options.credentials,'include');assert.equal(r.options.headers['X-Rivora-Request'],'1');const external=await apiFetch('https://example.test/',{method:'GET'});assert.deepEqual(external.options,{method:'GET'});}finally{globalThis.fetch=old;}});
