"""Development-only comparison; immutable deployed artifacts and no final-test scoring."""
import argparse,json,hashlib,warnings
from pathlib import Path
import numpy as np,pandas as pd,sklearn
from sklearn.base import clone
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge,ElasticNet,HuberRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.dummy import DummyRegressor
from sklearn.exceptions import ConvergenceWarning
from level_research import load_station,metrics,regimes,WATER_FEATURES,RAIN_FEATURES,POLICY,stamp,encode
from pipeline import connect
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'reports/scientific-upgrade-20261109'

def features(frame):
 d=frame.copy();d['trend_accel_3']=d.change_1-d.change_3/3;d['trend_accel_6']=d.change_3/3-d.change_6/6;d['variability_ratio']=d.std_6/(d.std_24+.001)
 return d

def fit(model,tr,cols):
 with warnings.catch_warnings():
  warnings.simplefilter('error',ConvergenceWarning);return clone(model).fit(tr[cols],tr.target)

def tail_diagnostics(train,data,pred):
 """Keep authentic extremes; measure their errors rather than deleting targets."""
 error=np.asarray(pred)-data.actual.to_numpy();squared=error**2
 cutoff=float(train.target.abs().quantile(.95));extreme=data.target.abs().to_numpy()>=cutoff
 top=max(1,int(np.ceil(len(data)*.01)))
 return {'training_p95_absolute_change_m':cutoff,'large_observed_change_samples':int(extreme.sum()),
  'large_observed_change':metrics(data.actual[extreme],np.asarray(pred)[extreme]),
  'large_observed_change_persistence':metrics(data.actual[extreme],data.level[extreme]),
  'largest_1pct_errors_sse_fraction':float(np.sort(squared)[-top:].sum()/squared.sum()) if squared.sum() else 0,
  'largest_errors':[{'origin':str(data.index[i]),'current_level_m':float(data.level.iloc[i]),'actual_level_m':float(data.actual.iloc[i]),'predicted_level_m':float(np.asarray(pred)[i]),'error_m':float(error[i])} for i in np.argsort(squared)[-5:][::-1]],
  'extreme_observations_removed':0}

def cv_eligible(folds):
 if len(folds)!=2:return False
 total=sum(f['candidate']['pairs'] for f in folds)
 mae=lambda key:sum(f[key]['mae_m']*f[key]['pairs'] for f in folds)/total
 mse=lambda key:sum(f[key]['rmse_m']**2*f[key]['pairs'] for f in folds)/total
 return (all(f['candidate']['mae_m']<=f['persistence']['mae_m'] for f in folds)
  and mae('candidate')<mae('persistence')*(1-POLICY['acceptance']['selection_mae_relative_improvement'])
  and mse('candidate')<=mse('persistence'))

def development_gate(candidate,baseline,reg):
 return (candidate['mae_m']<baseline['mae_m']*(1-POLICY['acceptance']['selection_mae_relative_improvement'])
  and candidate['rmse_m']<=baseline['rmse_m']*POLICY['acceptance']['selection_rmse_ratio_max']
  and all(g['samples']<POLICY['acceptance']['minimum_regime_samples'] or g['selected']['mae_m']<=g['persistence']['mae_m']*POLICY['acceptance']['regime_mae_ratio_max']
   for k,g in reg['groups'].items() if k in ['rising','high_water_proxy']))

def robust_features(frame):
 d=features(frame);d['positive_rise_6']=d.level.diff().clip(lower=0).rolling(6,min_periods=6).sum()
 d['rise_consistency_6']=d.level.diff().gt(0).astype(float).where(d.level.diff().notna()).rolling(6,min_periods=6).mean()
 d['rain_growth_6']=2*d.rain_6-d.rain_12
 d['rise_rain_interaction']=d.change_3.clip(lower=0)*np.log1p(d.rain_6)
 return d

def robust_run(output_dir):
 """Extension of this research runner; never modifies deployment or acceptance."""
 out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
 previous=json.loads((ROOT/'reports/scientific-continuation-20261109/level-development-results.json').read_text())
 frozen={(int(r['station_id']),int(r['horizon_hours'])):r for r in previous['results']}
 report=json.loads((ROOT/'reports/level-upgrade/training.json').read_text(encoding='utf-8'))
 stations=[s for s in report['stations'] if (int(s['station_id']),3) in frozen]
 design={'created_at':stamp(),'station_ids':[s['station_id'] for s in stations],'horizons':[3,6],
  'selection':'Same frozen 12-station cohort and train/selection dates as November 9 continuation',
  'cv':'Two expanding training-only 168h folds at .70/.85; timestamp-based 78h embargo',
  'candidate_selection':'Require >=5% pooled CV MAE improvement, nonworse MAE in each fold and nonworse pooled CV RMSE; choose minimum pooled CV RMSE. Assess that choice once on inspected selection; retain persistence if existing MAE/RMSE/rising/high-water selection requirements fail.',
  'independent_acceptance':'NOT_EVALUATED_NOT_DEPLOYED','final_test_used':False,'extreme_targets_removed':0,
  'limits':'Selection already inspected; all performance remains development-only. No verified catchment/upstream features are fabricated.',
  'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
  'environment':{'numpy':np.__version__,'pandas':pd.__version__,'sklearn':sklearn.__version__}}
 specs=[('RIDGE_50',make_pipeline(StandardScaler(),Ridge(alpha=50)),1.,False),
  ('HUBER',make_pipeline(StandardScaler(),HuberRegressor(epsilon=1.35,alpha=1.,max_iter=2000)),1.,False)]
 for loss in ['absolute_error','squared_error']:
  for leaves in [3,7]:
   specs.append(('HGB_'+loss+'_'+str(leaves),HistGradientBoostingRegressor(loss=loss,learning_rate=.03,max_iter=100,max_leaf_nodes=leaves,min_samples_leaf=100,l2_regularization=25,early_stopping=False,random_state=42),1.,False))
 specs.extend([('HGB_MAE_HALF',HistGradientBoostingRegressor(loss='absolute_error',learning_rate=.03,max_iter=100,max_leaf_nodes=3,min_samples_leaf=100,l2_regularization=25,early_stopping=False,random_state=42),.5,False),
  ('HGB_SQUARED_SOFT_WEIGHTS',HistGradientBoostingRegressor(loss='squared_error',learning_rate=.03,max_iter=100,max_leaf_nodes=3,min_samples_leaf=100,l2_regularization=25,early_stopping=False,random_state=42),1.,True)])
 design['candidate_specs']=[{'name':name,'model':str(model),'persistence_blend_weight':weight,'soft_training_weights':weighted} for name,model,weight,weighted in specs]
 (out/'robust-development-design.json').write_text(json.dumps(design,indent=2))
 def predict(spec,train,data,cols):
  _,model,weight,weighted=spec;m=clone(model)
  with warnings.catch_warnings():
   warnings.simplefilter('error',ConvergenceWarning)
   if weighted:
    scale=max(.001,float(train.target.abs().quantile(.9)));m.fit(train[cols],train.target,sample_weight=1/(1+train.target.abs().to_numpy()/scale))
   else:m.fit(train[cols],train.target)
  return data.level.to_numpy()+weight*m.predict(data[cols])
 conn=connect();cur=conn.cursor(dictionary=True);rows=[]
 try:
  for station in stations:
   _,frame,_=load_station(cur,station);frame=robust_features(frame)
   for old in station['horizons']:
    h=old['horizon_hours']
    if h not in [3,6]:continue
    saved=frozen[(int(station['station_id']),h)];periods=saved['periods']
    basecols=WATER_FEATURES+RAIN_FEATURES if old.get('model_features')=='PAST_WATER_AND_POINT_RAINFALL' else WATER_FEATURES
    cols=basecols+['trend_accel_3','trend_accel_6','variability_ratio','positive_rise_6','rise_consistency_6']
    if RAIN_FEATURES[0] in basecols:cols+=['rain_growth_6','rise_rain_interaction']
    d=frame.copy();d['actual']=d.level.shift(-h);d['target']=d.actual-d.level
    parts={k:d.loc[periods[k]['from']:periods[k]['to']].dropna(subset=cols+['actual','target']) for k in ['train','selection']};tr,sel=parts['train'],parts['selection']
    if len(tr)<3000 or len(sel)<168:raise ValueError('FROZEN_DEVELOPMENT_COHORT_INCOMPLETE')
    baseline=metrics(sel.actual,sel.level);candidates=[];predictions={}
    for spec in specs:
     folds=[]
     try:
      for frac in [.7,.85]:
       origin=tr.index[int(len(tr)*frac)];past=tr[tr.index<origin-pd.Timedelta(hours=78)];val=tr[(tr.index>=origin)&(tr.index<origin+pd.Timedelta(hours=168))]
       if len(past)<720 or len(val)<168:continue
       p=predict(spec,past,val,cols);folds.append({'candidate':metrics(val.actual,p),'persistence':metrics(val.actual,val.level)})
      p=predict(spec,tr,sel,cols);predictions[spec[0]]=p;reg=regimes(tr,sel,p)
      candidates.append({'name':spec[0],'cv':folds,'cv_eligible':cv_eligible(folds),'selection_metrics':metrics(sel.actual,p),'regimes':reg,'tail':tail_diagnostics(tr,sel,p),
       'cv_rmse_m':float(np.sqrt(sum(f['candidate']['rmse_m']**2*f['candidate']['pairs'] for f in folds)/sum(f['candidate']['pairs'] for f in folds))) if folds else None})
     except (ValueError,FloatingPointError,ConvergenceWarning) as error:candidates.append({'name':spec[0],'status':'NUMERICAL_FIT_FAILED','reason':type(error).__name__,'cv_eligible':False})
    eligible=[c for c in candidates if c.get('cv_eligible')];chosen=min(eligible,key=lambda c:c['cv_rmse_m']) if eligible else None
    selected=chosen['name'] if chosen and development_gate(chosen['selection_metrics'],baseline,chosen['regimes']) else 'PERSISTENCE'
    p=predictions[selected] if selected!='PERSISTENCE' else sel.level.to_numpy()
    row={'station_id':station['station_id'],'station_code':station['external_station_id'],'horizon_hours':h,'training_samples':len(tr),'selection_samples':len(sel),'periods':periods,'features':cols,
     'input_sha256':{k:hashlib.sha256(pd.util.hash_pandas_object(v[cols+['level','actual','target']],index=True).to_numpy().tobytes()).hexdigest() for k,v in parts.items()},
     'persistence':baseline,'training_cv_choice':chosen['name'] if chosen else 'PERSISTENCE','development_method':selected,'after_development':metrics(sel.actual,p),'regimes':regimes(tr,sel,p),'tail':tail_diagnostics(tr,sel,p),'candidates':candidates,'independent_acceptance':'NOT_EVALUATED_NOT_DEPLOYED'}
    rows.append(row)
   (out/'robust-development-results.json').write_text(json.dumps({'design':design,'results':rows},default=encode,indent=2),encoding='utf-8')
   print(json.dumps({'station':station['station_id'],'completed_horizons':len(rows)}),flush=True)
  (out/'robust-development-summary.json').write_text(json.dumps(summarize(rows),indent=2))
 finally:cur.close();conn.close()

def summarize(results):
 summary=[]
 for h in sorted({r['horizon_hours'] for r in results}):
  rows=[r for r in results if r['horizon_hours']==h];n=sum(r['selection_samples'] for r in rows)
  row={'horizon_hours':h,'stations':len(rows),'pairs':n,'beat_persistence':sum(r['after_development']['mae_m']<r['persistence']['mae_m'] for r in rows)}
  for name,key in [('persistence','persistence'),('candidate','after_development')]:
   row[name]={'station_mean_mae_m':float(np.mean([r[key]['mae_m'] for r in rows])),
    'pooled_mae_m':sum(r[key]['mae_m']*r['selection_samples'] for r in rows)/n,
    'pooled_rmse_m':float(np.sqrt(sum(r[key]['rmse_m']**2*r['selection_samples'] for r in rows)/n))}
  row['station_mae_changes_m']=sorted([{'station_code':r['station_code'],'candidate_minus_persistence_mae_m':r['after_development']['mae_m']-r['persistence']['mae_m']} for r in rows],key=lambda r:r['candidate_minus_persistence_mae_m'],reverse=True)
  row['regime_metrics']={}
  for regime in ['rising','high_water_proxy','heavy_point_rain','wet','dry']:
   groups=[r.get('regimes',{}).get('groups',{}).get(regime) for r in rows]
   groups=[g for g in groups if g and g['samples'] and g['selected'] and g['persistence']]
   count=sum(g['samples'] for g in groups)
   if count:row['regime_metrics'][regime]={'pairs':count,'stations':len(groups),
    'candidate_pooled_mae_m':sum(g['samples']*g['selected']['mae_m'] for g in groups)/count,
    'persistence_pooled_mae_m':sum(g['samples']*g['persistence']['mae_m'] for g in groups)/count,
    'candidate_pooled_rmse_m':float(np.sqrt(sum(g['samples']*g['selected']['rmse_m']**2 for g in groups)/count)),
    'persistence_pooled_rmse_m':float(np.sqrt(sum(g['samples']*g['persistence']['rmse_m']**2 for g in groups)/count)),
    'interpretation':'Training-defined regimes and 72h time episodes are storm proxies, not verified flood events; missing rain excluded from wet/dry.'}
  summary.append(row)
 return summary

def run(output_dir=OUT,include_persistence=False):
 OUT=Path(output_dir)
 report=json.loads((ROOT/'reports/level-upgrade/training.json').read_text(encoding='utf-8'))
 selected=[s for s in report['stations'] if s.get('artifact_name') and all(h.get('evaluation',{}).get('periods',{}).get('train',{}).get('samples',0)>=3000 for h in s.get('horizons',[]))][:12]
 design={'created_at':stamp(),'station_ids':[s['station_id'] for s in selected],'selection':'First 12 in station-ID order with >=3000 frozen training samples per horizon; not selected by holdout results','horizons':[1,3,6],'purge_hours':78,'development':'Two expanding folds within frozen training; evaluate chosen candidate once on original selection window','target':'Direct stage change at 1/3/6h; actual level = latest level + predicted change','final_test_read_for_scoring':False,'deploy':False,'candidate_grid':{'Ridge':[.5,5,50],'ElasticNet':[.0001,.001],'HistGradientBoosting':{'loss':'absolute_error','max_iter':60,'max_leaf_nodes':7,'l2_regularization':10}},'new_features':['trend_accel_3','trend_accel_6','variability_ratio'],'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'limitations':['Existing selection has been inspected; these are development results only.','No retraining of deployed artifacts or independent acceptance claim.']}
 design['persistence_in_training_cv']=include_persistence
 design['environment']={'numpy':np.__version__,'pandas':pd.__version__,'sklearn':sklearn.__version__}
 OUT.mkdir(exist_ok=True,parents=True);(OUT/'level-development-design.json').write_text(json.dumps(design,indent=2))
 conn=connect();cur=conn.cursor(dictionary=True);results=[]
 try:
  for station in selected:
   _,frame,_=load_station(cur,station);frame=features(frame)
   for old in station['horizons']:
    h=old['horizon_hours'];periods=old['evaluation']['periods'];cols=WATER_FEATURES+RAIN_FEATURES if old.get('model_features')=='PAST_WATER_AND_POINT_RAINFALL' else WATER_FEATURES
    # Only original development periods are used. Horizon targets use the same hourly grid.
    d=frame.copy();d['actual']=d.level.shift(-h);d['target']=d.actual-d.level
    tr=d.loc[periods['train']['from']:periods['train']['to']].dropna(subset=cols+['target']);sel=d.loc[periods['selection']['from']:periods['selection']['to']].dropna(subset=cols+['target'])
    if len(tr)<3000 or len(sel)<168:continue
    extra=cols+['trend_accel_3','trend_accel_6','variability_ratio'];baseline=metrics(sel.actual,sel.level)
    before={}
    oldmodels={'RIDGE':make_pipeline(StandardScaler(),Ridge(alpha=5)),'ELASTIC_NET':make_pipeline(StandardScaler(),ElasticNet(alpha=.001,l1_ratio=.15,max_iter=1500,random_state=42))}
    if len(tr)>=4000:oldmodels['HIST_GRADIENT_BOOSTING']=HistGradientBoostingRegressor(max_iter=60,max_leaf_nodes=15,l2_regularization=5,early_stopping=False,random_state=42)
    for name,m in oldmodels.items():
     try:before[name]=metrics(sel.actual,sel.level+fit(m,tr,cols).predict(sel[cols]))
     except (ValueError,ConvergenceWarning):before[name]={'status':'NUMERICAL_FIT_FAILED'}
    candidates=[('RIDGE_'+str(a),make_pipeline(StandardScaler(),Ridge(alpha=a))) for a in [.5,5,50]]+ [('ELASTIC_NET_'+str(a),make_pipeline(StandardScaler(),ElasticNet(alpha=a,l1_ratio=.15,max_iter=4000,random_state=42))) for a in [.0001,.001]]
    if include_persistence:candidates.insert(0,('PERSISTENCE',DummyRegressor(strategy='constant',constant=0)))
    # Same development complexity/data prerequisite as the existing engine.
    from level_research import events
    if len(tr)>=4000 and events(tr,tr.change_1.abs()>.02)>=3:candidates.append(('HGB_MAE',HistGradientBoostingRegressor(loss='absolute_error',max_iter=60,max_leaf_nodes=7,l2_regularization=10,early_stopping=False,random_state=42)))
    scores=[]
    for name,m in candidates:
     folds=[]
     for frac in [.7,.85]:
      origin=tr.index[int(len(tr)*frac)];past=tr[tr.index<origin-pd.Timedelta(hours=78)];val=tr[(tr.index>=origin)&(tr.index<origin+pd.Timedelta(hours=168))]
      if len(past)<720 or len(val)<168:continue
      try:
       p=val.level+fit(m,past,extra).predict(val[extra]);folds.append({'candidate':metrics(val.actual,p),'persistence':metrics(val.actual,val.level)})
      except (ValueError,ConvergenceWarning):continue
     if len(folds)==2:
      try:fullfit=fit(m,tr,extra)
      except (ValueError,ConvergenceWarning):continue
      scores.append({'name':name,'cv_mae_m':float(np.mean([f['candidate']['mae_m'] for f in folds])),'folds':folds,'model':fullfit})
    if not scores:continue
    chosen=min(scores,key=lambda v:v['cv_mae_m']);p=sel.level+chosen['model'].predict(sel[extra]);after=metrics(sel.actual,p)
    row={'station_id':station['station_id'],'station_code':station['external_station_id'],'horizon_hours':h,'training_samples':len(tr),'selection_samples':len(sel),'periods':{k:periods[k] for k in ['train','selection']},'persistence':baseline,'before_fixed_candidates':before,'chosen_using_training_cv':chosen['name'],'after_development':after,'regimes':regimes(tr,sel,p),'relative_mae_gain_vs_persistence':1-after['mae_m']/baseline['mae_m'] if baseline['mae_m'] else None,'cv_candidates':[{k:v for k,v in c.items() if k!='model'} for c in scores],'independent_acceptance':'NOT_EVALUATED_NOT_DEPLOYED'}
    row['input_sha256']={name:hashlib.sha256(pd.util.hash_pandas_object(data[extra+['level','actual','target']],index=True).to_numpy().tobytes()).hexdigest() for name,data in [('train',tr),('selection',sel)]}
    row['tail']=tail_diagnostics(tr,sel,p)
    results.append(row)
   (OUT/'level-development-results.json').write_text(json.dumps({'design':design,'results':results},default=encode,indent=2));print(json.dumps({'station':station['station_id'],'completed_horizons':len(results)}),flush=True)
  (OUT/'level-development-summary.json').write_text(json.dumps(summarize(results),indent=2))
 finally:cur.close();conn.close()
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output-dir',type=Path,default=OUT)
 parser.add_argument('--include-persistence',action='store_true',help='Allow training CV to retain persistence instead of forcing an advanced candidate')
 parser.add_argument('--robust-tail',action='store_true',help='Development-only robust-loss and constrained 3h/6h comparisons')
 args=parser.parse_args()
 if args.robust_tail:robust_run(args.output_dir)
 else:run(args.output_dir,args.include_persistence)
