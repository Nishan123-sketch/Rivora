const {test}=require('node:test'),assert=require('node:assert/strict');
const {registrationLocation,nearestStation,verifiedCoordinates}=require('../monitoring-locations');
const {createAccount}=require('../register-account');
const now=Date.now(),location={latitude:35.55,longitude:129.3,captured_at:now};
const stations=[{station_id:207,latitude:35.551,longitude:129.3,province:'Ulsan',coordinate_source_url:'https://www.wamis.go.kr/wamis/openapi/wkw/wl_obsinfo?obscd=2201670'},{station_id:208,latitude:36,longitude:129.3,province:'Other',coordinate_source_url:'https://www.hrfco.go.kr/'}];
test('registration requires fresh numeric browser coordinates and the true nearest verified station',async()=>{
 const read=async()=>stations;
 for(const bad of [null,{...location,latitude:null},{...location,latitude:'35.55'},{...location,captured_at:now-6*60000},{...location,longitude:181}])await assert.rejects(registrationLocation({location:bad,stationId:207,province:'Ulsan'},null,read,now),{status:400});
 assert.equal((await registrationLocation({location,stationId:207,province:'Ulsan'},null,read,now)).station_id,207);
 await assert.rejects(registrationLocation({location,stationId:208,province:'Other'},null,read,now),/detected station changed/);
 await assert.rejects(registrationLocation({location,stationId:207,province:'Other'},null,read,now),/documented monitoring area/);
});
test('unsourced, missing and invalid station coordinates cannot win nearest selection',async()=>{
 const unsourced={station_id:1,latitude:35.55,longitude:129.3};
 assert.equal(verifiedCoordinates(unsourced),false);
 assert.equal(nearestStation(location,[unsourced,...stations]).station_id,207);
 assert.equal(nearestStation(location,[{...stations[0],latitude:null}]),null);
 await assert.rejects(registrationLocation({location,stationId:207,province:'Ulsan'},null,async()=>[unsourced],now),/No eligible monitoring station/);
});
test('existing account transaction saves station preference without coordinates or automatic alert opt-in',async()=>{
 const writes=[];let commit=false;
 const c={beginTransaction:async()=>{},commit:async()=>{commit=true;},rollback:async()=>{},release(){},execute:async(sql,args)=>{writes.push({sql,args});return sql.includes('SELECT station_id')?[[{station_id:207}]]:sql.includes('INSERT INTO users')?[{insertId:7}]:[{}];}};
 await createAccount({email:'synthetic@example.test',passwordHash:'hash',stationId:207,consent:false},{getConnection:async()=>c});
 assert.ok(commit);assert.deepEqual(writes.at(-1).args,[7,207,false]);assert.ok(writes.every(w=>!w.sql.includes('latitude')&&!w.sql.includes('longitude')));
});
