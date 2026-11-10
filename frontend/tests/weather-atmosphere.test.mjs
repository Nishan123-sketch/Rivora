import {test} from 'node:test';import assert from 'node:assert/strict';
import {weatherAtmosphere} from '../src/lib/weatherAtmosphere.js';
test('fresh observed hourly rainfall enables rain; zero and missing values do not imply sunshine',()=>{
 const d={awsIsFresh:true,observationIsFresh:true,windSource:'observed'};
 assert.equal(weatherAtmosphere({aws_hourly_rainfall:'0.6'},d).condition,'rain');
 for(const v of [null,undefined,'',0,'0',-9,NaN])assert.equal(weatherAtmosphere({aws_hourly_rainfall:v},d).condition,'neutral');
 assert.equal(weatherAtmosphere({hourly_rainfall:1},d).condition,'rain');
 assert.equal(weatherAtmosphere({rainfall:3},d).condition,'neutral');
});
test('stale records and forecast-only conditions never drive the observed atmosphere',()=>{
 assert.deepEqual(weatherAtmosphere({aws_hourly_rainfall:5,hourly_rainfall:5,wind_speed:12},{awsIsFresh:false,observationIsFresh:false,windSource:'forecast'}),{condition:'neutral',breeze:false});
 assert.equal(weatherAtmosphere({wind_speed:8},{observationIsFresh:true,windSource:'forecast'}).breeze,false);
 assert.equal(weatherAtmosphere({wind_speed:'2.4'},{observationIsFresh:true,windSource:'observed'}).breeze,true);
 assert.equal(weatherAtmosphere({wind_speed:null},{observationIsFresh:true,windSource:'observed'}).breeze,false);
});
