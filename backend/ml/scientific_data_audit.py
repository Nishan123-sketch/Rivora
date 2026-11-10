"""Read-only data/provenance audit and exact acquisition manifest; no observations are invented."""
import argparse,csv,json,collections
from pathlib import Path
from datetime import datetime,timedelta
import pandas as pd
from pipeline import connect,fetch
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'reports/scientific-upgrade-20261109'
def intervals(times):
 if not len(times):return []
 times=sorted(times);out=[];start=last=times[0]
 for t in times[1:]:
  if t-last>pd.Timedelta(hours=1):out.append({'from':str(start),'to':str(last),'missing_hours':int((last-start).total_seconds()/3600)+1});start=t
  last=t
 out.append({'from':str(start),'to':str(last),'missing_hours':int((last-start).total_seconds()/3600)+1});return out

def hourly_grid(start,end):
 """Use the same whole-hour origins as the forecasting feature builders."""
 return pd.date_range(pd.Timestamp(start).ceil('h'),pd.Timestamp(end).floor('h'),freq='h')

def run(output_dir=OUT):
 OUT=Path(output_dir);OUT.mkdir(parents=True,exist_ok=True)
 conn=connect();cur=conn.cursor(dictionary=True);requirements=[];audit=[]
 try:
  coverage=fetch(cur,"SELECT station_code,start_at,end_at,status,initial_state FROM ml_source_coverage WHERE status='COMPLETE' AND start_at<'2026-01-01'")
  registry=fetch(cur,'SELECT station_code,designation,authority FROM official_station_registry');bycode={str(x['station_code']):x for x in registry}
  stations=fetch(cur,"SELECT station_id,external_station_id,station_name FROM stations WHERE data_source='RIVER_GAUGE'")
  linked=fetch(cur,'SELECT station_id,rainfall_station_code,distance_km FROM hr_rainfall_links');links={int(x['station_id']):x for x in linked}
  for c in coverage:
   station=next((s for s in stations if str(s['external_station_id'])==str(c['station_code'])),None)
   if not station:continue
   sid=station['station_id'];start=c['start_at']-timedelta(hours=72);end=min(c['end_at'],datetime(2025,12,31,23));grid=hourly_grid(start,end)
   water=fetch(cur,"SELECT observed_at,source_url FROM water_readings WHERE station_id=%s AND observed_at BETWEEN %s AND %s",(sid,start-timedelta(minutes=15),end))
   rainlink=links.get(sid);rain=fetch(cur,'SELECT observed_at FROM hr_rainfall_history WHERE station_code=%s AND observed_at BETWEEN %s AND %s',(rainlink['rainfall_station_code'],start,end)) if rainlink else []
   present=set(pd.Timestamp(r['observed_at']) for r in water);rainpresent=set(pd.Timestamp(r['observed_at']) for r in rain)
   aligned=pd.merge_asof(pd.DataFrame({'t':grid}),pd.DataFrame({'observation':sorted(present)}),left_on='t',right_on='observation',direction='backward',tolerance=pd.Timedelta(minutes=15)) if present else None
   watermissing=grid[aligned.observation.isna().to_numpy()] if aligned is not None else grid;rainmissing=grid.difference(pd.DatetimeIndex(sorted(rainpresent)))
   conflict=fetch(cur,'SELECT COUNT(*) pairs,SUM(ABS(w.water_level-v.water_level)>0.001) differing FROM water_readings w JOIN ml_verified_water_history v ON v.station_id=w.station_id AND v.observed_at=w.observed_at WHERE w.station_id=%s AND w.observed_at BETWEEN %s AND %s',(sid,start,end))[0]
   base={'station_id':sid,'station_code':str(c['station_code']),'station_name':station['station_name'],'required_from':str(start),'required_to':str(end),'warning_scope':bycode.get(str(c['station_code']),{}).get('designation'),'rain_station_code':str(rainlink['rainfall_station_code']) if rainlink else None}
   audit.append({**base,'water_rows':len(water),'water_without_source_url':sum(not r.get('source_url') for r in water),'raw_verified_overlap':int(conflict['pairs'] or 0),'raw_verified_numeric_conflicts':int(conflict['differing'] or 0),'rain_rows':len(rain),'rain_distance_km':float(rainlink['distance_km']) if rainlink else None,'water_missing_hours':len(watermissing),'rain_missing_hours':len(rainmissing)})
   for field,missing in [('WATER_LEVEL',watermissing),('POINT_RAINFALL',rainmissing)]:
    for gap in intervals(missing):requirements.append({**base,'data_type':field,**gap,'official_source':'HRFCO historical waterlevel/rainfall archive; WAMIS historical gauge observations' if field=='WATER_LEVEL' else 'HRFCO historical linked rainfall gauge; KMA API Hub historical AWS fallback','approval_needed':'Verify existing HRFCO key permits historical ranges and bulk access. If no archive endpoint covers the gap, request an official historical CSV/export. KMA fallback requires the specific historical AWS product permission.'})
  report={'coverage_interval_count':len(audit),'station_count':len(set(x['station_id'] for x in audit)),'registry_designations':dict(collections.Counter(x['designation'] for x in registry)),'warning_feature_intervals':audit,'upstream_rainfall':'Only nearest-point links are configured. No verified basin topology, catchment-area weights or travel-time mapping was found in these feature pipelines. A nearby point gauge is not established as upstream or catchment rainfall.','future_independent_evaluation':'No independent future period has passed acceptance. Freeze prospective design before collecting new evaluation outcomes.'}
  (OUT/'authentic-data-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8');(OUT/'authentic-data-gaps.json').write_text(json.dumps(requirements,indent=2),encoding='utf-8')
  with (OUT/'authentic-data-gaps.csv').open('w',encoding='utf-8-sig',newline='') as f:
   if requirements:w=csv.DictWriter(f,fieldnames=list(requirements[0]));w.writeheader();w.writerows(requirements)
  print(json.dumps({'intervals':len(audit),'stations':report['station_count'],'missing_contiguous_windows':len(requirements),'missing_rain_hours':sum(x['rain_missing_hours'] for x in audit),'raw_verified_numeric_conflicts':sum(x['raw_verified_numeric_conflicts'] for x in audit)}))
 finally:cur.close();conn.close()
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output-dir',type=Path,default=OUT)
 run(parser.parse_args().output_dir)
