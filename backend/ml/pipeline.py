"""Station-specific experimental next-hour stage model; no invented flood labels."""
import argparse
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score, mean_absolute_error

ROOT = Path(__file__).resolve().parent
FEATURES = ['level', 'lag_1h', 'lag_3h', 'change_1h', 'rain_1h', 'rain_3h', 'rain_6h', 'rain_12h']

def features(water, rain):
    if not water or not rain:
        return pd.DataFrame(columns=FEATURES + ['target'])
    w = pd.DataFrame(water).drop_duplicates('observed_at').set_index('observed_at')
    r = pd.DataFrame(rain).drop_duplicates('observed_at').set_index('observed_at')
    w.index, r.index = pd.to_datetime(w.index), pd.to_datetime(r.index)
    index = pd.date_range(w.index.min().ceil('h'), w.index.max().floor('h'), freq='h')
    data = pd.DataFrame(index=index)
    data['level'] = pd.to_numeric(w.water_level, errors='coerce').reindex(index)
    data['rain_1h'] = pd.to_numeric(r.hourly_rainfall, errors='coerce').reindex(index)
    data.loc[data.rain_1h < 0, 'rain_1h'] = np.nan
    data['lag_1h'], data['lag_3h'] = data.level.shift(1), data.level.shift(3)
    data['change_1h'] = data.level - data.lag_1h
    for hours in [3, 6, 12]:
        data[f'rain_{hours}h'] = data.rain_1h.rolling(hours, min_periods=hours).sum()
    data['target'] = data.level.shift(-1)
    return data

def verified_threshold(t):
    if not t or t.get('verification_status') != 'VERIFIED' or not t.get('source_url') or not t.get('verified_at'):
        return False
    vals = [t.get(k) for k in ['interest_level_m','caution_level_m','alert_level_m','severe_level_m']]
    return all(v is not None and np.isfinite(float(v)) for v in vals) and all(float(a) < float(b) for a, b in zip(vals, vals[1:]))

def labels(levels, t):
    return np.where(levels >= float(t['alert_level_m']), 2, np.where(levels >= float(t['caution_level_m']), 1, 0))

def train_station(data, threshold):
    samples = data.dropna(subset=FEATURES + ['target'])
    if len(samples) < 70:
        return None, {'status':'INSUFFICIENT_TRAINING_DATA', 'examples':len(samples)}
    cut = int(len(samples)*.8)
    test = samples.iloc[cut:]
    # Purge the final training target at the first test feature timestamp.
    train = samples.iloc[:cut]
    train = train[train.index + pd.Timedelta(hours=1) < test.index.min()]
    x, y = train[FEATURES], train.target
    reg = make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(x, y)
    ml_mae = float(mean_absolute_error(test.target, reg.predict(test[FEATURES])))
    baseline_mae = float(mean_absolute_error(test.target, test.level))
    artifact = {'regressor':reg if ml_mae < baseline_mae else None, 'classifier':None,
                'thresholds':{k:str(v) for k,v in (threshold or {}).items()}, 'features':FEATURES}
    report = {'status':'REGRESSION_READY', 'train_examples':len(train),'test_examples':len(test),
              'training_end':str(train.index.max()), 'testing_start':str(test.index.min()),
              'split':'chronological 80/20, one-hour target purge; no shuffle',
              'level_mae_m':ml_mae,'persistence_mae_m':baseline_mae,
              'selected_level_model':'Ridge' if artifact['regressor'] is not None else 'Persistence',
              'precision':None,'recall':None,'f1':None,'roc_auc':None,
              'classification_note':'Verified station thresholds required to define next-hour stage labels.'}
    if verified_threshold(threshold):
        yt, ye = labels(y, threshold), labels(test.target, threshold)
        if len(set(yt)) == 3:
            model = make_pipeline(StandardScaler(), LogisticRegression(class_weight='balanced', max_iter=2000))
            model.fit(x, yt)
            pred = model.predict(test[FEATURES]); prob = model.predict_proba(test[FEATURES])
            p, r, f, support = precision_recall_fscore_support(ye, pred, labels=[0,1,2], zero_division=0)
            report.update(status='CLASSIFIER_READY', precision=p.tolist(),recall=r.tolist(), f1=f.tolist(),support=support.tolist(),
                          classes=['Low','Moderate','High'],class_weight='balanced',
                          roc_auc=float(roc_auc_score(ye,prob,multi_class='ovr',labels=[0,1,2])) if len(set(ye))==3 else None,
                          classification_note='Predicts next-hour verified stage category, not flood occurrence. ROC-AUC is null if test classes are missing.')
            artifact['classifier'] = model
        else:
            report['classification_note'] = 'Training period lacks one or more stage classes; collect representative events. No synthetic labels generated.'
    return artifact, report

def connect():
    from dotenv import load_dotenv
    import mysql.connector
    load_dotenv(ROOT.parent / '.env')
    return mysql.connector.connect(host=os.getenv('DB_HOST','localhost'),port=int(os.getenv('DB_PORT','3306')),
        user=os.getenv('DB_USER'),password=os.getenv('DB_PASSWORD',''),database=os.getenv('DB_NAME','weather_flood_db'))

def fetch(cursor, sql, args=()):
    cursor.execute(sql,args)
    return cursor.fetchall()

def run(mode):
    conn=connect(); cur=conn.cursor(dictionary=True); reports={}; now=datetime.now(ZoneInfo('Asia/Seoul')).replace(tzinfo=None)
    try:
        stations=fetch(cur,"SELECT * FROM stations WHERE data_source='RIVER_GAUGE'")
        for station in stations:
            sid=station['station_id']
            try:
                links=fetch(cur,"SELECT * FROM station_rainfall_links WHERE station_id=%s AND verification_status='VERIFIED'",(sid,))
                thresholds=fetch(cur,'SELECT * FROM flood_thresholds WHERE station_id=%s',(sid,)); threshold=thresholds[0] if thresholds else None
                start=(os.getenv('ML_HISTORY_START') or (now-pd.DateOffset(months=13)).strftime('%Y-%m-%d')) if mode=='train' else now-timedelta(days=3)
                water=fetch(cur,'SELECT observed_at,water_level FROM water_readings WHERE station_id=%s AND observed_at>=%s ORDER BY observed_at',(sid,start))
                rain=fetch(cur,'SELECT observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=%s AND observed_at>=%s ORDER BY observed_at',(links[0]['aws_station_code'],start)) if links else []
                data=features(water,rain); model_file=ROOT/f'station_{sid}.joblib'
                if mode=='train':
                    artifact, report=train_station(data,threshold)
                    reports[str(sid)]=report
                    if artifact:
                        artifact.update(station_id=sid,aws_code=links[0]['aws_station_code'],version='stage-v1-'+now.strftime('%Y%m%d%H%M%S'))
                        joblib.dump(artifact,model_file)
                    continue
                if not water or water[-1]['water_level'] is None:
                    reports[str(sid)]={'status':'NO_STATION_DATA'};continue
                observed=water[-1]['observed_at']; age=(now-observed).total_seconds()/3600
                if not 0<=age<=3:
                    reports[str(sid)]={'status':'STALE_DATA'};continue
                level=float(water[-1]['water_level']); prediction=level; risk=None; score=None; status='PERSISTENCE'; version='persistence-v1'; feature_values=None
                reason='One-hour persistence baseline. No trained classifier or complete mapped rainfall features.'
                if model_file.exists() and not data.empty and observed in data.index and data.loc[observed,FEATURES].notna().all():
                    artifact=joblib.load(model_file)
                    same_source=links and str(artifact.get('aws_code'))==str(links[0]['aws_station_code'])
                    if same_source:
                        x=data.loc[[observed],FEATURES];feature_values={k:float(v) for k,v in x.iloc[0].items()};version=artifact['version']
                        if artifact['regressor'] is not None: prediction=float(artifact['regressor'].predict(x)[0]);status='ML_LEVEL'
                        same_thresholds=artifact['thresholds']=={k:str(v) for k,v in (threshold or {}).items()}
                        if artifact['classifier'] is not None and verified_threshold(threshold) and same_thresholds:
                            probabilities=artifact['classifier'].predict_proba(x)[0]
                            risk=['Low','Moderate','High'][int(np.argmax(probabilities))]
                            score=round(float(probabilities[1]*50+probabilities[2]*100),2);status='ML_STAGE'
                            reason='Experimental next-hour stage classifier. Score = 50×P(Moderate)+100×P(High); not flood probability.'
                        else: reason='Level model available; stage classifier needs unchanged verified thresholds and representative training classes.'
                if risk is None and verified_threshold(threshold):
                    risk=['Low','Moderate','High'][int(labels(np.array([prediction]),threshold)[0])]
                    reason += ' Predicted level compared with verified stage thresholds; this category is not an ML classifier result.'
                # Every emitted prediction is committed before APIs can display it. Retry is idempotent.
                cur.execute('''INSERT INTO prediction_history(station_id,observed_at,valid_at,generated_at,model_version,predicted_water_level,risk_score,risk_level,status,reason,features_json)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE prediction_id=LAST_INSERT_ID(prediction_id)''',
                    (sid,observed,observed+timedelta(hours=1),now,version,prediction,score,risk,status,reason,json.dumps(feature_values)))
                conn.commit();reports[str(sid)]={'status':status,'risk_level':risk}
            except Exception as e:
                conn.rollback();reports[str(sid)]={'status':'ERROR','reason':type(e).__name__}
        if mode=='train':
            (ROOT/'classification_metrics.json').write_text(json.dumps({'generated_at':str(now),'stations':reports},indent=2))
        return reports
    finally:
        cur.close();conn.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['train','refresh']);args=parser.parse_args()
    try: print(json.dumps(run(args.mode)))
    except Exception as e:
        print(json.dumps({'status':'ERROR','reason':type(e).__name__}));raise SystemExit(1)
