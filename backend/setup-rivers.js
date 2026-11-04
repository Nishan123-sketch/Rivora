require('dotenv').config();
const pool=require('./db');
const {migrate}=require('./migrate');
const {discoverGauges}=require('./river-discovery');
const {importRiverData}=require('./river-importer');
async function main(){
 console.log('1/3 Setting up safe additive river-gauge mapping...');
 await migrate();
 console.log('2/3 Searching official WAMIS gauges and verifying river identity + recent observations...');
 let discovered=null;
 try {discovered=await discoverGauges({maxPerRiver:3,fullScan:true});}
 catch(e){console.error('WAMIS discovery could not complete:',e.message);process.exitCode=1;}
 if(discovered)console.log('Discovery summary:',JSON.stringify({linked_new:discovered.linked_new,rivers_with_gauges:discovered.rivers_with_gauges,metadata_checked:discovered.metadata_checked}));
 console.log('3/3 Importing actual water-level observations for verified gauges...');
 try {const result=await importRiverData();console.log('Observation import:',JSON.stringify({gauges:result.gauges,saved:result.saved,failed:result.failed}));}
 catch(e){console.error('Observation import failed:',e.message);process.exitCode=1;}
 console.log('Setup complete. If some rivers lack an official linked gauge, they remain explicitly unavailable.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
