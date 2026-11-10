"""Read-only warning event eligibility evidence; never fits, changes splits or labels unknown negatives."""
import json
from pathlib import Path
import pandas as pd
from pipeline import connect,fetch
from advanced_warning import frame_features,FEATURES
BACK=Path(__file__).resolve().parent.parent
conn=connect();cur=conn.cursor(dictionary=True)
rows=[]
try:
 events=fetch(cur,"SELECT * FROM hr_flood_warning_history WHERE action='ISSUE' AND issued_at>='2025-01-01' AND issued_at<'2026-01-01' ORDER BY issued_at")
 stations=fetch(cur,"SELECT station_id,external_station_id FROM stations WHERE data_source='RIVER_GAUGE'")
 coverage=fetch(cur,"SELECT station_code,start_at,end_at FROM ml_source_coverage WHERE status='COMPLETE'")
 for event in events:
  found=[s for s in stations if str(s['external_station_id'])==str(event['station_code'])]
  if len(found)!=1:rows.append({'event_id':event['event_id'],'station_code':event['station_code'],'issued_at':str(event['issued_at']),'status':'NO_UNIQUE_MONITORED_STATION'});continue
  s=found[0];at=pd.Timestamp(event['issued_at']);start=(at-pd.Timedelta(hours=76)).to_pydatetime();end=at.to_pydatetime()
  water=fetch(cur,'SELECT observed_at,water_level FROM water_readings WHERE station_id=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(s['station_id'],start,end))
  links=fetch(cur,'SELECT * FROM hr_rainfall_links WHERE station_id=%s AND distance_km<=30',(s['station_id'],))
  rain=fetch(cur,'SELECT observed_at,rainfall_mm hourly_rainfall FROM hr_rainfall_history WHERE station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(links[0]['rainfall_station_code'],start,end)) if links else []
  f=frame_features(water,rain);origins=f[(f.index<at)&(f.index>=at-pd.Timedelta(hours=3))] if not f.empty else f;missing={k:int(origins[k].isna().sum()) for k in FEATURES} if not origins.empty else {k:3 for k in FEATURES}
  complete=any(str(c['station_code'])==str(event['station_code']) and pd.Timestamp(c['start_at'])<=at-pd.Timedelta(hours=3) and pd.Timestamp(c['end_at'])>=at for c in coverage)
  rows.append({'event_id':event['event_id'],'station_id':s['station_id'],'station_code':event['station_code'],'issued_at':str(at),'status':'FEATURE_WINDOW_AVAILABLE' if len(origins.dropna()) else 'MISSING_FEATURE_WINDOW','origins':len(origins),'complete_feature_origins':len(origins.dropna()),'missing_features':missing,'complete_coverage_at_event':complete,'rain_gauge':str(links[0]['rainfall_station_code']) if links else None,'rain_distance_km':float(links[0]['distance_km']) if links else None})
 report={'generated_at':str(pd.Timestamp.now(tz='UTC')),'scope':'2025 development season only; event input audit, not fitted outcomes or new negative coverage','events':rows}
 (BACK/'reports/availability-repair/warning-event-diagnostics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 print(json.dumps({'events':len(rows),'with_features':sum(r['status']=='FEATURE_WINDOW_AVAILABLE' for r in rows),'late_september':[r for r in rows if r['issued_at']>='2025-09-10']}))
finally:cur.close();conn.close()
