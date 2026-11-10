export function stationCategory(station){return ['High','Severe'].includes(station.level)?'High':['Low','Moderate'].includes(station.level)?station.level:'Not assessed';}
export function stationCounts(stations){const counts={All:stations.length,Low:0,Moderate:0,High:0,'Not assessed':0};for(const station of stations)counts[stationCategory(station)]++;return counts;}
