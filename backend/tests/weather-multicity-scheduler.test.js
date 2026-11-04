const test = require('node:test');
const assert = require('node:assert/strict');
const { createForecastScheduler } = require('../kma-forecast-scheduler');

function fakeDb(ids) {
  return { execute: async sql => {
    assert.match(sql, /data_source = 'KMA'/);
    return [ids.map(station_id => ({station_id}))];
  }};
}
const quiet = {error:()=>{}};

test('scheduler rotates through multiple KMA cities with fake DB and fake importer', async () => {
  const called = [];
  const scheduler = createForecastScheduler({
    db: fakeDb([11,12,31,45]), importForecast: async id=>called.push(id),
    findDefault: async()=>({station_id:31}), getConfiguredIds:()=>'',
    batchSize:2, logger:quiet
  });
  assert.deepEqual(await scheduler.runKmaForecastImport(),{attempted:2,succeeded:2});
  assert.deepEqual(await scheduler.runKmaForecastImport(),{attempted:2,succeeded:2});
  assert.deepEqual(called,[31,11,12,45]);
});

test('scheduler honors explicit IDs and deduplicates inputs', async () => {
  const called=[];
  const scheduler=createForecastScheduler({
    db:{execute:async()=>{throw Error('should not query DB when configured')}},
    importForecast:async id=>called.push(id),
    getConfiguredIds:()=> '31, 12, 31, bogus, 0',
    batchSize:8,logger:quiet
  });
  assert.deepEqual(await scheduler.runKmaForecastImport(),{attempted:2,succeeded:2});
  assert.deepEqual(called,[31,12]);
});

test('scheduler continues after one import error without claiming a successful import', async () => {
  const errors=[];
  const scheduler=createForecastScheduler({
    db:fakeDb([11,12]),findDefault:async()=>null,getConfiguredIds:()=>'',
    importForecast:async id=>{if(id===12)throw Error('fake API unavailable')},
    logger:{error:(...args)=>errors.push(args)}
  });
  assert.deepEqual(await scheduler.runKmaForecastImport(),{attempted:2,succeeded:1});
  assert.equal(errors.length,1);
});

test('scheduler prevents overlapping runs against fake slow API', async () => {
  let release;
  const gate=new Promise(resolve=>release=resolve);
  const scheduler=createForecastScheduler({
    db:fakeDb([31]),findDefault:async()=>({station_id:31}),getConfiguredIds:()=>'',
    importForecast:async()=>gate,logger:quiet
  });
  const pending=scheduler.runKmaForecastImport();
  // Drain microtasks until import has begun.
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(await scheduler.runKmaForecastImport(),{skipped:true});
  release();
  assert.deepEqual(await pending,{attempted:1,succeeded:1});
});
