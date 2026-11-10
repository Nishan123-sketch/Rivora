export function designationLabel(value){return value==='DESIGNATED_WARNING'?'Designated flood-warning station':value==='PUBLISHED_THRESHOLD'?'Official published-threshold gauge':'Warning designation not confirmed';}
export function thresholdLabels(assessment){return assessment?.station_designation==='PUBLISHED_THRESHOLD'?{lower:'Caution',upper:'Alert'}:{lower:'Advisory',upper:'Warning'};}
