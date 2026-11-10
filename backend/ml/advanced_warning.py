"""Future HRFCO issuance classifier. Unknown archive coverage never becomes a negative.

Train: python ml/advanced_warning.py train
Infer: python ml/advanced_warning.py infer  (JSON feature snapshot on stdin)
Only locally generated artifacts under ml/advanced_models are loaded.
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (average_precision_score, roc_auc_score, confusion_matrix,
                             precision_score, recall_score, f1_score, brier_score_loss)
from pipeline import connect, fetch

ROOT = Path(__file__).resolve().parent
FEATURES = ['level', 'change_1h', 'change_3h', 'change_6h', 'acceleration_1h',
            'percentile_72h', 'rain_1h', 'rain_3h', 'rain_6h', 'rain_12h', 'rain_24h']
HORIZON = pd.Timedelta(hours=3)
EMBARGO = pd.Timedelta(hours=72)
MIN_EVENTS = {'train': 20, 'validation': 12, 'test': 10}

def frame_features(water, rain):
    if not water:
        return pd.DataFrame(columns=FEATURES)
    w = pd.DataFrame(water).drop_duplicates('observed_at', keep='last')
    w['observed_at'] = pd.to_datetime(w.observed_at)
    w = w.sort_values('observed_at')
    grid = pd.DataFrame({'t': pd.date_range(w.observed_at.min().ceil('h'), w.observed_at.max().floor('h'), freq='h')})
    # Backward only. Never label a bin with a reading that arrived later in that hour.
    data = pd.merge_asof(grid, w, left_on='t', right_on='observed_at', direction='backward', tolerance=pd.Timedelta(minutes=15)).set_index('t')
    data['level'] = pd.to_numeric(data.water_level, errors='coerce').where(lambda s:np.isfinite(s))
    for h in [1, 3, 6]:
        data[f'change_{h}h'] = data.level - data.level.shift(h)
    data['acceleration_1h'] = data.level - 2 * data.level.shift(1) + data.level.shift(2)
    data['percentile_72h'] = data.level.rolling(72, min_periods=24).apply(lambda a: 100 * np.sum(a[np.isfinite(a)] <= a[-1]) / np.isfinite(a).sum(), raw=True)
    if rain:
        r = pd.DataFrame(rain).drop_duplicates('observed_at', keep='last')
        r['observed_at'] = pd.to_datetime(r.observed_at)
        hourly = pd.to_numeric(r.set_index('observed_at').hourly_rainfall, errors='coerce')
        data['rain_1h'] = hourly.where((hourly >= 0)&np.isfinite(hourly)).reindex(data.index)
    else:
        data['rain_1h'] = np.nan
    for h in [3, 6, 12, 24]:
        data[f'rain_{h}h'] = data.rain_1h.rolling(h, min_periods=h).sum()
    data.loc[data.change_1h.abs() > 5, FEATURES] = np.nan
    return data[FEATURES]

def event_labels(index, events, coverage):
    events = sorted(events, key=lambda e: (str(e['issued_at']), e['action']=='ISSUE', e['severity']=='WARNING'))
    events=[{**e,'_at':pd.Timestamp(e['issued_at'])} for e in events]
    coverage=[{**c,'_start':pd.Timestamp(c['start_at']),'_end':pd.Timestamp(c['end_at'])} for c in coverage]
    output = []
    for t in index:
        c = next((c for c in coverage if c['status'] == 'COMPLETE' and
                  c.get('initial_state') in ['NONE', 'ADVISORY', 'WARNING'] and
                  c['_start'] <= t and c['_end'] >= t + HORIZON), None)
        state = c['initial_state'] if c else 'UNKNOWN'
        if c:
            for e in events:
                if c['_start'] <= e['_at'] <= t:
                    if e['action'] == 'ISSUE': state = e['severity']
                    elif e['action'] == 'CANCEL' and state == e['severity']: state = 'NONE'
        ongoing = state
        target, event_id, event_at = (0 if c else None), None, None
        for e in events:
            if t < e['_at'] <= t + HORIZON:
                if e['action'] == 'ISSUE' and e['severity'] != state:
                    target, event_id, event_at = 1, e['event_id'], str(e['issued_at'])
                    break
                if e['action'] == 'CANCEL' and state == e['severity']: state = 'NONE'
                elif e['action'] == 'ISSUE': state = e['severity']
        output.append({'label': target, 'event_id': event_id, 'event_at': event_at, 'ongoing': ongoing})
    return pd.DataFrame(output, index=index)

def chronological_split(data, boundaries=None):
    """Global time partitions and a 72h embargo prevent station/hour leakage.

    Related issuance events within 72h share a storm proxy; no such group is split.
    Background time blocks are also global, rather than split per station.
    """
    data = data.sort_values('t').copy()
    event_times = sorted(pd.to_datetime(data.loc[data.label == 1, 'event_at']).dropna().unique())
    storms, group = [], -1
    previous = None
    for time in event_times:
        time = pd.Timestamp(time)
        if previous is None or time - previous > EMBARGO:
            group += 1; storms.append([time - EMBARGO, time + EMBARGO, 'storm-' + str(group)])
        else:
            storms[-1][1] = time + EMBARGO
        previous = time
    data['group'] = data.t.dt.floor('72h').astype(str)
    for start, end, name in storms:
        data.loc[data.t.between(start, end), 'group'] = name
    groups = data.groupby('group').t.agg(['min', 'max']).sort_values('min')
    if len(groups) < 6: return None
    v = pd.Timestamp(boundaries['validation_start']) if boundaries else groups.iloc[max(1, int(len(groups) * .65))]['min']
    test = pd.Timestamp(boundaries['test_start']) if boundaries else groups.iloc[max(2, int(len(groups) * .83))]['min']
    splits = {'train': data[data.t < v - EMBARGO],
              'validation': data[(data.t >= v) & (data.t < test - EMBARGO)],
              'test': data[data.t >= test]}
    if boundaries:
        # A fixed calendar boundary may intersect a storm or background block.
        # Exclude the entire shared group; never split it between partitions.
        ownership={k:set(frame.group) for k,frame in splits.items()}
        shared=set().union(*(ownership[a]&ownership[b] for a,b in [('train','validation'),('train','test'),('validation','test')]))
        splits={k:frame[~frame.group.isin(shared)] for k,frame in splits.items()}
    used = {k: set(v.group) for k, v in splits.items()}
    if any(used[a] & used[b] for a, b in [('train','validation'),('train','test'),('validation','test')]):
        return None
    return splits

def new_issuance_origins(data):
    """Match inference: only predict a new issuance from confirmed NONE state.

    Upgrades while an advisory is active and UNKNOWN initial states are outside
    this target, irrespective of whether a positive bulletin is available later.
    """
    return data.loc[data.ongoing.eq('NONE')].copy()

def metrics(data, probabilities, threshold):
    y = data.label.to_numpy(dtype=int); p = np.asarray(probabilities, dtype=float)
    predicted = p >= threshold
    positives = set(data.loc[data.label == 1, 'event_id'].dropna())
    found = set(data.loc[predicted & (data.label == 1), 'event_id'].dropna())
    days = data[['station_id', 't']].assign(day=data.t.dt.date).drop_duplicates(['station_id','day']).shape[0]
    # Count false-alarm episodes, not every hourly sample of the same alarm.
    false_episodes = 0
    for _, rows in data.loc[predicted & (data.label == 0)].groupby('station_id'):
        times = rows.sort_values('t').t
        false_episodes += int((times.diff().isna() | (times.diff() > HORIZON)).sum())
    leads = []
    for event in found:
        hits = data.loc[predicted & (data.event_id == event)]
        leads.append((pd.Timestamp(hits.event_at.iloc[0]) - hits.t.min()).total_seconds() / 60)
    bins = []
    for i in range(10):
        mask = (p >= i / 10) & ((p <= 1) if i == 9 else (p < (i + 1) / 10))
        if mask.any(): bins.append({'mean_probability': float(p[mask].mean()), 'observed_frequency': float(y[mask].mean()), 'samples': int(mask.sum())})
    return {'samples': len(y), 'positive_samples': int(y.sum()), 'positive_warning_events': len(positives),
            'precision': float(precision_score(y,predicted,zero_division=0)), 'recall': float(recall_score(y,predicted,zero_division=0)),
            'f1': float(f1_score(y,predicted,zero_division=0)), 'pr_auc_average_precision': float(average_precision_score(y,p)) if y.sum() else None,
            'roc_auc': float(roc_auc_score(y,p)) if len(set(y))==2 else None, 'confusion_matrix': confusion_matrix(y,predicted,labels=[0,1]).tolist(),
            'false_alarm_episodes': false_episodes, 'station_days': days, 'false_alarms_per_station_day': false_episodes / max(1, days),
            'missed_warning_events': len(positives-found), 'event_detection_rate': len(found)/len(positives) if positives else None,
            'median_lead_minutes': float(np.median(leads)) if leads else None, 'brier_score': float(brier_score_loss(y,p)), 'calibration_bins': bins}

def choose_threshold(y, p, recall_target):
    # Exact same candidate thresholds and tie-break as exhaustive search, with
    # sorted cumulative counts rather than a scan of all rows per candidate.
    y=np.asarray(y,dtype=int);p=np.asarray(p,dtype=float)
    if not len(y) or not y.sum(): return None
    order=np.argsort(p);scores=p[order];positive=np.r_[0,np.cumsum(y[order])]
    candidates=np.unique(np.r_[.01,p,.99]);starts=np.searchsorted(scores,candidates,side='left')
    tp=positive[-1]-positive[starts];n=len(y)-starts
    precision=np.divide(tp,n,out=np.zeros_like(tp,dtype=float),where=n>0)
    recall=tp/positive[-1];eligible=np.flatnonzero(recall>=recall_target)
    return max((float(precision[i]),float(candidates[i])) for i in eligible)[1] if len(eligible) else None

def train_classifier(data, minima=MIN_EVENTS, boundaries=None):
    # Enforce the same scope even for direct callers, before any split or fit.
    data=new_issuance_origins(data).dropna(subset=FEATURES+['label'])
    splits = chronological_split(data, boundaries)
    base = {'status':'INSUFFICIENT_VALIDATION_DATA','probability_available':False,'features':FEATURES,
            'target':'New official advisory/warning issuance in (t,t+3h], not physical inundation','horizon_hours':3,
            'split_method':'Global storm-proxy groups; chronological train/validation/final test; 72h purge', 'probability':None}
    if not splits: return None, {**base,'reason':'TOO_FEW_INDEPENDENT_TIME_OR_STORM_GROUPS'}
    counts = {k: {'samples':len(v),'positive_warning_events':v.loc[v.label==1,'event_id'].nunique(),'groups':v.group.nunique(),
                   'start':str(v.t.min()),'end':str(v.t.max())} for k,v in splits.items()}
    base['split_counts'] = counts
    if boundaries:
        base['split_policy'] = boundaries
        base['split_method'] = 'Frozen calendar seasons; global storm groups; chronological train/validation/test; 72h purge'
    if any(counts[k]['positive_warning_events'] < minima[k] or splits[k].label.nunique()<2 for k in splits):
        return None, {**base,'reason':'INSUFFICIENT_INDEPENDENT_POSITIVE_EVENTS'}
    train, val, test = (splits[k] for k in ['train','validation','test'])
    # Validation itself is separated for model selection, sigmoid calibration and decision thresholds.
    if boundaries:
        # Validation-only storm chronology defines three disjoint blocks. Never
        # move the final-test boundary or inspect test metrics to choose them.
        storms = val[val.label == 1].groupby('group').t.min().sort_values()
        if len(storms) < 3:
            return None,{**base,'reason':'INSUFFICIENT_INDEPENDENT_VALIDATION_STORMS'}
        blocks = np.array_split(storms.to_numpy(),3)
        a,b = pd.Timestamp(blocks[1][0]),pd.Timestamp(blocks[2][0])
        tune,cal,decision = val[val.t < a-EMBARGO],val[(val.t>=a)&(val.t<b-EMBARGO)],val[val.t>=b]
        base['validation_blocks']={k:{'start':str(v.t.min()),'end':str(v.t.max()),'events':v.loc[v.label==1,'event_id'].nunique(),'storm_groups':v.loc[v.label==1,'group'].nunique()} for k,v in [('selection',tune),('calibration',cal),('thresholds',decision)]}
    else:
        parts = np.array_split(np.sort(val.t.unique()),3)
        tune, cal, decision = [val[val.t.isin(times)] for times in parts]
    if any(v.label.nunique()<2 or v.loc[v.label==1,'event_id'].nunique()<2 for v in [tune,cal,decision]):
        return None,{**base,'reason':'INSUFFICIENT_CALIBRATION_OR_THRESHOLD_EVENTS'}
    models = {'Logistic Regression':make_pipeline(StandardScaler(),LogisticRegression(class_weight='balanced',max_iter=1000,random_state=42)),
              'Random Forest':RandomForestClassifier(n_estimators=120,max_depth=7,min_samples_leaf=10,class_weight='balanced',n_jobs=1,random_state=42),
              'Gradient Boosting':HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=15,l2_regularization=5,early_stopping=False,random_state=42)}
    comparison = {}
    for name, model in models.items():
        model.fit(train[FEATURES],train.label.astype(int))
        comparison[name] = float(average_precision_score(tune.label,model.predict_proba(tune[FEATURES])[:,1]))
    # Candidate complexity only increases when validation AP improves.
    chosen = max(comparison,key=comparison.get); model=models[chosen]
    def raw_logit(frame):
        p=np.clip(model.predict_proba(frame[FEATURES])[:,1],1e-6,1-1e-6)
        return np.log(p/(1-p)).reshape(-1,1)
    calibrator=LogisticRegression(C=1,max_iter=500).fit(raw_logit(cal),cal.label.astype(int))
    val_p=calibrator.predict_proba(raw_logit(decision))[:,1]
    moderate=choose_threshold(decision.label,val_p,.95); high=choose_threshold(decision.label,val_p,.8)
    if moderate is None or high is None: return None,{**base,'reason':'NO_VALIDATED_DECISION_THRESHOLDS'}
    high=max(moderate,high)
    final_p=calibrator.predict_proba(raw_logit(test))[:,1]
    final=metrics(test,final_p,high); prevalence=float(train.label.mean())
    baseline=metrics(test,np.full(len(test),prevalence),high)
    rule=((test.change_1h>.2)&(test.rain_6h>=30)).astype(float)
    report={**base,'model_name':chosen,'validation_candidate_pr_auc':comparison,'thresholds':{'moderate':moderate,'high':high},
            'validation':metrics(decision,val_p,high),'test':final,'baseline_climatology':baseline,'baseline_rule':metrics(test,rule,.5),
            'calibration_method':'Sigmoid on disjoint chronological validation partition',
            'acceptance_rule':'Predeclared: test Brier beats training climatology, event recall >= 0.8, precision >= 0.2',
            'by_station':{str(sid):metrics(g,final_p[test.station_id.to_numpy()==sid],high) for sid,g in test.groupby('station_id') if g.loc[g.label==1,'event_id'].nunique()>=5},
            'by_river':{str(river):metrics(g,final_p[test.river_id.to_numpy()==river],high) for river,g in test.groupby('river_id') if g.loc[g.label==1,'event_id'].nunique()>=10} if 'river_id' in test.columns else {}}
    accepted=final['brier_score']<baseline['brier_score'] and (final['event_detection_rate'] or 0)>=.8 and final['precision']>=.2
    eligible=[int(sid) for sid in report['by_station'] if train.loc[(train.station_id==int(sid))&(train.label==1),'event_id'].nunique()>=5]
    report['eligible_station_ids']=eligible
    if accepted and not eligible:
        report.update(status='INSUFFICIENT_GAUGE_VALIDATION_DATA',probability_available=False,reason='NO_GAUGE_HAS_SUFFICIENT_INDEPENDENT_EVENT_EVIDENCE')
        return None,report
    report.update(status='VALIDATED_WARNING_FORECAST' if accepted else 'INDEPENDENT_TEST_ACCEPTANCE_FAILED',probability_available=accepted)
    # Real global permutation importance measured on validation data, not invented local SHAP values.
    rng=np.random.default_rng(42); importance=[]; score=average_precision_score(decision.label,val_p)
    for feature in FEATURES:
        shuffled=decision.copy();shuffled[feature]=rng.permutation(shuffled[feature].to_numpy())
        p=calibrator.predict_proba(raw_logit(shuffled))[:,1]
        importance.append({'feature':feature,'validation_pr_auc_drop':float(score-average_precision_score(decision.label,p))})
    report['explanation']={'method':'Validation permutation importance; global association, not causation','values':importance}
    artifact={'model':model,'calibrator':calibrator,'features':FEATURES,'thresholds':report['thresholds'],'station_ids':eligible}
    return artifact if accepted else None, report

def save_run(conn, report, artifact=None):
    version='warning-v1-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    report.update(model_version=version,generated_at=datetime.now(timezone.utc).isoformat(),prediction_type='NEW_OFFICIAL_WARNING_ISSUANCE')
    report['station_ids']=report.get('station_ids',[])
    if artifact is not None:
        folder=ROOT/'advanced_models';folder.mkdir(exist_ok=True)
        artifact['model_version']=version;joblib.dump(artifact,folder/(version+'.joblib'))
        report['artifact_name']=version+'.joblib';report['artifact_sha256']=hashlib.sha256((folder/report['artifact_name']).read_bytes()).hexdigest()
    report_path=ROOT.parent/'reports/advanced-warning-validation.json';report_path.parent.mkdir(exist_ok=True)
    encoded=json.dumps(report,indent=2,allow_nan=False,default=str);report_path.write_text(encoded,encoding='utf-8')
    cur=conn.cursor();cur.execute('INSERT INTO ml_model_versions(model_version,station_id,prediction_type,status,created_at,report) VALUES(%s,NULL,%s,%s,UTC_TIMESTAMP(),%s)',(version,'WARNING_ISSUANCE',report['status'],encoded))
    cur.execute('INSERT INTO ml_dataset_runs(dataset_id,created_at,target_definition,metadata) VALUES(%s,UTC_TIMESTAMP(),%s,%s)',(version,report['target'],json.dumps(report.get('dataset',{}),default=str)));conn.commit();cur.close()
    print(json.dumps({'status':report['status'],'reason':report.get('reason'),'model_version':version,'dataset':report.get('dataset')},default=str))

def run_training():
    conn=connect();cur=conn.cursor(dictionary=True)
    try:
        stations=fetch(cur,"SELECT DISTINCT s.station_id,s.external_station_id,(SELECT MIN(river_id) FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED') river_id FROM stations s JOIN flood_thresholds f ON f.station_id=s.station_id JOIN official_station_registry o ON o.station_code=s.external_station_id WHERE s.data_source='RIVER_GAUGE' AND f.verification_status='VERIFIED'")
        coverage=fetch(cur,"SELECT * FROM ml_source_coverage WHERE status='COMPLETE'")
        events=fetch(cur,'SELECT * FROM hr_flood_warning_history ORDER BY issued_at')
        base={'status':'INSUFFICIENT_VALIDATION_DATA','probability_available':False,'probability':None,'horizon_hours':3,'features':FEATURES,
              'target':'New official advisory/warning issuance in (t,t+3h], not physical inundation',
              'dataset':{'gauges_in_scope':len(stations),'historical_records':len(events),'issuance_records':sum(e['action']=='ISSUE' for e in events),'complete_coverage_intervals':len(coverage),'confirmed_negative_samples':0},
              'station_ids':[],'reason':'NO_COMPLETE_WARNING_ARCHIVE_COVERAGE'}
        if not coverage:
            save_run(conn,base);return
        frames=[];unknown=0;rainfall_sources={}
        hydro_tables=bool(fetch(cur,"SHOW TABLES LIKE 'hr_rainfall_links'"))
        for s in stations:
            code=str(s['external_station_id']);c=[c for c in coverage if str(c['station_code'])==code]
            if not c: continue
            start=min(c['start_at'] for c in c)-timedelta(hours=73);end=max(c['end_at'] for c in c)
            water=fetch(cur,'SELECT observed_at,water_level FROM water_readings WHERE station_id=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(s['station_id'],start,end))
            links=fetch(cur,"SELECT * FROM station_rainfall_links WHERE station_id=%s AND verification_status IN ('VERIFIED','AUTO_NEAREST')",(s['station_id'],))
            rain=[]
            if links and links[0]['distance_km'] is not None and float(links[0]['distance_km'])<=30:
                rain=fetch(cur,'SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(links[0]['aws_station_code'],start,end))
            source={'provider':'KMA_AWS','code':str(links[0]['aws_station_code'])} if links else None
            hydro=fetch(cur,'SELECT * FROM hr_rainfall_links WHERE station_id=%s AND distance_km<=30',(s['station_id'],)) if hydro_tables else []
            if hydro:
                rain=fetch(cur,'SELECT observed_at,rainfall_mm AS hourly_rainfall FROM hr_rainfall_history WHERE station_code=%s AND observed_at BETWEEN %s AND %s ORDER BY observed_at',(hydro[0]['rainfall_station_code'],start,end))
                source={'provider':'HRFCO','code':str(hydro[0]['rainfall_station_code']),'distance_km':float(hydro[0]['distance_km'])}
            if source: rainfall_sources[str(s['station_id'])]=source
            features=frame_features(water,rain)
            if features.empty: continue
            labels=event_labels(features.index,[e for e in events if str(e['station_code'])==code],c)
            unknown+=int(labels.label.isna().sum());data=features.join(labels).dropna(subset=FEATURES+['label'])
            # Do not train a reassuring negative from an ongoing warning.
            data=new_issuance_origins(data)
            data['station_id']=int(s['station_id']);data['river_id']=s['river_id'];data['t']=data.index;frames.append(data.reset_index(drop=True))
        if not frames:
            save_run(conn,{**base,'reason':'NO_COMPLETE_FEATURE_AND_LABEL_WINDOWS'});return
        data=pd.concat(frames,ignore_index=True);policy=json.loads((ROOT/'warning_split_policy.json').read_text(encoding='utf-8'))
        artifact,report=train_classifier(data,boundaries=policy)
        report['dataset']={**base['dataset'],'unknown_samples_excluded':unknown,'usable_samples':len(data),'confirmed_negative_samples':int((data.label==0).sum()),'positive_warning_events':data.loc[data.label==1,'event_id'].nunique()}
        report['dataset']['training_station_ids']=sorted(map(int,data.station_id.unique()))
        report['station_ids']=artifact['station_ids'] if artifact else [];report['rainfall_sources']=rainfall_sources
        if artifact: artifact['rainfall_sources']=rainfall_sources
        save_run(conn,report,artifact)
    finally: cur.close();conn.close()

def infer():
    request=json.load(sys.stdin);name=request.get('artifact_name','')
    if not name.startswith('warning-v1-') or Path(name).name!=name or not name.endswith('.joblib'): raise ValueError('Invalid local artifact')
    path=ROOT/'advanced_models'/name
    if hashlib.sha256(path.read_bytes()).hexdigest()!=request['artifact_sha256']: raise ValueError('Artifact checksum mismatch')
    artifact=joblib.load(path)
    if int(request['station_id']) not in artifact['station_ids']: raise ValueError('Station outside validated training scope')
    expected=artifact.get('rainfall_sources',{}).get(str(request['station_id']))
    actual=request.get('rainfall_source') or {}
    if expected and (expected['provider']!=actual.get('provider') or str(expected['code'])!=str(actual.get('code'))): raise ValueError('Rainfall source does not match training')
    values=[request['features'].get(f) for f in artifact['features']]
    if any(v is None or not np.isfinite(float(v)) for v in values): raise ValueError('Missing inference features')
    frame=pd.DataFrame([values],columns=artifact['features']);p=np.clip(artifact['model'].predict_proba(frame)[:,1],1e-6,1-1e-6)
    probability=float(artifact['calibrator'].predict_proba(np.log(p/(1-p)).reshape(-1,1))[0,1])
    print(json.dumps({'probability':probability,'model_version':artifact['model_version'],'level':'High' if probability>=artifact['thresholds']['high'] else 'Moderate' if probability>=artifact['thresholds']['moderate'] else 'Low'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['train','infer']);args=parser.parse_args()
    try: run_training() if args.command=='train' else infer()
    except Exception as error:
        # Never print connection configuration or request secrets.
        print(json.dumps({'status':'PIPELINE_FAILED','error_type':type(error).__name__}),file=sys.stderr);sys.exit(1)
