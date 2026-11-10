"""Development-only warning research. Never reads 2026 feature/label rows or writes deployable artifacts."""
import json, hashlib
from pathlib import Path
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import average_precision_score
from advanced_warning import frame_features,event_labels,chronological_split,metrics,FEATURES,EMBARGO,new_issuance_origins
from pipeline import connect,fetch
ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent/'reports/system-repair'
CUTOFF=datetime(2026,1,1)

def design():
    return {'version':'development-only-20261108','created_at':datetime.now(timezone.utc).isoformat(),
      'data_before':'2026-01-01','test_data_access':False,'deployable':False,'purge_hours':72,
      'precision_minimum':.2,'event_recall_minimum':.8,'brier_must_beat_training_climatology':True,
      'candidate_selection':'2025 selection block average precision only',
      'calibration':'Separate saved 2025 calibration block; sigmoid; at least 2 events',
      'threshold':'Separate saved 2025 threshold block; precision >=0.2 and event recall >=0.8; at least 2 events',
      'limitation':'Threshold block used to choose thresholds; development results are not independent acceptance. A new untouched future evaluation is required.'}

def dataset(require_provenance=False,match_runtime_scope=True):
    conn=connect();cur=conn.cursor(dictionary=True)
    try:
      stations=fetch(cur,"SELECT DISTINCT s.station_id,s.external_station_id FROM stations s JOIN flood_thresholds f ON f.station_id=s.station_id JOIN official_station_registry o ON o.station_code=s.external_station_id WHERE s.data_source='RIVER_GAUGE' AND f.verification_status='VERIFIED'")
      coverage=fetch(cur,"SELECT * FROM ml_source_coverage WHERE status='COMPLETE' AND start_at < %s",(CUTOFF,))
      events=fetch(cur,'SELECT * FROM hr_flood_warning_history WHERE issued_at < %s ORDER BY issued_at',(CUTOFF,))
      frames=[];audit=[]
      for s in stations:
        code=str(s['external_station_id']);cs=[{**c,'end_at':min(c['end_at'],CUTOFF-timedelta(hours=1))} for c in coverage if str(c['station_code'])==code]
        if not cs: continue
        start=min(c['start_at'] for c in cs)-timedelta(hours=73);end=max(c['end_at'] for c in cs)
        water=fetch(cur,'SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(s['station_id'],start,end))
        raw_unverified=0
        if require_provenance:
          from level_research import source_valid
          raw_unverified=sum(not source_valid(r.get('source_url'),code) for r in water)
          water=[r for r in water if source_valid(r.get('source_url'),code)]
          reconciled=fetch(cur,'SELECT observed_at,water_level,source_url FROM ml_verified_water_history WHERE station_id=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(s['station_id'],start,end))
          water += [r for r in reconciled if source_valid(r.get('source_url'),code)]
        hydro=fetch(cur,'SELECT * FROM hr_rainfall_links WHERE station_id=%s AND distance_km<=30',(s['station_id'],))
        rain=[]
        if hydro:
          rain=fetch(cur,'SELECT observed_at,rainfall_mm AS hourly_rainfall FROM hr_rainfall_history WHERE station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(hydro[0]['rainfall_station_code'],start,end))
        else:
          links=fetch(cur,"SELECT * FROM station_rainfall_links WHERE station_id=%s AND verification_status IN ('VERIFIED','AUTO_NEAREST')",(s['station_id'],))
          if links and links[0]['distance_km'] is not None and float(links[0]['distance_km'])<=30:
            rain=fetch(cur,'SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(links[0]['aws_station_code'],start,end))
        f=frame_features(water,rain)
        if f.empty: continue
        labels=event_labels(f.index,[e for e in events if str(e['station_code'])==code],cs)
        d=f.join(labels).dropna(subset=FEATURES+['label']);d=new_issuance_origins(d) if match_runtime_scope else d[(d.ongoing=='NONE')|((d.label==1)&(d.ongoing!='WARNING'))]
        d['station_id']=int(s['station_id']);d['t']=d.index;frames.append(d.reset_index(drop=True))
        audit.append({'station_id':int(s['station_id']),'water_rows':len(water),'raw_unverified_rows_excluded':raw_unverified,'rain_rows':len(rain),'usable':len(d),'missing_feature_or_label_rows':len(f)-len(d)})
      return pd.concat(frames,ignore_index=True),audit
    finally:cur.close();conn.close()

def qualify_threshold(frame,p):
    # Sorted probability scan: require unchanged precision floor plus event-level recall.
    events=set(frame.loc[frame.label==1,'event_id'].dropna());order=np.argsort(-p,kind='stable');tp=0;found=set();best=None
    if len(events)<2:return None
    ys=frame.label.to_numpy();ids=frame.event_id.to_numpy()
    for j,i in enumerate(order):
      if ys[i]==1:tp+=1;found.add(ids[i])
      if j+1<len(order) and p[order[j+1]]==p[i]:continue
      precision=tp/(j+1);recall=len(found)/max(1,len(events))
      if precision>=.2 and recall>=.8:
        candidate=(precision,float(p[i]))
        if best is None or candidate>best:best=candidate
    return best[1] if best else None

def run():
    OUT.mkdir(exist_ok=True,parents=True)
    manifest=design();manifest['source_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    # Persist candidate rules before fitting. No changes to frozen production policy/artifacts.
    (OUT/'warning-development-design.json').write_text(json.dumps(manifest,indent=2))
    data,audit=dataset();assert data.t.max()<CUTOFF
    policy=json.loads((ROOT/'warning_split_policy.json').read_text())
    splits=chronological_split(data,policy);train=splits['train'];val=splits['validation']
    saved=json.loads((ROOT.parent/'reports/advanced-warning-validation.json').read_text(encoding='utf-8-sig'))
    blocks={k:val[val.t.between(pd.Timestamp(b['start']),pd.Timestamp(b['end']))] for k,b in saved['validation_blocks'].items()}
    assert all(v.loc[v.label==1,'event_id'].nunique()>=2 for v in blocks.values())
    specs=[('Logistic unweighted',make_pipeline(StandardScaler(),LogisticRegression(C=.1,max_iter=600,random_state=42)),FEATURES),
      ('Logistic balanced',make_pipeline(StandardScaler(),LogisticRegression(C=.1,class_weight='balanced',max_iter=600,random_state=42)),FEATURES),
      ('Existing gradient boosting',HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=15,l2_regularization=5,early_stopping=False,random_state=42),FEATURES),
      ('Datum-independent gradient boosting',HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=15,l2_regularization=5,early_stopping=False,random_state=42),[f for f in FEATURES if f!='level'])]
    result={'design':manifest,'status':'DEVELOPMENT_RESEARCH_ONLY','probability_available':False,'audit':audit,
      'counts':{k:{'samples':len(v),'events':int(v.loc[v.label==1,'event_id'].nunique()),'prevalence':float(v.label.mean()),'start':str(v.t.min()),'end':str(v.t.max())} for k,v in {'train':train,**blocks}.items()},'candidates':[]}
    for name,model,features in specs:
      model.fit(train[features],train.label.astype(int));tune=blocks['selection'];cal=blocks['calibration'];decision=blocks['thresholds']
      def logits(frame):
        p=np.clip(model.predict_proba(frame[features])[:,1],1e-6,1-1e-6);return np.log(p/(1-p)).reshape(-1,1)
      ap=float(average_precision_score(tune.label,model.predict_proba(tune[features])[:,1]))
      calibrator=LogisticRegression(C=1,max_iter=500).fit(logits(cal),cal.label.astype(int))
      p=calibrator.predict_proba(logits(decision))[:,1];threshold=qualify_threshold(decision,p)
      row={'name':name,'features':features,'selection_average_precision':ap,'threshold':threshold,
        'decision_metrics':metrics(decision,p,threshold if threshold is not None else 1.000001),
        'baseline_metrics':metrics(decision,np.full(len(decision),float(train.label.mean())),1.000001),
        'status':'NO_QUALIFYING_DEVELOPMENT_THRESHOLD' if threshold is None else 'DEVELOPMENT_THRESHOLD_ONLY'}
      result['candidates'].append(row);print(json.dumps({'candidate':name,'selection_ap':ap,'status':row['status']}),flush=True)
      (OUT/'warning-development-results.json').write_text(json.dumps(result,indent=2))
    result['selected_by_development_ap']=max(result['candidates'],key=lambda r:r['selection_average_precision'])['name']
    (OUT/'warning-development-results.json').write_text(json.dumps(result,indent=2))
if __name__=='__main__':run()
