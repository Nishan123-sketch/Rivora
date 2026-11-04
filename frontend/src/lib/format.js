export const valid = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export const metric = (v,unit='',digits=2) => valid(v) ? `${Number(v).toFixed(digits)}${unit ? ' '+unit : ''}` : 'No station data';
export const observed = v => v ? String(v).replace('T',' ').replace(/\.\d+Z?$/,'').replace(/Z$/,' UTC') : 'No station data';
export const stationName = (s) => s?.station_name || 'Unknown station';
export const getRow = (rows,id) => rows.find(r=>String(r.station_id)===String(id));
