"""Bounded five-station development comparison; no production writes or final scoring."""
import json, hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge, ElasticNet
from sklearn.ensemble import HistGradientBoostingRegressor
from level_research import load_station, WATER_FEATURES, RAIN_FEATURES, events, metrics, regimes, stamp, encode
from level_development_upgrade import features, fit, cv_eligible, development_gate
from pipeline import connect

BACK=Path(__file__).resolve().parent.parent
CODES={'1016695','1016606','1016645','1004693','1018625'}
OUT=BACK/'reports/baseline-priority-20261109'

class DevelopmentCursor:
 """Bound history reads before the saved selection end; no held-out rows fetched."""
 def __init__(self,cursor,start,end):self.cursor,self.start,self.end=cursor,start,end
 def execute(self,sql,args=()):
  if sql.startswith('SELECT observed_at,'):
   sql=sql.replace(' ORDER BY observed_at',' AND observed_at BETWEEN %s AND %s ORDER BY observed_at')
   args=tuple(args)+(str(self.start),str(self.end))
  return self.cursor.execute(sql,args)
 def __getattr__(self,name):return getattr(self.cursor,name)

def development_parts(frame,h,cols,periods):
 d=features(frame);d['actual']=d.level.shift(-h);d['target']=d.actual-d.level
 return {k:d.loc[periods[k]['from']:periods[k]['to']].dropna(subset=cols+['actual','target']) for k in ['train','selection']}

def run():
 OUT.mkdir(parents=True,exist_ok=True)
 report=json.loads((BACK/'reports/level-upgrade/training.json').read_text(encoding='utf-8'))
 stations=[s for s in report['stations'] if str(s['external_station_id']) in CODES]
 design={'created_at':stamp(),'station_codes':sorted(CODES),'horizons':[1,3,6],'final_test_read':False,'deployed':False,
  'hypothesis':'Extra causal acceleration/variability features, stronger linear regularization and constrained absolute-loss boosting may improve consistency on near-flat gauges.',
  'selection':'Two training-only expanding 168h folds with timestamp-based 78h embargo. Require pooled MAE gain >=5%, nonworse fold MAE and pooled RMSE; select minimum CV RMSE, assess once on saved selection.',
  'rain':'Existing frozen water/rain schema; no imputation, no new source mapping.',
  'independent_evaluation':'NOT_EVALUATED; saved holdout already inspected, no promotion from these results.',
  'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 (OUT/'design.json').write_text(json.dumps(design,indent=2),encoding='utf-8')
 conn=connect();cur=conn.cursor(dictionary=True);rows=[]
 try:
  for s in stations:
   ps=[h['holdout']['periods'] for h in s['horizons']]
   start=min(pd.Timestamp(p['train']['from']) for p in ps)-pd.Timedelta(hours=72)
   end=max(pd.Timestamp(p['selection']['to']) for p in ps)+pd.Timedelta(hours=6)
   _,frame,_=load_station(DevelopmentCursor(cur,start,end),s)
   for old in s['horizons']:
    h=old['horizon_hours'];cols=WATER_FEATURES+(RAIN_FEATURES if old['model_features']=='PAST_WATER_AND_POINT_RAINFALL' else [])+['trend_accel_3','trend_accel_6','variability_ratio']
    parts=development_parts(frame,h,cols,old['holdout']['periods']);tr,sel=parts['train'],parts['selection']
    if len(tr)<720 or len(sel)<168:raise ValueError('FROZEN_DEVELOPMENT_HISTORY_INCOMPLETE')
    specs=[('RIDGE_50',make_pipeline(StandardScaler(),Ridge(alpha=50))),('ELASTIC_NET_001',make_pipeline(StandardScaler(),ElasticNet(alpha=.001,l1_ratio=.15,max_iter=4000,random_state=42)))]
    if len(tr)>=4000 and events(tr,tr.change_1.abs()>.02)>=3:specs.append(('HGB_ABSOLUTE',HistGradientBoostingRegressor(loss='absolute_error',learning_rate=.03,max_iter=60,max_leaf_nodes=7,min_samples_leaf=100,l2_regularization=25,early_stopping=False,random_state=42)))
    candidates=[];models={}
    for name,model in specs:
     folds=[]
     for frac in [.7,.85]:
      origin=tr.index[int(len(tr)*frac)];past=tr[tr.index<origin-pd.Timedelta(hours=78)];val=tr[(tr.index>=origin)&(tr.index<origin+pd.Timedelta(hours=168))]
      if len(past)<720 or len(val)<168:continue
      pred=val.level.to_numpy()+fit(model,past,cols).predict(val[cols])
      folds.append({'candidate':metrics(val.actual,pred),'persistence':metrics(val.actual,val.level)})
     eligible=cv_eligible(folds);models[name]=model
     candidates.append({'name':name,'cv':folds,'cv_eligible':eligible,'cv_rmse_m':float(np.sqrt(sum(f['candidate']['rmse_m']**2*f['candidate']['pairs'] for f in folds)/sum(f['candidate']['pairs'] for f in folds))) if folds else None})
    eligible=[c for c in candidates if c['cv_eligible']];chosen=min(eligible,key=lambda c:c['cv_rmse_m']) if eligible else None
    baseline=metrics(sel.actual,sel.level);pred=sel.level.to_numpy()
    if chosen:pred=pred+fit(models[chosen['name']],tr,cols).predict(sel[cols])
    result=metrics(sel.actual,pred);reg=regimes(tr,sel,pred);passes=bool(chosen) and development_gate(result,baseline,reg)
    rows.append({'station_code':s['external_station_id'],'station_id':s['station_id'],'horizon_hours':h,'periods':{k:old['holdout']['periods'][k] for k in ['train','selection']},'samples':{k:len(v) for k,v in parts.items()},'input_sha256':{k:hashlib.sha256(pd.util.hash_pandas_object(v[cols+['level','actual']],index=True).values.tobytes()).hexdigest() for k,v in parts.items()},'training_cv_choice':chosen['name'] if chosen else 'PERSISTENCE','development_candidate':result,'persistence':baseline,'regimes':reg,'passes_development_only':passes,'retained_method':chosen['name'] if passes else 'PERSISTENCE','candidates':candidates})
   (OUT/'development.json').write_text(json.dumps({'design':design,'results':rows},default=encode,indent=2),encoding='utf-8')
   print(json.dumps({'station_code':s['external_station_id'],'completed_horizons':len(rows)}),flush=True)
 finally:cur.close();conn.close()

if __name__=='__main__':run()
