"""Lightweight inference from frozen artifacts; never fits or selects candidates.
Persistence consumes only the actual current level, not unused ML covariates.
"""
import hashlib,json
import numpy as np,pandas as pd,joblib
from pathlib import Path
from level_research import REPORT,BACK,ARTIFACTS,POLICY,connect,load_station,kst_now,stamp,artifact_compatible,forecast_key,candidate_predict,fetch,source_valid,encode
from atomic_json import save_json

def infer_horizon(original,model,frame,source,artifact,station,now,latest_observation=None):
 h=original['horizon_hours'];hour=frame.index[-1]
 out={**original,'forecast_status':'UNAVAILABLE','predicted_level_m':None,'prediction_value':None,'model_version':artifact['version'],'issued_at':str(now),'observed_at':str(hour),'valid_at':str(hour+pd.Timedelta(hours=h)),'latest_observed_at':station.get('latest_observed_at'),'prediction_type':'RIVER_LEVEL','data_quality_status':'UNAVAILABLE','reason':None}
 if not model:out['reason']='NO_HORIZON_ARTIFACT';return out
 source_mismatch=len(model['features'])>10 and source!=artifact['rainfall_source']
 latest_missing=[k for k in model['features'] if pd.isna(frame.iloc[-1][k])]
 input_frame=frame.tail(1)
 if model['family']!='PERSISTENCE' and not source_mismatch:
  # The most recent whole hour may await a provider's actual rainfall publication.
  # An earlier complete origin is usable only while its fixed-horizon valid time
  # is still in the future and all of its causal inputs remain within freshness.
  complete=frame.dropna(subset=list(dict.fromkeys(['level']+model['features'])))
  complete=complete[(complete.index<=now)&(complete.index>=now-pd.Timedelta(hours=3))&(complete.index+pd.Timedelta(hours=h)>now)]
  if not complete.empty:input_frame=complete.tail(1)
 hour=input_frame.index[-1]
 missing=[k for k in model['features'] if pd.isna(input_frame.iloc[-1][k])]
 out.update(latest_hour_missing_features=latest_missing,input_origin_selection='LATEST_COMPLETE_UNEXPIRED_CAUSAL_HOURLY_FEATURES')
 family=model['family'];expired_origin=hour+pd.Timedelta(hours=h)<=now
 fallback=family!='PERSISTENCE' and (source_mismatch or bool(missing) or pd.isna(input_frame.level.iloc[-1]) or expired_origin)
 if fallback:
  if not original.get('holdout',{}).get('persistence'):out['reason']='MISSING_MODEL_INPUTS_NO_EVALUATED_BASELINE';return out
  family='PERSISTENCE';out.update(model_kind='PERSISTENCE',validation_status='EVALUATED_PERSISTENCE_BASELINE',advanced_accepted=False,fallback_reason='RAINFALL_SOURCE_MISMATCH' if source_mismatch else 'EXPIRED_ADVANCED_ORIGIN_EVALUATED_BASELINE_USED' if expired_origin else 'MODEL_FEATURE_GAPS_EVALUATED_BASELINE_USED')
  reg=original['holdout'].get('regimes');baseline_reg={**reg,'groups':{k:{**v,'selected':v.get('persistence'),'chosen':v.get('persistence')} for k,v in reg['groups'].items()}} if reg else None
  out['holdout']={**original['holdout'],'chosen_method':'PERSISTENCE','model':original['holdout']['persistence'],'regimes':baseline_reg}
  out['evaluation']={**original.get('evaluation',{}),'deployed_fallback':True,'block_uncertainty':{'status':'UNAVAILABLE_FOR_CURRENT_FALLBACK','ci95_mae_improvement_m':None}}
 required=['level'] if family=='PERSISTENCE' else model['features'];origin=hour
 if family=='PERSISTENCE':
  if latest_observation:
   origin=pd.Timestamp(latest_observation['observed_at']);value=float(latest_observation['water_level']);out['observation_source_url']=latest_observation.get('source_url')
  else:
   observed=frame.level.dropna()
   if observed.empty:out['reason']='MISSING_CURRENT_LEVEL';return out
   origin=observed.index[-1];value=float(observed.iloc[-1])
  feature_values={'level':value}
 else:
  if pd.isna(input_frame.level.iloc[-1]):out['reason']='MISSING_CURRENT_LEVEL';return out
  feature_values={k:float(input_frame.iloc[-1][k]) for k in required};value=float(candidate_predict(family,model['model'],input_frame,required,h,model['trend_limit'])[0])
 age=(now-origin).total_seconds()/3600
 if age<0 or age>3:out['reason']='STALE_OR_FUTURE_INPUT';return out
 if origin+pd.Timedelta(hours=h)<=now:out['reason']='FORECAST_EXPIRED';return out
 if not np.isfinite(value):out['reason']='NONFINITE_MODEL_OUTPUT';return out
 fingerprint=hashlib.sha256(json.dumps({'features':feature_values,'family':family,'source':source if len(required)>10 else None},sort_keys=True).encode()).hexdigest()
 key=hashlib.sha256((forecast_key(station['station_id'],artifact['version'],origin,h)+'|'+fingerprint).encode()).hexdigest()
 interval=model['interval'];non_hourly=origin.minute!=0 or origin.second!=0
 if fallback or (family=='PERSISTENCE' and (missing or non_hourly)):interval={'status':'UNAVAILABLE','calibrated':False,'radius_m':None,'reason':'CURRENT_INPUT_REGIME_OR_CADENCE_INTERVAL_NOT_VALIDATED'}
 observed_level=value if family=='PERSISTENCE' else float(input_frame.level.iloc[-1])
 out.update(forecast_status='AVAILABLE',predicted_level_m=value,prediction_value=value,observed_at=str(origin),observed_level_m=observed_level,valid_at=str(origin+pd.Timedelta(hours=h)),forecast_id=key,input_fingerprint_sha256=fingerprint,inference_features=required,missing_auxiliary_features=missing,input_age_minutes=age*60,baseline_origin_cadence='ACTUAL_OBSERVATION' if family=='PERSISTENCE' else 'NOMINAL_HOURLY_GRID',evaluation_cadence_limitation='Baseline errors were evaluated on hourly origins; non-hourly-origin performance and intervals are not independently established.' if non_hourly else None,data_quality_status='FRESH_BASELINE_WITH_INPUT_GAPS' if missing and family=='PERSISTENCE' else 'FRESH',model_kind=family,model_features='LAST_OBSERVED_WATER_LEVEL' if family=='PERSISTENCE' else original.get('model_features'),model_training_period=model['training_period'],generation_time=stamp(),research_readiness='EVALUATED_BASELINE_DEMONSTRATION' if family=='PERSISTENCE' else 'RETROSPECTIVE_RESEARCH_ONLY',interval={**interval,'lower_m':value-interval['radius_m'] if interval.get('radius_m') is not None else None,'upper_m':value+interval['radius_m'] if interval.get('radius_m') is not None else None})
 return out

def station_identity_matches(stored,current):
 return bool(current) and current.get('data_source')=='RIVER_GAUGE' and str(current.get('external_station_id'))==str(stored.get('external_station_id'))

def predict():
 report=json.loads((REPORT/'training.json').read_text(encoding='utf-8'));conn=connect();cur=conn.cursor(dictionary=True);rows=[];now=kst_now()
 try:
  for s in report['stations']:
   forecasts=[];reason=None
   try:
    actual_station=fetch(cur,'SELECT external_station_id,data_source FROM stations WHERE station_id=%s',(s['station_id'],))
    if not station_identity_matches(s,actual_station[0] if actual_station else None):raise ValueError('DATABASE_STATION_IDENTITY_MISMATCH')
    if not s.get('artifact_name'):raise ValueError('NO_ACCEPTED_ARTIFACT_OR_EVALUATED_BASELINE')
    file=ARTIFACTS/Path(s['artifact_name']).name
    if hashlib.sha256(file.read_bytes()).hexdigest()!=s['artifact_sha256']:raise ValueError('ARTIFACT_INTEGRITY_MISMATCH')
    artifact=joblib.load(file)
    if not artifact_compatible(artifact,s):raise ValueError('ARTIFACT_SCHEMA_IDENTITY_OR_RUNTIME_MISMATCH')
    q,frame,source=load_station(cur,s,False)
    if frame.empty:raise ValueError('MISSING_CURRENT_PROVENANCED_INPUTS')
    age=(now-frame.index[-1]).total_seconds()/3600
    if age<0 or age>3:raise ValueError('STALE_OR_FUTURE_INPUT')
    if q.get('latest_constant_hours',0)>=72:raise ValueError('CONSTANT_READING_REVIEW')
    station={**s,'latest_observed_at':q.get('historical_end')}
    latest_rows=fetch(cur,'SELECT observed_at,water_level,source_url FROM water_readings WHERE station_id=%s AND water_level IS NOT NULL ORDER BY observed_at DESC LIMIT 10',(s['station_id'],))
    latest_observation=next((r for r in latest_rows if source_valid(r.get('source_url'),str(s['external_station_id'])) and pd.Timestamp(r['observed_at'])<=now and 0<=(now-pd.Timestamp(r['observed_at'])).total_seconds()<=10800 and np.isfinite(float(r['water_level']))),None)
    forecasts=[infer_horizon(h,artifact['horizons'].get(h['horizon_hours']),frame,source,artifact,station,now,latest_observation) for h in s['horizons']]
   except Exception as exc:reason=str(exc) if isinstance(exc,ValueError) and str(exc).replace('_','').isalnum() else type(exc).__name__
   if not forecasts:forecasts=[{'horizon_hours':h,'forecast_status':'UNAVAILABLE','predicted_level_m':None,'reason':reason or s.get('reason') or s.get('quality',{}).get('exclusion_reason'),'model_version':s.get('model_version')} for h in [1,3,6]]
   rows.append({'station_id':s['station_id'],'station_code':s['external_station_id'],'station_name':s['station_name'],'river_id':s.get('river_id'),'generated_at':stamp(),'horizons':forecasts,'status':'LEVEL_FORECAST_AVAILABLE' if any(h['forecast_status']=='AVAILABLE' for h in forecasts) else 'LEVEL_FORECAST_UNAVAILABLE','reason':reason or next((h.get('reason') for h in forecasts if h.get('reason')),None),'quality':s.get('quality'),'artifact_name':s.get('artifact_name')})
  out={'generated_at':stamp(),'model_version':POLICY['version'],'inference_engine_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'training_report_generated_at':report['generated_at'],'total_gauges':len(rows),'available':sum(r['status']=='LEVEL_FORECAST_AVAILABLE' for r in rows),'stations':rows,'pipeline_status':'PREDICTIONS_GENERATED_FROM_FROZEN_ARTIFACTS','training_metrics':{k:report[k] for k in ['eligible_stations','trained_candidate_models','accepted_advanced_models']}}
  save_json(BACK/'reports/advanced-level-network.json',out,default=encode);print(json.dumps({'available':out['available'],'gauges':out['total_gauges']}));return out
 finally:cur.close();conn.close()
if __name__=='__main__':predict()
