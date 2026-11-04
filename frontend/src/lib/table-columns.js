export const available = v => v !== null && v !== undefined && v !== '';
export const display = (v, unit = '') => available(v) ? `${v}${unit}` : 'Not available';
export const observationTime = v => v ? String(v).replace('T',' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, '').slice(0,19) + ' (database time)' : 'Not available';
export const weatherColumns = [
 {key:'station_name',title:'Station'},
 {key:'temperature',title:'Temperature',render:r=>display(r.temperature,' °C')},
 {key:'rainfall',title:'Rainfall',render:r=>display(r.rainfall,' mm')},
 {key:'observed_at',title:'Observed at',render:r=>observationTime(r.observed_at)}
];
export const waterColumns = [
 {key:'station_name',title:'Station'},
 {key:'water_level',title:'Water field (provisional)',render:r=>display(r.water_level)},
 {key:'flow_rate',title:'Flow field (provisional)',render:r=>display(r.flow_rate)},
 {key:'observed_at',title:'Observed at',render:r=>observationTime(r.observed_at)}
];
