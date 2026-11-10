const fs=require('fs'),path=require('path');
function enrichmentStatus(){try{const r=JSON.parse(fs.readFileSync(path.join(__dirname,'reports/ml-history-enrichment.json'),'utf8'));return {processed:r.stations.length,total:r.candidates,imported:r.stations.filter(s=>s.status==='IMPORTED').length,inserted_rows:r.inserted_rows,updated_at:r.updated_at,completed_at:r.completed_at||null,stopped_reason:r.stopped_reason||null};}catch{return null;}}
module.exports={enrichmentStatus};
