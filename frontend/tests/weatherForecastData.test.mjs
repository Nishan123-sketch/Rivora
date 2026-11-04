import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numberOrNull, kmaStationOptions, effectiveStationId, latestObservation,
  upcomingForecasts, weatherDetails, rainfallForecastLabel,
  fetchStationForecast, requestStationForecastImport, availableForecastDays
} from '../src/lib/weatherForecastData.js';

const now = Date.parse('2026-11-01T09:30:00Z'); // 18:30 KST, synthetic test clock
const at = n => new Date(now + n * 3600000).toISOString();
const kst = '2026-11-01 18:00:00';
const forecast = ({ stationId = 12, issue = '2026-11-01 17:00:00', validAt = '2026-11-01 19:00:00', ...other } = {}) => ({
  station_id: stationId, issued_at: issue, valid_at: validAt,
  temperature_forecast: '10.0', humidity_forecast: '40.0', wind_speed_forecast: '2.5', precipitation_probability: '0.0',
  ...other
});

test('missing is unavailable, but real numeric zero stays zero', () => {
  for (const missing of [null, undefined, '', '   ', 'not-a-number', false]) assert.equal(numberOrNull(missing), null);
  assert.equal(numberOrNull('0.00'), 0);
});

test('stations without observations stay in selection; KWATER and sample excluded', () => {
  const options = kmaStationOptions([
    {station_id: 12, station_name: '동해', data_source: 'KMA'},
    {station_id: 31, station_name: '울산', data_source: 'KMA'},
    {station_id: 207, station_name: '태화교', data_source: 'RIVER_GAUGE'},
    {station_id: 1, station_name: 'Sample', data_source: 'Sample'}
  ], [{station_id: 207, station_name: 'River observation without type'}, {station_id: 12, station_name: '동해'}]);
  assert.deepEqual(options.map(o => o.station_id).sort(), ['12', '31']);
  assert.equal(effectiveStationId('31', options), '31');
  assert.equal(effectiveStationId('999', options), options[0].station_id);
});

test('the latest weather row is selected by timestamp, not array position', () => {
  const rows = [
    {station_id:12, observed_at:'2026-10-31 00:00:00', temperature:'1.0'},
    {station_id:31, observed_at:'2026-11-01 18:00:00', temperature:'8.0'},
    {station_id:12, observed_at:kst, temperature:'12.0'}
  ];
  assert.equal(latestObservation(rows, '12').temperature, '12.0');
  assert.equal(latestObservation(rows, '99'), null);
});

test('forecast from previous city never appears for new station', () => {
  const result = {station_id:12,forecasts:[forecast()]};
  assert.equal(upcomingForecasts(result,31,now).length,0);
  assert.equal(upcomingForecasts(result,12,now).length,1);
});

test('future short-term forecasts are ordered, deduplicated, and checked for staleness', () => {
  const response = {station_id:12,forecasts:[
    forecast({validAt:'2026-11-01 21:00:00'}),
    forecast({validAt:'2026-11-01 19:00:00'}),
    forecast({validAt:'2026-11-01 19:00:00'}),
    forecast({validAt:'2026-11-01 13:00:00'}),
    forecast({issue:'2026-10-30 17:00:00',validAt:'2026-11-01 22:00:00'})
  ]};
  assert.deepEqual(upcomingForecasts(response,12,now).map(x=>x.valid_at),[
    '2026-11-01 19:00:00','2026-11-01 21:00:00'
  ]);
});

test('fresh observed values win; real zero is preserved and rain chance comes from nearest forecast', () => {
  const obs = {observed_at:kst, temperature:'0.0', humidity:'0.0',wind_speed:'0.0',rainfall:null,
    aws_observed_at:kst,aws_hourly_rainfall:'0.00',aws_station_code:'106'};
  const d = weatherDetails(obs,[forecast()],now);
  assert.equal(d.temperature,0);
  assert.equal(d.humidity,0);
  assert.equal(d.wind,0);
  assert.equal(d.rainChance,0);
  assert.equal(d.rainfall,0);
  assert.equal(d.rainfallSource,'AWS');
  assert.equal(d.humiditySource,'observed');
});

test('stale observations do not appear current; forecast fallbacks are clearly identified', () => {
  const d = weatherDetails({observed_at:'2026-11-01 11:00:00',temperature:'22',humidity:'95',wind_speed:'8',rainfall:'7'},
    [forecast()],now);
  assert.equal(d.temperature,null);
  assert.equal(d.rainfall,null);
  assert.equal(d.humidity,40);
  assert.equal(d.wind,2.5);
  assert.equal(d.humiditySource,'forecast');
  assert.equal(d.windSource,'forecast');
});

test('missing nearest-hour forecast value never falls back to a later hour or invented zero', () => {
  const d = weatherDetails(null,[forecast({humidity_forecast:null, precipitation_probability:null}),
    forecast({validAt:'2026-11-01 20:00:00',humidity_forecast:'75.0',precipitation_probability:'10'})],now);
  assert.equal(d.humidity,null);
  assert.equal(d.rainChance,null);
});

test('KMA categorical rainfall ranges stay text and do not turn into a numeric zero', () => {
  assert.equal(rainfallForecastLabel({rainfall_forecast:null,precipitation_raw:'1mm 미만'}),'1mm 미만');
  assert.equal(rainfallForecastLabel({rainfall_forecast:null,precipitation_min_mm:0,precipitation_max_mm:1,precipitation_max_exclusive:1}), '0.00 to <1.00 mm');
  assert.equal(rainfallForecastLabel({rainfall_forecast:'0.00'}),'0.00 mm');
  assert.equal(rainfallForecastLabel({rainfall_forecast:null}),'No data');
});

test('API helper fetches requested city and rejects a mismatched server response', async () => {
  const calls = [];
  const fakeFetch = async (url,opts) => { calls.push({url,opts}); return {ok:true,json:async()=>({station_id:12,forecasts:[forecast()]})}; };
  const data = await fetchStationForecast(fakeFetch,12);
  assert.equal(data.forecasts.length,1);
  assert.equal(calls[0].url,'/api/weather/forecast?station_id=12');
  await assert.rejects(()=>fetchStationForecast(fakeFetch,31), /does not match/);
});

test('API helper reports HTTP failure without substituting data', async () => {
  await assert.rejects(()=>fetchStationForecast(async()=>({ok:false,status:503}),12), /HTTP 503/);
});

test('fake API import sends the selected city ID and requires success', async () => {
  let request;
  await requestStationForecastImport(async (url,opts)=>{
    request = {url,opts}; return {ok:true,json:async()=>({success:true,station_id:31})};
  },31);
  assert.equal(request.url,'/api/weather/forecast/import');
  assert.equal(JSON.parse(request.opts.body).station_id,31);
  await assert.rejects(()=>requestStationForecastImport(async()=>({ok:true,json:async()=>({success:false,message:'No data'})}),31),/No data/);
});

test('available-day list includes only actual KMA hourly records, never padded days', () => {
  const days = availableForecastDays([
    forecast({validAt:'2026-11-01 19:00:00'}),
    forecast({validAt:'2026-11-01 20:00:00'}),
    forecast({validAt:'2026-11-02 09:00:00',temperature_forecast:null,precipitation_probability:null})
  ]);
  assert.deepEqual(days.map(d=>[d.date,d.hours]),[['2026-11-01',2],['2026-11-02',1]]);
  assert.deepEqual(days[1].temperatures,[]);
});
