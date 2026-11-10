"""Read-only saved-model and eligible-event acquisition audit; never fits or promotes."""
import csv,hashlib,json,sys
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'ml'))
from pipeline import connect,fetch
from advanced_warning import frame_features,event_labels,FEATURES
from level_research import source_valid
from scientific_data_audit import intervals
OUT=ROOT/'reports/targeted-ml-repair-20261109'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def run():
 OUT.mkdir(parents=True,exist_ok=True);training=read(ROOT/'reports/level-upgrade/training.json');policy=training['policy'];accepted=[];problems=[];artifacts=[];horizon_counts=Counter()
 for s in training['stations']:
  if s.get('artifact_name'):
   p=ROOT/'ml/level_models_v4'/s['artifact_name'];ok=p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==s['artifact_sha256'];artifacts.append({'station_id':s['station_id'],'file':s['artifact_name'],'checksum_matches':ok})
   if not ok:problems.append({'station_id':s['station_id'],'issue':'ARTIFACT_CHECKSUM_MISMATCH'})
  for h in s.get('horizons',[]):
   horizon_counts['stored_horizons']+=1
   if h.get('advanced_accepted'):
    e=h['evaluation'];m=e['chosen_test'];b=e['persistence'];reg=e['regimes']['groups'];ci=e['block_uncertainty'].get('ci95_mae_improvement_m')
    checks={'mae':b['mae_m']>0 and 1-m['mae_m']/b['mae_m']>=policy['acceptance']['test_mae_relative_improvement'],
     'rmse':m['rmse_m']<=b['rmse_m']*policy['acceptance']['test_rmse_ratio_max'],
     'regimes':all(g['samples']<policy['acceptance']['minimum_regime_samples'] or g['selected']['mae_m']<=g['persistence']['mae_m']*policy['acceptance']['regime_mae_ratio_max'] for name,g in reg.items() if name in ['rising','high_water_proxy']),
     'bootstrap':bool(ci) and ci[0]>0,'no_test_selection':e.get('test_used_for_selection') is False}
    accepted.append({'station_id':s['station_id'],'station_code':s['external_station_id'],'horizon_hours':h['horizon_hours'],'model_kind':h['model_kind'],'test':m,'persistence':b,'checks':checks})
    if not all(checks.values()):problems.append({'station_id':s['station_id'],'horizon_hours':h['horizon_hours'],'issue':'ACCEPTANCE_EVIDENCE_INCONSISTENT','checks':checks})
   elif h.get('model_kind')=='PERSISTENCE':horizon_counts['evaluated_baseline_horizons']+=1
   else:horizon_counts['unavailable_training_horizons']+=1
 saved={'training_generated_at':training['generated_at'],'accepted_stations':len({r['station_id'] for r in accepted}),'accepted_horizons':len(accepted),'artifact_files_checked':len(artifacts),'counts':dict(horizon_counts),'problems':problems,'accepted_evidence':accepted,'artifacts':artifacts}
 (OUT/'all-level-evidence-audit.json').write_text(json.dumps(saved,indent=2),encoding='utf-8')
 conn=connect();cur=conn.cursor(dictionary=True);event_audit=[];requests=[]
 try:
  tables=fetch(cur,'SHOW TABLES');names=[str(next(iter(r.values()))) for r in tables]
  events=fetch(cur,"SELECT * FROM hr_flood_warning_history WHERE issued_at<'2026-01-01' ORDER BY issued_at")
  coverage=fetch(cur,"SELECT * FROM ml_source_coverage WHERE status='COMPLETE' AND start_at<'2026-01-01'")
  stations={str(s['external_station_id']):s for s in fetch(cur,"SELECT station_id,external_station_id FROM stations WHERE data_source='RIVER_GAUGE'")}
  for e in events:
   if e['action']!='ISSUE':continue
   code=str(e['station_code']);station=stations.get(code)
   if not station:continue
   t=pd.Timestamp(e['issued_at']);origins=pd.date_range((t-pd.Timedelta(hours=3)).ceil('h'),t.floor('h'),freq='h');origins=origins[origins<t]
   cs=[c for c in coverage if str(c['station_code'])==code];ev=[r for r in events if str(r['station_code'])==code];labels=event_labels(origins,ev,cs)
   eligible=labels.index[(labels.ongoing=='NONE')&(labels.label==1)&(labels.event_id==e['event_id'])]
   row={'event_id':e['event_id'],'station_id':station['station_id'],'station_code':code,'issued_at':str(t),'eligible_origins':[str(x) for x in eligible],'origin_states':labels.ongoing.value_counts().to_dict()}
   if not len(eligible):row['status']='OUTSIDE_RUNTIME_SCOPE';event_audit.append(row);continue
   start=(eligible.min()-pd.Timedelta(hours=73)).to_pydatetime();end=t.to_pydatetime();sid=station['station_id']
   raw=fetch(cur,'SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(sid,start,end));water=[w for w in raw if source_valid(w.get('source_url'),code)]
   if 'ml_verified_water_history' in names:
    verified=fetch(cur,'SELECT observed_at,water_level,source_url FROM ml_verified_water_history WHERE station_id=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(sid,start,end));water += [w for w in verified if source_valid(w.get('source_url'),code)]
   links=fetch(cur,'SELECT * FROM hr_rainfall_links WHERE station_id=%s AND distance_km<=30',(sid,));rain=[];raincode=None;provider='HRFCO';source='https://www.hrfco.go.kr/web/openapiPage/reference.do#rainfall'
   if links:
    raincode=str(links[0]['rainfall_station_code']);rain=fetch(cur,'SELECT observed_at,rainfall_mm AS hourly_rainfall FROM hr_rainfall_history WHERE station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(raincode,start,end))
   else:
    links=fetch(cur,"SELECT * FROM station_rainfall_links WHERE station_id=%s AND verification_status IN ('VERIFIED','AUTO_NEAREST') AND distance_km<=30",(sid,))
    if links:
     provider='KMA';source='https://apihub.kma.go.kr/api/typ01/url/awsh.php';raincode=str(links[0]['aws_station_code']);rain=fetch(cur,'SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(raincode,start,end))
   f=frame_features(water,rain);usable=f.reindex(eligible) if not f.empty else pd.DataFrame(index=eligible,columns=FEATURES,dtype=float)
   missing={name:int(usable[name].isna().sum()) for name in FEATURES};row.update(status='ELIGIBLE_AVAILABLE' if not any(missing.values()) else 'ELIGIBLE_MISSING_FEATURES',missing_features=missing,rain_gauge=raincode,rain_provider=provider)
   rain_times={pd.Timestamp(r['observed_at']) for r in rain if r['hourly_rainfall'] is not None and np.isfinite(float(r['hourly_rainfall'])) and float(r['hourly_rainfall'])>=0}
   required=sorted({origin-pd.Timedelta(hours=i) for origin in eligible for i in range(24)})
   if any(missing[k] for k in ['rain_1h','rain_3h','rain_6h','rain_12h','rain_24h']):
    for gap in intervals([x for x in required if x not in rain_times]):requests.append({'event_id':e['event_id'],'river_station_id':sid,'river_station_code':code,'provider':provider,'dataset':'Hourly point rainfall, original gauge identity','observation_station_code':raincode,**gap,'official_source_url':source,'access_status':'Historical AWS tested with current key' if provider=='KMA' else 'Historical access tested; source may still have missing records','action':'Request only these genuine hourly records with QC flags; retain unavailable hours as missing.'})
   if any(missing[k] for k in FEATURES if not k.startswith('rain_')):
    water_times=sorted(pd.Timestamp(w['observed_at']) for w in water if w['water_level'] is not None and np.isfinite(float(w['water_level'])))
    required=sorted({origin-pd.Timedelta(hours=i) for origin in eligible for i in (range(72) if missing['percentile_72h'] else [0,1,2,3,6])})
    absent=[x for x in required if not any(x-pd.Timedelta(minutes=15)<=observed<=x for observed in water_times)]
    for gap in intervals(absent):requests.append({'event_id':e['event_id'],'river_station_id':sid,'river_station_code':code,'provider':'HRFCO / WAMIS','dataset':'Provenanced hourly water level','observation_station_code':code,**gap,'official_source_url':'https://www.hrfco.go.kr/web/openapiPage/reference.do#waterlevel','access_status':'Historical endpoints previously tested','action':'Official raw export or historical hourly API; preserve timestamps, original datum and existing rows.'})
   event_audit.append(row)
  summary={'data_before':'2026-01-01','model_fitted':False,'outcome_counts':dict(Counter(r['status'] for r in event_audit)),'events':event_audit,'acquisition_windows':len(requests),
   'reconstructability':{'origin_season_and_hour':'Available directly from existing KST timestamps; tested as one new paired hypothesis.',
   'point_rain_and_local_water':'Available only where verified observations and known official state overlap; missing windows listed separately.',
   'verified_upstream_trends':'No directed gauge/reach or travel-time mapping is used by this pipeline; shared river membership and distance are insufficient.',
   'catchment_rainfall':'Nearest-point links are not catchment weights. No verified time-versioned gauge-to-basin weighting was supplied.',
   'dam_release':'Gauge flow_rate is not a verified dam-release feed. No verified historical dam-to-target routing/availability mapping was supplied.'},
   'potential_context_tables':[n for n in names if any(k in n.lower() for k in ['basin','catchment','upstream','dam','discharge','kwater'])]}
  (OUT/'eligible-warning-data-audit.json').write_text(json.dumps(summary,default=str,indent=2),encoding='utf-8')
  (OUT/'eligible-warning-data-requests.json').write_text(json.dumps(requests,default=str,indent=2),encoding='utf-8')
  with (OUT/'eligible-warning-data-requests.csv').open('w',encoding='utf-8-sig',newline='') as file:
   if requests:w=csv.DictWriter(file,fieldnames=list(requests[0]));w.writeheader();w.writerows(requests)
  print(json.dumps({'accepted_stations':saved['accepted_stations'],'accepted_horizons':len(accepted),'level_problems':len(problems),'event_audit':summary['outcome_counts'],'acquisition_windows':len(requests)}))
 finally:cur.close();conn.close()
if __name__=='__main__':run()
