"""Warning development diagnosis: pre-2026 only; never writes accepted models."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np,pandas as pd
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import average_precision_score,brier_score_loss
from advanced_warning import FEATURES,chronological_split,metrics,new_issuance_origins
from warning_development_research import dataset,qualify_threshold
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'reports/scientific-upgrade-20261109'

def hydro_features(d):
 d=d.copy();d['rain_growth_3h']=2*d.rain_3h-d.rain_6h;d['recent_rain_intensity']=d.rain_3h/3-(d.rain_12h-d.rain_3h)/9;d['rise_rain_interaction']=d.change_3h.clip(lower=0)*np.log1p(d.rain_6h);d['rise_acceleration']=d.change_1h-d.change_3h/3
 return d

CONTEXT_FEATURES=['station_relative_level','station_relative_change_1h','station_relative_change_3h','station_relative_change_6h','above_station_training_p90','station_context_missing']
CALENDAR_FEATURES=['season_sin','season_cos','kst_hour_sin','kst_hour_cos']

def calendar_features(data):
 """Known origin time only; no future season statistics or event labels."""
 d=data.copy();t=pd.to_datetime(d.t)
 if t.dt.tz is not None:t=t.dt.tz_convert('Asia/Seoul')
 day=(t.dt.day_of_year-1)/365.25;hour=(t.dt.hour+t.dt.minute/60)/24
 d['season_sin']=np.sin(2*np.pi*day);d['season_cos']=np.cos(2*np.pi*day)
 d['kst_hour_sin']=np.sin(2*np.pi*hour);d['kst_hour_cos']=np.cos(2*np.pi*hour)
 return d

def station_context(train,data):
 """Derive same-gauge level context from training observations, never labels."""
 reference=train.groupby('station_id')['level'].agg(median='median',low=lambda s:s.quantile(.05),high=lambda s:s.quantile(.95),p90=lambda s:s.quantile(.9))
 scale=(reference.high-reference.low).clip(lower=.05)
 d=data.copy();sid=d.station_id
 denominator=sid.map(scale);d['station_relative_level']=(d.level-sid.map(reference['median']))/denominator
 for h in [1,3,6]:d['station_relative_change_'+str(h)+'h']=d['change_'+str(h)+'h']/denominator
 d['above_station_training_p90']=(d.level-sid.map(reference.p90)).clip(lower=0)/denominator
 d['station_context_missing']=denominator.isna().astype(int)
 return d

def run(output_dir=OUT,station_context_research=False,calendar_timing=False):
 OUT=Path(output_dir)
 spec={'created_at':pd.Timestamp.now(tz='UTC').isoformat(),'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'features_before':'2026-01-01','test_predictions_read':False,'deploy':False,'provenance':'Only official-URL water records plus independently reconciled history; original records retained','selection':'Saved 2025 selection only; AP ranking','calibration':'Saved disjoint 2025 block, sigmoid C=1','decision':'Saved disjoint threshold block; precision>=.2 and event recall>=.8; >=2 events','purge_hours':72,'features':['rain growth','recent rainfall intensity','positive-rise x observed rainfall','rise acceleration'],'reference':'No current thresholds backfilled into historical data; no invented upstream gauge topology'}
 if station_context_research:spec.update(target_scope='Confirmed NONE at forecast origin only; exact match to live new-issuance eligibility',station_context='Training-only same-gauge median, p05/p95 range and p90; no current flood thresholds backfilled into history. Unknown gauges keep NaN context and an explicit missing flag for HGB.',candidate_selection='Saved 2025 selection AP only; numerical Brier and threshold checks unchanged',additional_candidates=['Station-context HGB','Constrained station-context HGB','Balanced station-context HGB'])
 if calendar_timing:spec.update(hypothesis='Seasonal warning prevalence and official issuance-hour patterns vary; known origin-time cycles may improve discrimination without upstream assumptions. Paired ablation against the previous best selection-AP model; all other parameters unchanged.',calendar_features=CALENDAR_FEATURES,candidate_names=['Balanced station-context HGB','Calendar station-context HGB'],limitation='Temporal associations can reflect agency practice, not flood physics; no independent accuracy claim.')
 OUT.mkdir(exist_ok=True,parents=True);(OUT/'warning-research-design.json').write_text(json.dumps(spec,indent=2))
 data,audit=dataset(require_provenance=True,match_runtime_scope=False);assert data.t.max()<pd.Timestamp('2026-01-01');data=hydro_features(data)
 scope_audit={'original_samples':len(data),'excluded_positive_samples':int(((data.ongoing!='NONE')&(data.label==1)).sum()),'excluded_origin_states':data.loc[data.ongoing!='NONE','ongoing'].value_counts().to_dict()}
 data=new_issuance_origins(data)
 if calendar_timing:data=calendar_features(data)
 policy=json.loads((ROOT/'ml/warning_split_policy.json').read_text());parts=chronological_split(data,policy);train=parts['train'];val=parts['validation'];saved=json.loads((ROOT/'reports/advanced-warning-validation.json').read_text())
 blocks={k:val[val.t.between(pd.Timestamp(b['start']),pd.Timestamp(b['end']))] for k,b in saved['validation_blocks'].items()};tune,cal,decision=(blocks[k] for k in ['selection','calibration','thresholds'])
 if any(d.loc[d.label==1,'event_id'].nunique()<2 for d in [cal,decision]):
  raise ValueError('INSUFFICIENT_DEVELOPMENT_EVENTS: calibration and threshold blocks each require at least two events')
 extra=[c for c in data if c in ['rain_growth_3h','recent_rain_intensity','rise_rain_interaction','rise_acceleration']];normalized=[f for f in FEATURES if f!='level']+extra
 specs=[('Existing HGB',HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=15,l2_regularization=5,early_stopping=False,random_state=42),FEATURES),('Hydrological HGB',HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=15,l2_regularization=10,early_stopping=False,random_state=42),normalized),('Hydrological logistic',make_pipeline(StandardScaler(),LogisticRegression(C=.1,max_iter=1000,random_state=42)),normalized)]
 if station_context_research:
  context_train=train
  train,tune,cal,decision=[station_context(context_train,d) for d in [train,tune,cal,decision]]
  context_cols=normalized+CONTEXT_FEATURES
  specs.extend([('Station-context HGB',HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=15,l2_regularization=10,early_stopping=False,random_state=42),context_cols),
   ('Constrained station-context HGB',HistGradientBoostingClassifier(max_iter=120,learning_rate=.05,max_leaf_nodes=7,min_samples_leaf=100,l2_regularization=25,early_stopping=False,random_state=42),context_cols),
   ('Balanced station-context HGB',HistGradientBoostingClassifier(max_iter=120,learning_rate=.05,max_leaf_nodes=7,min_samples_leaf=100,l2_regularization=25,class_weight='balanced',early_stopping=False,random_state=42),context_cols)])
 if calendar_timing:
  control=next(c for c in specs if c[0]=='Balanced station-context HGB')
  specs=[control,('Calendar station-context HGB',clone(control[1]),control[2]+CALENDAR_FEATURES)]
 report={'design':spec,'scope_audit':scope_audit,'counts':{k:{'samples':len(d),'events':int(d.loc[d.label==1,'event_id'].nunique()),'positive_fraction':float(d.label.mean())} for k,d in {'training':train,**blocks}.items()},'feature_audit':audit,'candidates':[]}
 report['data_sha256']={k:hashlib.sha256(pd.util.hash_pandas_object(d[FEATURES+['t','station_id','label','event_id']],index=False).to_numpy().tobytes()).hexdigest() for k,d in [('training',train),('selection',tune),('calibration',cal),('thresholds',decision)]}
 (OUT/'warning-research-results.json').write_text(json.dumps(report,indent=2))
 for name,model,cols in specs:
  model.fit(train[cols],train.label.astype(int));selection=model.predict_proba(tune[cols])[:,1]
  def logits(d):
   p=np.clip(model.predict_proba(d[cols])[:,1],1e-6,1-1e-6);return np.log(p/(1-p)).reshape(-1,1)
  calibrator=LogisticRegression(C=1,max_iter=500).fit(logits(cal),cal.label.astype(int));p=calibrator.predict_proba(logits(decision))[:,1];threshold=qualify_threshold(decision,p);old=saved['thresholds']['high'];diagnostic=metrics(decision,p,old)
  fp=(p>=old)&(decision.label.to_numpy()==0);tp=(p>=old)&(decision.label.to_numpy()==1)
  row={'name':name,'features':cols,'selection_ap':float(average_precision_score(tune.label,selection)),'decision_ap':float(average_precision_score(decision.label,p)),'brier':float(brier_score_loss(decision.label,p)),'baseline_brier':float(brier_score_loss(decision.label,np.full(len(decision),float(train.label.mean())))),'qualified_threshold':threshold,'operating_metrics':metrics(decision,p,threshold) if threshold is not None else None,'diagnostic_at_frozen_existing_threshold':diagnostic,'false_positive_diagnosis':{'false_positive_samples':int(fp.sum()),'true_positive_samples':int(tp.sum()),'fp_with_rain_6h_under_1mm':int((fp&(decision.rain_6h.to_numpy()<1)).sum()),'fp_with_nonpositive_1h_rise':int((fp&(decision.change_1h.to_numpy()<=0)).sum()),'fp_station_count':int(decision.loc[fp,'station_id'].nunique())},'probability_enabled':False}
  report['candidates'].append(row);(OUT/'warning-research-results.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:row[k] for k in ['name','selection_ap','decision_ap','qualified_threshold','brier']}),flush=True)
 report['ranked_development_candidate']=max(report['candidates'],key=lambda r:r['selection_ap'])['name'];report['independent_evaluation']='NOT_RUN_ALREADY_INSPECTED_2026_EXCLUDED';(OUT/'warning-research-results.json').write_text(json.dumps(report,indent=2))
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output-dir',type=Path,default=OUT)
 parser.add_argument('--station-context',action='store_true',help='Development-only scope-aligned station-relative hydrology comparison')
 parser.add_argument('--calendar-timing',action='store_true',help='Paired origin-time season/hour ablation; implies station context')
 args=parser.parse_args();run(args.output_dir,args.station_context or args.calendar_timing,args.calendar_timing)
