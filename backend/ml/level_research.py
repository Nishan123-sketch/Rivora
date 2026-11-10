"""Reproducible, observation-only, direct multi-horizon level research pipeline.
Warning classifier files and coverage are never written by this module.
"""
import argparse, hashlib, json, os, time, warnings
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
import numpy as np
import pandas as pd
import joblib, sklearn
from sklearn.pipeline import make_pipeline
from sklearn.exceptions import ConvergenceWarning
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge, ElasticNet
from sklearn.ensemble import HistGradientBoostingRegressor
from pipeline import connect, fetch
ROOT=Path(__file__).resolve().parent
BACK=ROOT.parent
POLICY=json.loads((ROOT/'level_policy.json').read_text())
REPORT=BACK/'reports/level-upgrade'
ARTIFACTS=ROOT/'level_models_v4'
WATER_FEATURES=['change_1','change_3','change_6','change_12','change_24','acceleration','mean_6_delta','mean_24_delta','std_6','std_24']
RAIN_FEATURES=['rain_1','rain_3','rain_6','rain_12','rain_24','rain_48','rain_72','api_24']
HOLD_CODES={'1022640','1018680','1021650'}
ENGINE_SHA=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

def stamp(): return datetime.now(timezone.utc).isoformat()
def kst_now(): return pd.Timestamp.now(tz='Asia/Seoul').tz_localize(None)
def encode(x):
 if isinstance(x,(np.integer,)):return int(x)
 if isinstance(x,(np.floating,)):return float(x) if np.isfinite(x) else None
 if isinstance(x,(pd.Timestamp,datetime)):return str(x)
 raise TypeError(type(x).__name__)
def save_json(file,value):
 file.parent.mkdir(parents=True,exist_ok=True);temp=file.with_suffix(file.suffix+'.tmp')
 temp.write_text(json.dumps(value,default=encode,allow_nan=False,indent=2),encoding='utf-8');os.replace(temp,file)
def source_valid(url,code):
 try:
  u=urlparse(str(url or ''));host=(u.hostname or '').lower()
  if u.scheme not in ['http','https']:return False
  if host in ['wamis.go.kr','www.wamis.go.kr']:
   return str(parse_qs(u.query).get('obscd',[''])[0])==str(code) and u.path.endswith('/wl_hrdata')
  return host in ['hrfco.go.kr','www.hrfco.go.kr','www.nakdongriver.go.kr','www.geumriver.go.kr','www.yeongsanriver.go.kr']
 except Exception:return False

def quality_and_frame(raw,verified,code,rain):
 """Raw data is retained. Only provenanced rows build the derived feature frame."""
 raw=pd.DataFrame(raw);verified=pd.DataFrame(verified)
 if raw.empty:return {'observation_count':0,'flags':['NO_OBSERVATIONS'],'forecasting_eligible':False,'exclusion_reason':'NO_OBSERVATIONS'},pd.DataFrame()
 raw['observed_at']=pd.to_datetime(raw.observed_at,errors='coerce');raw['water_level']=pd.to_numeric(raw.water_level,errors='coerce')
 invalid_times=int(raw.observed_at.isna().sum());future_times=int((raw.observed_at>kst_now()).sum());raw_count=len(raw)
 valid_time=raw.observed_at.notna();raw=raw[valid_time].sort_values('observed_at')
 flags=[]
 if invalid_times:flags.append('INVALID_TIMESTAMPS')
 if future_times:flags.append('FUTURE_TIMESTAMPS_EXCLUDED')
 bad_numeric=int((raw.water_level.isna()|~np.isfinite(raw.water_level)).sum())
 if bad_numeric:flags.append('NONFINITE_LEVELS')
 provenance=raw.source_url.map(lambda u:source_valid(u,code));missing=int((~provenance).sum())
 if missing:flags.append('UNVERIFIED_RAW_PROVENANCE')
 conflict=int(raw.groupby('observed_at').water_level.nunique().gt(1).sum())
 if conflict:flags.append('CONFLICTING_DUPLICATE_OBSERVATIONS')
 clean=raw[provenance&raw.water_level.notna()&np.isfinite(raw.water_level)].copy()
 clean=clean.drop_duplicates('observed_at',keep='last')
 conflicts=0
 if not verified.empty:
  verified['observed_at']=pd.to_datetime(verified.observed_at);verified['water_level']=pd.to_numeric(verified.water_level)
  overlap=raw.merge(verified,on='observed_at',suffixes=('_raw','_verified'))
  conflicts=int((abs(overlap.water_level_raw-overlap.water_level_verified)>.001).sum())
  if conflicts:flags.append('OFFICIAL_HISTORY_DIFFERS_FROM_LEGACY_ROWS')
  clean=pd.concat([clean,verified],ignore_index=True).drop_duplicates('observed_at',keep='last')
 clean=clean[clean.observed_at<=kst_now()].sort_values('observed_at')
 if clean.empty:return {'observation_count':len(raw),'unverified_provenance_rows':missing,'flags':flags+['NO_PROVENANCED_HISTORY'],'forecasting_eligible':False,'exclusion_reason':'NO_PROVENANCED_HISTORY'},pd.DataFrame()
 # Official timestamps are assigned only backward, within 15 min; never future fill.
 end=clean.observed_at.max().floor('h');start=max(clean.observed_at.min().ceil('h'),end-pd.Timedelta(days=POLICY['history_days']))
 grid=pd.date_range(start,end,freq='h');left=pd.DataFrame({'t':grid})
 joined=pd.merge_asof(left,clean.rename(columns={'observed_at':'t'}).sort_values('t'),on='t',direction='backward',tolerance=pd.Timedelta(minutes=15))
 frame=pd.DataFrame({'level':joined.water_level.to_numpy()},index=grid)
 for h in [1,3,6,12,24]:frame['change_'+str(h)]=frame.level-frame.level.shift(h)
 frame['acceleration']=frame.change_1-frame.change_1.shift(1)
 for h in [6,24]:frame['mean_'+str(h)+'_delta']=frame.level.rolling(h,min_periods=h).mean()-frame.level;frame['std_'+str(h)]=frame.level.rolling(h,min_periods=h).std()
 r=pd.DataFrame(rain)
 if not r.empty:
  r['observed_at']=pd.to_datetime(r.observed_at);r['rainfall']=pd.to_numeric(r.rainfall,errors='coerce');r.loc[r.rainfall<0,'rainfall']=np.nan
  r=r[r.observed_at.dt.minute.eq(0)&r.observed_at.dt.second.eq(0)].drop_duplicates('observed_at',keep='last').set_index('observed_at')
  frame['rain_1']=r.rainfall.reindex(grid)
 else:frame['rain_1']=np.nan
 for h in [3,6,12,24,48,72]:frame['rain_'+str(h)]=frame.rain_1.rolling(h,min_periods=h).sum()
 # A finite antecedent index requires all 24 real observations.
 frame['api_24']=frame.rain_1.rolling(24,min_periods=24).apply(lambda x:float(np.dot(x,np.power(.9,np.arange(23,-1,-1)))),raw=True)
 jumps=frame.change_1.abs()>5
 if jumps.any():flags.append('LARGE_HOURLY_CHANGE_REQUIRES_REVIEW_NOT_PROOF_OF_ERROR')
 groups=(frame.level.ne(frame.level.shift())|frame.level.isna()).cumsum();runs=frame.groupby(groups).size();longest_flat=int(runs.max())
 latest_flat=int(runs.iloc[-1]) if pd.notna(frame.level.iloc[-1]) else 0
 if longest_flat>=72:flags.append('LONG_CONSTANT_READING_REVIEW')
 rolling_before=frame.level.shift(6).rolling(24,min_periods=24).median();step=(frame.level.rolling(6,min_periods=6).median()-rolling_before).abs()>1
 if step.any():flags.append('SUSPECTED_STEP_OR_REAL_HYDROLOGICAL_RISE_NO_DATUM_CORRECTION')
 # Features at a suspicious jump are withheld; extreme target values remain intact.
 frame.loc[jumps,WATER_FEATURES]=np.nan
 present=frame.level.notna();times=frame.index[present];gaps=np.diff(times.to_numpy(dtype='datetime64[ns]').astype(np.int64))/3.6e12 if len(times)>1 else np.array([])
 recent=frame.tail(24*120);coverage=float(recent.level.notna().mean()) if len(recent) else 0
 raw_diffs=raw.observed_at.diff().dt.total_seconds().dropna();frequency=float(raw_diffs[raw_diffs>0].median()/60) if (raw_diffs>0).any() else None
 q={'historical_start':str(raw.observed_at.min()),'historical_end':str(raw.observed_at.max()),'observation_count':raw_count,'invalid_timestamp_rows':invalid_times,'future_timestamp_rows':future_times,'derived_provenanced_count':len(clean),'raw_unverified_provenance_rows':missing,'official_reconciliation_value_differences':conflicts,'duplicate_records':int(raw.observed_at.duplicated().sum()),'conflicting_duplicates':conflict,'invalid_numeric_rows':bad_numeric,'sampling_median_minutes':frequency,'hourly_grid_samples':len(frame),'missing_percentage':100*float(frame.level.isna().mean()),'recent_hourly_coverage':coverage,'longest_gap_hours':float(max(gaps,default=0)),'historical_datum_epochs':'UNAVAILABLE','relocation_history':'UNAVAILABLE','rainfall_hour_coverage':float(frame.rain_1.notna().mean()),'rainfall_72h_coverage':float(frame.rain_72.notna().mean()),'longest_constant_hours':longest_flat,'latest_constant_hours':latest_flat,'suspected_discontinuity_hours':int(step.sum()),'suspected_discontinuity_examples':[str(t) for t in frame.index[step][:8]],'flags':flags,'forecasting_eligible':coverage>=POLICY['minimum_recent_hour_coverage'] and conflict==0 and latest_flat<72,'exclusion_reason':None}
 if not q['forecasting_eligible']:q['exclusion_reason']='CONFLICTING_DUPLICATES' if conflict else 'CONSTANT_READING_REVIEW' if latest_flat>=72 else 'INSUFFICIENT_RECENT_PROVENANCED_COVERAGE'
 return q,frame

def metrics(y,p):
 y=np.asarray(y,float);p=np.asarray(p,float)
 if not len(y):return None
 d=p-y;a=abs(d);return {'pairs':len(y),'mae_m':float(a.mean()),'rmse_m':float(np.sqrt(np.mean(d*d))),'bias_m':float(d.mean()),'median_absolute_error_m':float(np.median(a)),'p95_absolute_error_m':float(np.quantile(a,.95))}
def events(frame,mask):
 times=frame.index[np.asarray(mask)];return int(1+np.sum(np.diff(times.to_numpy(dtype='datetime64[ns]').astype(np.int64))>72*3600e9)) if len(times) else 0
def regimes(train,test,pred):
 high=float(train.level.quantile(.9));rise=max(.02,float(train.loc[train.change_1>0,'change_1'].quantile(.75))) if (train.change_1>0).any() else .02
 masks={'rising':test.change_1>=rise,'high_water_proxy':test.level>=high,'heavy_point_rain':test.rain_6>=30,'wet':test.rain_6>0,'dry':test.rain_6.eq(0)}
 return {'definitions':{'high_water_cutoff_m':high,'rise_cutoff_m_per_hour':rise,'storm_separation_hours':72,'warning':'Training-derived conditions, not flood-event labels or independently verified historical threshold exceedances.'},'groups':{k:{'samples':int(m.sum()),'independent_time_episodes':events(test,m),'selected':metrics(test.actual[m],pred[m]),'persistence':metrics(test.actual[m],test.level[m]),'status':'EVALUATED' if m.sum()>=40 else 'LIMITED_SAMPLES'} for k,m in masks.items()}}
def bootstrap(test,pred):
 delta=abs(test.actual-test.level)-abs(test.actual-pred);blocks=delta.groupby(test.index.floor('72h')).mean().to_numpy();n=len(blocks)
 if n<POLICY['acceptance']['minimum_bootstrap_blocks']:return {'status':'INSUFFICIENT_TIME_BLOCKS','blocks':n,'ci95_mae_improvement_m':None}
 rng=np.random.default_rng(42);means=blocks[rng.integers(0,n,size=(500,n))].mean(axis=1)
 return {'status':'TIME_BLOCK_BOOTSTRAP','blocks':n,'block_hours':72,'replicates':500,'ci95_mae_improvement_m':[float(np.quantile(means,.025)),float(np.quantile(means,.975))],'limitation':'Equal-time-block-weighted MAE improvement. Time blocks are proxies, not independently identified meteorological storms.'}
def partition(frame,horizon,features):
 data=frame.copy();data['actual']=data.level.shift(-horizon);data['target']=data.actual-data.level
 # Split timestamps are fixed from the hourly grid, not chosen using future targets.
 edges=[data.index[int(len(data)*f)] for f in POLICY['split_fractions']];purge=pd.Timedelta(hours=POLICY['purge_hours'])
 masks=[data.index<edges[0]-purge,(data.index>=edges[0])&(data.index<edges[1]-purge),(data.index>=edges[1])&(data.index<edges[2]-purge),data.index>=edges[2]]
 return {name:data[mask].dropna(subset=features+['level','actual']) for name,mask in zip(['train','selection','calibration','test'],masks)}
def periods(parts):return {k:{'from':str(v.index.min()),'to':str(v.index.max()),'samples':len(v)} for k,v in parts.items()}
def candidate_predict(name,model,data,features,h,trend_limit):
 if name=='PERSISTENCE':return data.level.to_numpy()
 if name=='BOUNDED_TREND':return data.level.to_numpy()+np.clip(data.change_1.to_numpy(),-trend_limit,trend_limit)*h
 return data.level.to_numpy()+model.predict(data[features])
def fit_candidates(train,features):
 candidates={'RIDGE':make_pipeline(StandardScaler(),Ridge(alpha=5)), 'ELASTIC_NET':make_pipeline(StandardScaler(),ElasticNet(alpha=.001,l1_ratio=.15,max_iter=1500,random_state=42))}
 # Large-tree comparison requires more data and diverse development episodes.
 if len(train)>=4000 and events(train,train.change_1.abs()>.02)>=3:candidates['HIST_GRADIENT_BOOSTING']=HistGradientBoostingRegressor(max_iter=60,max_leaf_nodes=15,l2_regularization=5,early_stopping=False,random_state=42)
 fitted={}
 for name,m in candidates.items():
  try:
   with warnings.catch_warnings():
    warnings.simplefilter('error',ConvergenceWarning);m.fit(train[features],train.target)
   fitted[name]=m
  except (ValueError,FloatingPointError,ConvergenceWarning):pass
 return fitted

def evaluate_station_horizon(frame,h):
 base={'horizon_hours':h,'forecast_status':'UNAVAILABLE','reason':None,'predicted_level_m':None,'prediction_type':'RIVER_WATER_LEVEL_NOT_FLOOD_PROBABILITY','interval':{'status':'UNAVAILABLE','calibrated':False}}
 # Rainfall variant eligibility uses training/development coverage only.
 water=partition(frame,h,WATER_FEATURES)
 if any(len(water[k])<POLICY['minimums'][k] for k in water):return {**base,'reason':'INSUFFICIENT_PROVENANCED_CHRONOLOGICAL_SAMPLES','periods':periods(water)},None
 parts=water;features=WATER_FEATURES;rain_parts=partition(frame,h,WATER_FEATURES+RAIN_FEATURES)
 if all(len(rain_parts[k])>=POLICY['minimums'][k] for k in ['train','selection','calibration']) and len(rain_parts['train'])>=.8*len(water['train']):parts=rain_parts;features=WATER_FEATURES+RAIN_FEATURES
 # Test missingness can withhold a preselected rainfall variant, never choose another variant.
 if len(parts['test'])<POLICY['minimums']['test']:return {**base,'reason':'PRESELECTED_SCHEMA_TEST_INPUTS_INSUFFICIENT','periods':periods(parts)},None
 train,selection,cal,test=(parts[k] for k in ['train','selection','calibration','test'])
 trend_limit=max(.001,float(train.change_1.abs().quantile(.95)))
 fitted=fit_candidates(train,features);models={'PERSISTENCE':None,'BOUNDED_TREND':None,**fitted};selection_metrics={};fold_metrics={};eligible=[]
 baseline=metrics(selection.actual,selection.level)
 for name,m in models.items():
  p=candidate_predict(name,m,selection,features,h,trend_limit);selection_metrics[name]=metrics(selection.actual,p)
  if name=='PERSISTENCE':continue
  folds=[]
  for fraction in [.70,.85]:
   origin=int(len(train)*fraction);tr=train.iloc[:max(0,origin-POLICY['purge_hours'])];v=train.iloc[origin:origin+168]
   if len(tr)<720 or len(v)<168:continue
   fm=None
   if m is not None:
    from sklearn.base import clone
    try:
     with warnings.catch_warnings():
      warnings.simplefilter('error',ConvergenceWarning);fm=clone(m).fit(tr[features],tr.target)
    except (ValueError,FloatingPointError,ConvergenceWarning):continue
   fp=candidate_predict(name,fm,v,features,h,max(.001,float(tr.change_1.abs().quantile(.95))));folds.append({'selected':metrics(v.actual,fp),'persistence':metrics(v.actual,v.level),'from':str(v.index.min()),'to':str(v.index.max())})
  fold_metrics[name]=folds;v=selection_metrics[name]
  if len(folds)>=2 and all(f['selected']['mae_m']<=f['persistence']['mae_m'] for f in folds) and v['mae_m']<baseline['mae_m']*.95 and v['rmse_m']<=baseline['rmse_m']:eligible.append(name)
 chosen=min(eligible,key=lambda k:selection_metrics[k]['mae_m']) if eligible else 'PERSISTENCE'
 pred=candidate_predict(chosen,models[chosen],test,features,h,trend_limit);test_metrics=metrics(test.actual,pred);persistence=metrics(test.actual,test.level);reg=regimes(train,test,pred);ci=bootstrap(test,pred)
 improvement=1-test_metrics['mae_m']/persistence['mae_m'] if persistence['mae_m']>0 else None
 regime_pass=all(v['samples']<40 or v['selected']['mae_m']<=v['persistence']['mae_m']*1.1 for k,v in reg['groups'].items() if k in ['rising','high_water_proxy'])
 advanced_accepted=chosen!='PERSISTENCE' and improvement is not None and improvement>=.05 and test_metrics['rmse_m']<=persistence['rmse_m'] and regime_pass and ci['ci95_mae_improvement_m'] is not None and ci['ci95_mae_improvement_m'][0]>0
 evaluation={'periods':periods(parts),'selection_candidates':selection_metrics,'rolling_origin':fold_metrics,'chosen_on_development':chosen,'chosen_test':test_metrics,'persistence':persistence,'mae_improvement_fraction':improvement,'regimes':reg,'block_uncertainty':ci,'advanced_accepted':advanced_accepted,'test_used_for_selection':False,'evaluation_type':'RETROSPECTIVE'}
 # Freeze the tested coefficients. No refit on the final holdout.
 deploy=chosen if advanced_accepted else 'PERSISTENCE';dep_pred=pred if advanced_accepted else test.level.to_numpy();dep_metrics=test_metrics if advanced_accepted else persistence
 calpred=candidate_predict(deploy,models[deploy],cal,features,h,trend_limit);residual=abs(cal.actual.to_numpy()-calpred);n=len(residual)
 radius=float(np.quantile(residual,min(1,np.ceil((n+1)*.9)/n),method='higher')) if n else None
 coverage=float(np.mean(abs(test.actual.to_numpy()-dep_pred)<=radius)) if radius is not None else None
 cb=cal.index.floor('72h').nunique();tb=test.index.floor('72h').nunique();interval_ok=cb>=8 and tb>=8 and .85<=coverage<=.97 if coverage is not None else False
 interval={'status':'RETROSPECTIVE_COVERAGE_CHECKED' if interval_ok else 'UNAVAILABLE','calibrated':False,'empirical_coverage_checked':interval_ok,'nominal_coverage':.9,'test_coverage':coverage,'calibration_blocks':cb,'test_blocks':tb,'radius_m':radius if interval_ok else None,'limitation':'Chronological empirical residual interval; exchangeability and future coverage are not guaranteed. Not flood probability.'}
 artifact={'family':deploy,'model':models[deploy],'features':features,'horizon':h,'trend_limit':trend_limit,'training_period':periods(parts)['train'],'evaluation':evaluation,'interval':interval,'schema_version':POLICY['version']}
 model_comparison={k:metrics(test.actual,candidate_predict(k,m,test,features,h,trend_limit)) for k,m in models.items()}
 result={**base,'reason':None,'model_kind':deploy,'validation_status':'RETROSPECTIVE_ACCEPTED_LEVEL_MODEL' if advanced_accepted else 'EVALUATED_PERSISTENCE_BASELINE','advanced_accepted':advanced_accepted,'trained_candidate_count':len(fitted),'candidate_comparison_test':model_comparison,'model_features':'PAST_WATER_AND_POINT_RAINFALL' if features!=WATER_FEATURES else 'PAST_WATER_ONLY','holdout':{'train_samples':len(train),'validation_samples':len(selection),'test_samples':len(test),'periods':periods(parts),'chosen_method':deploy,'model':dep_metrics,'persistence':persistence,'regimes':reg},'evaluation':evaluation,'interval':interval,'research_readiness':'RETROSPECTIVE_RESEARCH_ONLY','model_rejection_reason':None if advanced_accepted else 'ADVANCED_CANDIDATES_DID_NOT_PASS_ALL_PREDECLARED_CHECKS'}
 return result,artifact

def load_station(cur,station,all_history=True):
 sid=station['station_id'];cutoff='' if all_history else ' AND observed_at>=NOW()+INTERVAL 9 HOUR-INTERVAL 100 HOUR'
 raw=fetch(cur,'SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=%s'+cutoff+' ORDER BY observed_at',(sid,))
 verified=[]
 if fetch(cur,"SHOW TABLES LIKE 'ml_verified_water_history'"):verified=fetch(cur,'SELECT observed_at,water_level,source_url FROM ml_verified_water_history WHERE station_id=%s'+cutoff+' ORDER BY observed_at',(sid,))
 rain=[];source=None
 hydro=fetch(cur,'SELECT * FROM hr_rainfall_links WHERE station_id=%s AND distance_km<=25',(sid,)) if fetch(cur,"SHOW TABLES LIKE 'hr_rainfall_links'") else []
 if hydro:
  source={'provider':'HRFCO','code':str(hydro[0]['rainfall_station_code']),'distance_km':float(hydro[0]['distance_km'])};rain=fetch(cur,'SELECT observed_at,rainfall_mm AS rainfall FROM hr_rainfall_history WHERE station_code=%s ORDER BY observed_at',(source['code'],))
 else:
  links=fetch(cur,"SELECT * FROM station_rainfall_links WHERE station_id=%s AND distance_km<=25 AND verification_status IN ('VERIFIED','AUTO_NEAREST')",(sid,))
  if links:source={'provider':'KMA_AWS','code':str(links[0]['aws_station_code']),'distance_km':float(links[0]['distance_km'])};rain=fetch(cur,'SELECT observed_at,hourly_rainfall AS rainfall FROM aws_rainfall_readings WHERE aws_station_code=%s ORDER BY observed_at',(source['code'],))
 q,frame=quality_and_frame(raw,verified,str(station['external_station_id']),rain);q.update(station_id=sid,station_code=station['external_station_id'],river=station.get('river_id'),rainfall_source=source,reference_status='CURRENT_POINT_REFERENCE_ONLY_NOT_HISTORICAL_DATUM_EPOCHS')
 return q,frame,source

def station_list(cur):
 rows=fetch(cur,"SELECT DISTINCT s.station_id,s.external_station_id,s.station_name,(SELECT MIN(l.river_id) FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED') river_id FROM stations s JOIN flood_thresholds t ON t.station_id=s.station_id WHERE s.data_source='RIVER_GAUGE' AND t.verification_status='VERIFIED' ORDER BY s.station_id")
 allowed=set(json.loads((REPORT/'catalog.json').read_text())['station_ids'])
 return [r for r in rows if r['station_id'] in allowed]
def train(ids=None):
 conn=connect();cur=conn.cursor(dictionary=True);REPORT.mkdir(parents=True,exist_ok=True);ARTIFACTS.mkdir(parents=True,exist_ok=True)
 reference=json.loads((BACK/'reference-data/measurement-reference-evidence.json').read_text())['stations'];stations=station_list(cur);results=[];quality=[];started=stamp()
 if ids:stations=[s for s in stations if s['station_id'] in ids]
 try:
  for s in stations:
   try:
    q,frame,rain_source=load_station(cur,s);quality.append(q);horizons=[];artifacts={}
    reason=q.get('exclusion_reason')
    if str(s['external_station_id']) in HOLD_CODES or str(s['external_station_id']) not in reference:reason='REFERENCE_OR_MEASUREMENT_REVIEW_REQUIRED'
    if reason:
     q.update(forecasting_eligible=False,exclusion_reason=reason)
     horizons=[{'horizon_hours':h,'forecast_status':'UNAVAILABLE','predicted_level_m':None,'reason':reason} for h in POLICY['horizons']]
    else:
     for h in POLICY['horizons']:
      result,artifact=evaluate_station_horizon(frame,h);horizons.append(result)
      if artifact:artifacts[h]=artifact
    digest=hashlib.sha256((frame.to_json(date_format='iso')+json.dumps(POLICY,sort_keys=True)+str(rain_source)).encode()).hexdigest()
    version=POLICY['version']+'-'+str(s['station_id'])+'-'+digest[:12]+'-'+ENGINE_SHA[:8];artifact_name=version+'.joblib';artifact_sha=None
    if artifacts:
     payload={'station_id':s['station_id'],'station_code':s['external_station_id'],'version':version,'rainfall_source':rain_source,'schema_version':POLICY['version'],'engine_sha256':ENGINE_SHA,'policy_sha256':hashlib.sha256((ROOT/'level_policy.json').read_bytes()).hexdigest(),'sklearn_version':sklearn.__version__,'dataset_sha256':digest,'horizons':artifacts};joblib.dump(payload,ARTIFACTS/artifact_name);artifact_sha=hashlib.sha256((ARTIFACTS/artifact_name).read_bytes()).hexdigest()
    row={**s,'engine_sha256':ENGINE_SHA,'policy_sha256':hashlib.sha256((ROOT/'level_policy.json').read_bytes()).hexdigest(),'quality':q,'model_version':version,'artifact_name':artifact_name if artifacts else None,'artifact_sha256':artifact_sha,'dataset_sha256':digest,'horizons':horizons,'trained_candidate_count':sum(h.get('trained_candidate_count',0) for h in horizons),'accepted_advanced_models':sum(h.get('advanced_accepted',False) for h in horizons),'eligible':bool(artifacts),'generated_at':stamp()};results.append(row)
   except Exception as exc:results.append({**s,'engine_sha256':ENGINE_SHA,'policy_sha256':hashlib.sha256((ROOT/'level_policy.json').read_bytes()).hexdigest(),'generated_at':stamp(),'eligible':False,'reason':type(exc).__name__,'horizons':[]})
   save_json(REPORT/'stations'/f"{s['station_id']}.json",results[-1])
   if len(results)%25==0 or s['station_id']==207:print(json.dumps({'processed':len(results),'station_id':s['station_id'],'eligible':results[-1]['eligible']},default=encode),flush=True)
  out={'started_at':started,'generated_at':stamp(),'policy':POLICY,'model_version':POLICY['version'],'stations':results,'station_count':len(results),'eligible_stations':sum(r['eligible'] for r in results),'trained_candidate_models':sum(r.get('trained_candidate_count',0) for r in results),'accepted_advanced_models':sum(r.get('accepted_advanced_models',0) for r in results),'limitations':['Retrospective, not prospective or operational validation.','No historically verified threshold-approach labels; datum epochs and relocation histories unavailable.','Forecast rainfall excluded without availability archive.','No future observations or rainfall are used in features.']}
  save_json(REPORT/'station-quality.json',{'generated_at':stamp(),'stations':quality});save_json(REPORT/('batch-training.json' if ids else 'training.json'),out);print(json.dumps({k:out[k] for k in ['station_count','eligible_stations','trained_candidate_models','accepted_advanced_models']}),flush=True);return out
 finally:cur.close();conn.close()

def artifact_compatible(artifact,station):
 return artifact.get('engine_sha256')==ENGINE_SHA and artifact.get('schema_version')==POLICY['version'] and str(artifact.get('station_code'))==str(station['external_station_id']) and artifact.get('station_id')==station['station_id'] and artifact.get('sklearn_version')==sklearn.__version__ and artifact.get('policy_sha256')==hashlib.sha256((ROOT/'level_policy.json').read_bytes()).hexdigest() and all(h.get('features') in [WATER_FEATURES,WATER_FEATURES+RAIN_FEATURES] for h in artifact.get('horizons',{}).values())

def forecast_key(station_id,version,observed_at,horizon):
 return hashlib.sha256(f'{station_id}|{version}|{observed_at}|{horizon}'.encode()).hexdigest()

def predict():
 report=json.loads((REPORT/'training.json').read_text(encoding='utf-8'));conn=connect();cur=conn.cursor(dictionary=True);rows=[];now=kst_now()
 try:
  for station in report['stations']:
   forecasts=[];reason=None
   try:
    if not station.get('artifact_name'):raise ValueError('NO_ACCEPTED_ARTIFACT_OR_EVALUATED_BASELINE')
    file=ARTIFACTS/Path(station['artifact_name']).name
    if hashlib.sha256(file.read_bytes()).hexdigest()!=station['artifact_sha256']:raise ValueError('ARTIFACT_INTEGRITY_MISMATCH')
    artifact=joblib.load(file)
    if not artifact_compatible(artifact,station):raise ValueError('ARTIFACT_SCHEMA_IDENTITY_OR_RUNTIME_MISMATCH')
    q,frame,source=load_station(cur,station,False)
    if frame.empty:raise ValueError('MISSING_CURRENT_PROVENANCED_INPUTS')
    latest=frame.index[-1];age=(now-latest).total_seconds()/3600
    if age<0 or age>3:raise ValueError('STALE_OR_FUTURE_INPUT')
    if q.get('latest_constant_hours',0)>=72:raise ValueError('CONSTANT_READING_REVIEW')
    for original in station['horizons']:
     h=original['horizon_hours'];model=artifact['horizons'].get(h);out={**original,'forecast_status':'UNAVAILABLE','predicted_level_m':None,'model_version':artifact['version'],'issued_at':str(now),'observed_at':str(latest),'observed_level_m':float(frame.level.iloc[-1]) if pd.notna(frame.level.iloc[-1]) else None,'valid_at':str(latest+pd.Timedelta(hours=h)),'latest_observed_at':q.get('historical_end'),'prediction_type':'RIVER_LEVEL','data_quality_status':'UNAVAILABLE','reason':None}
     if not model:out['reason']='NO_HORIZON_ARTIFACT'
     elif len(model['features'])>len(WATER_FEATURES) and source!=artifact['rainfall_source']:out['reason']='RAINFALL_SOURCE_MISMATCH'
     elif frame.iloc[-1][model['features']+['level']].isna().any():out['reason']='MISSING_POINT_IN_TIME_FEATURES'
     elif latest+pd.Timedelta(hours=h)<=now:out['reason']='FORECAST_EXPIRED'
     else:
      row=frame.tail(1);value=float(candidate_predict(model['family'],model['model'],row,model['features'],h,model['trend_limit'])[0]);key=forecast_key(station['station_id'],artifact['version'],latest,h);out.update(forecast_status='AVAILABLE',predicted_level_m=value,prediction_value=value,forecast_id=key,data_quality_status='FRESH',model_training_period=model['training_period'],generation_time=stamp(),research_readiness='RETROSPECTIVE_RESEARCH_ONLY')
      interval=model['interval'];out['interval']={**interval,'lower_m':value-interval['radius_m'] if interval['radius_m'] is not None else None,'upper_m':value+interval['radius_m'] if interval['radius_m'] is not None else None}
     forecasts.append(out)
   except Exception as exc:reason=str(exc) if isinstance(exc,ValueError) and str(exc).replace('_','').isalnum() else type(exc).__name__
   if not forecasts:forecasts=[{'horizon_hours':h,'forecast_status':'UNAVAILABLE','predicted_level_m':None,'reason':reason or station.get('reason') or station.get('quality',{}).get('exclusion_reason'),'model_version':station.get('model_version')} for h in [1,3,6]]
   rows.append({'station_id':station['station_id'],'station_code':station['external_station_id'],'station_name':station['station_name'],'river_id':station.get('river_id'),'generated_at':stamp(),'horizons':forecasts,'status':'LEVEL_FORECAST_AVAILABLE' if any(h['forecast_status']=='AVAILABLE' for h in forecasts) else 'LEVEL_FORECAST_UNAVAILABLE','reason':reason or next((h.get('reason') for h in forecasts if h.get('reason')),None),'quality':station.get('quality'),'artifact_name':station.get('artifact_name')})
  output={'generated_at':stamp(),'model_version':POLICY['version'],'training_report_generated_at':report['generated_at'],'total_gauges':len(rows),'available':sum(r['status']=='LEVEL_FORECAST_AVAILABLE' for r in rows),'stations':rows,'pipeline_status':'PREDICTIONS_GENERATED_FROM_FROZEN_ARTIFACTS','training_metrics':{k:report[k] for k in ['eligible_stations','trained_candidate_models','accepted_advanced_models']}}
  save_json(BACK/'reports/advanced-level-network.json',output);return output
 finally:cur.close();conn.close()
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['train','predict']);parser.add_argument('--station',type=int,action='append');args=parser.parse_args()
 result=train(args.station) if args.mode=='train' else predict()
 if args.mode=='predict':print(json.dumps({'available':result['available'],'gauges':result['total_gauges']}))
