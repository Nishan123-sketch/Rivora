"""Read-only station-by-station availability diagnosis using the frozen feature engine."""
import csv,json,hashlib
from pathlib import Path
import pandas as pd
from pipeline import connect
from level_research import load_station,station_list,partition,periods,WATER_FEATURES,POLICY,kst_now,encode
BACK=Path(__file__).resolve().parent.parent
training=json.loads((BACK/'reports/level-upgrade/training.json').read_text(encoding='utf-8'));models={int(s['station_id']):s for s in training['stations']}
network=json.loads((BACK/'reports/advanced-level-network.json').read_text(encoding='utf-8'));live={int(s['station_id']):s for s in network['stations']}
before_models={int(s['station_id']):s for s in json.loads((BACK/'reports/availability-repair/training-before.json').read_text(encoding='utf-8'))['stations']}
conn=connect();cur=conn.cursor(dictionary=True);results=[]
try:
 for station in station_list(cur):
  q,frame,source=load_station(cur,station);model=models.get(station['station_id'],{});n=live.get(station['station_id'],{})
  present=frame.level.notna() if not frame.empty else pd.Series(dtype=bool);runs=present.groupby(present.ne(present.shift()).cumsum()).sum() if len(present) else []
  valid=frame.index[present] if len(present) else [];latest=valid[-1] if len(valid) else None
  splits={str(h):periods(partition(frame,h,WATER_FEATURES)) if not frame.empty else {} for h in [1,3,6]}
  artifact=BACK/'ml/level_models_v4'/model['artifact_name'] if model.get('artifact_name') else None
  artifact_ok=bool(artifact and artifact.exists() and hashlib.sha256(artifact.read_bytes()).hexdigest()==model.get('artifact_sha256'))
  blocks=[]
  for h,parts in splits.items():
   for name,required in POLICY['minimums'].items():
    actual=parts.get(name,{}).get('samples',0)
    if actual<required:blocks.append({'horizon':int(h),'requirement':name+'_samples','actual':actual,'required':required})
  if q.get('recent_hourly_coverage',0)<.8:blocks.append({'requirement':'recent_hourly_coverage','actual':q.get('recent_hourly_coverage'),'required':.8})
  before=before_models.get(station['station_id'],{})
  results.append({'station_id':station['station_id'],'station_code':station['external_station_id'],'raw_count':q.get('observation_count',0),'raw_without_acceptable_provenance':q.get('raw_unverified_provenance_rows',0),'derived_provenanced_count':q.get('derived_provenanced_count',0),'longest_consecutive_valid_hours':int(max(runs,default=0)),'latest_provenanced_hour':str(latest) if latest is not None else None,'observation_age_hours':float((kst_now()-latest).total_seconds()/3600) if latest is not None else None,'quality':q,'water_only_sample_partitions':splits,'actual_model_horizon_evidence':[{'horizon':h['horizon_hours'],'model_features':h.get('model_features'),'reason':h.get('reason'),'periods':h.get('periods') or h.get('holdout',{}).get('periods') or h.get('evaluation',{}).get('periods'),'advanced_accepted':h.get('advanced_accepted',False)} for h in model.get('horizons',[])],'failed_measured_requirements':blocks,'artifact_checksum_valid':artifact_ok,'trained_candidate_count':model.get('trained_candidate_count',0),'accepted_advanced_models':model.get('accepted_advanced_models',0),'before_eligible':bool(before.get('eligible')),'after_eligible':bool(model.get('eligible')),'horizons':[{'horizon':h['horizon_hours'],'status':h['forecast_status'],'advanced_accepted':h.get('advanced_accepted',False),'reason':h.get('reason'),'value':h.get('predicted_level_m'),'valid_at':h.get('valid_at')} for h in n.get('horizons',[])],'model_blocker':model.get('reason') or next((h.get('reason') for h in model.get('horizons',[]) if h.get('reason')),None),'interpretation':'Missing provenance required independent official retrieval, not a numerical offset. Current point reference does not certify historical datum epochs.'})
 report={'generated_at':str(pd.Timestamp.now(tz='UTC')),'station_count':len(results),'policy_version':POLICY['version'],'stations':results};folder=BACK/'reports/availability-repair';(folder/'station-diagnostics.json').write_text(json.dumps(report,default=encode,indent=2),encoding='utf-8')
 fields=['station_id','station_code','raw_count','raw_without_acceptable_provenance','derived_provenanced_count','longest_consecutive_valid_hours','latest_provenanced_hour','observation_age_hours','artifact_checksum_valid','trained_candidate_count','accepted_advanced_models','before_eligible','after_eligible','model_blocker']
 with (folder/'station-diagnostics.csv').open('w',encoding='utf-8',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows({k:r[k] for k in fields} for r in results)
 print(json.dumps({'stations':len(results),'eligible':sum(r['after_eligible'] for r in results),'artifacts_valid':sum(r['artifact_checksum_valid'] for r in results)}))
finally:cur.close();conn.close()
