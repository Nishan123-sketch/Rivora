"""Synthetic fixtures test software behavior only; they are never production metrics."""
import unittest
import numpy as np
import pandas as pd
from advanced_warning import frame_features, event_labels, chronological_split, metrics, train_classifier, choose_threshold, FEATURES,new_issuance_origins

class AdvancedWarningTests(unittest.TestCase):
    def test_new_issuance_training_scope_matches_live_none_only(self):
        rows=pd.DataFrame({'ongoing':['NONE','NONE','ADVISORY','WARNING','UNKNOWN'],'label':[0,1,1,1,1]})
        result=new_issuance_origins(rows)
        self.assertEqual(result.index.tolist(),[0,1])
        self.assertEqual(len(rows),5)

    def test_direct_classifier_cannot_fit_unknown_state_origins(self):
        data=self.synthetic();data['ongoing']='UNKNOWN'
        artifact,report=train_classifier(data)
        self.assertIsNone(artifact);self.assertFalse(report['probability_available'])
    def test_missing_rain_and_future_readings(self):
        times=pd.date_range('2026-01-01',periods=80,freq='h')
        water=[{'observed_at':str(t),'water_level':1+i*.01} for i,t in enumerate(times)]
        rain=[{'observed_at':str(t),'hourly_rainfall':0} for t in times]
        features=frame_features(water,rain)
        self.assertEqual(features.iloc[-1].rain_24h,0)
        self.assertAlmostEqual(features.iloc[-1].change_3h,.03)
        rain[-2]['hourly_rainfall']=None
        self.assertTrue(np.isnan(frame_features(water,rain).iloc[-1].rain_24h))
        # A ten-minute reading is not attributed to the earlier whole hour.
        water.append({'observed_at':str(times[-1]+pd.Timedelta(minutes=10)),'water_level':100})
        self.assertLess(frame_features(water,[]).iloc[-1].level,100)

    def test_targets_require_complete_coverage_for_negatives(self):
        t=pd.Timestamp('2026-01-01 10:00:00')
        cancellation={'action':'CANCEL','severity':'WARNING','issued_at':str(t+pd.Timedelta(hours=1)),'event_id':'cancel'}
        self.assertTrue(pd.isna(event_labels([t],[cancellation],[]).iloc[0].label))
        issue={**cancellation,'action':'ISSUE','event_id':'new'}
        self.assertEqual(event_labels([t],[issue],[]).iloc[0].label,1)
        cov=[{'start_at':str(t-pd.Timedelta(days=1)),'end_at':str(t+pd.Timedelta(hours=3)),'status':'COMPLETE','initial_state':'NONE'}]
        self.assertEqual(event_labels([t],[cancellation],cov).iloc[0].label,0)

    @staticmethod
    def synthetic():
        # Clearly separated weekly storm proxies and multiple station events.
        rows=[];rng=np.random.default_rng(7)
        for i,t in enumerate(pd.date_range('2023-01-01',periods=1960,freq='6h')):
            label=int(i%28==0)
            for station in range(3):
                row={f:float(label*3+(0 if label else rng.normal(0,.15))) for f in FEATURES}
                row.update(t=t,station_id=station,label=label,event_id=f'fixture-{i}-{station}' if label else None,
                           event_at=str(t+pd.Timedelta(hours=1)) if label else None,ongoing='NONE')
                rows.append(row)
        return pd.DataFrame(rows)

    def test_chronological_storm_groups_and_purge(self):
        splits=chronological_split(self.synthetic())
        self.assertIsNotNone(splits)
        self.assertLess(splits['train'].t.max()+pd.Timedelta(hours=72),splits['validation'].t.min())
        self.assertLess(splits['validation'].t.max()+pd.Timedelta(hours=72),splits['test'].t.min())
        self.assertFalse(set(splits['train'].group)&set(splits['test'].group))

    def test_metrics_report_missed_events_and_false_alarms(self):
        d=self.synthetic().iloc[:10]
        result=metrics(d,np.zeros(len(d)),.5)
        self.assertEqual(result['event_detection_rate'],0)
        self.assertGreater(result['missed_warning_events'],0)
        self.assertIsNotNone(result['brier_score'])
        wrong=metrics(d,np.ones(len(d)),.5)
        self.assertGreater(wrong['false_alarm_episodes'],0)

    def test_training_calibration_and_unseen_test(self):
        artifact,report=train_classifier(self.synthetic())
        self.assertEqual(report['status'],'VALIDATED_WARNING_FORECAST')
        self.assertIsNotNone(artifact)
        self.assertEqual(len(report['validation_candidate_pr_auc']),3)
        self.assertGreater(report['test']['positive_warning_events'],10)
        self.assertTrue(report['test']['calibration_bins'])
        self.assertTrue(0<=report['thresholds']['moderate']<=report['thresholds']['high']<=1)

    def test_calendar_seasons_keep_future_test_fixed(self):
        d=self.synthetic();policy={'validation_start':'2023-07-01','test_start':'2024-01-01'}
        splits=chronological_split(d,policy)
        self.assertTrue((splits['validation'].t>=pd.Timestamp('2023-07-01')).all())
        self.assertTrue((splits['test'].t>=pd.Timestamp('2024-01-01')).all())
        self.assertFalse(set(splits['validation'].group)&set(splits['test'].group))

    def test_fast_threshold_matches_exhaustive_counts(self):
        y=np.array([0,1,0,1,1,0]);p=np.array([.01,.2,.2,.5,.8,.99])
        for target in [.5,.8,.95]:
            choices=[]
            for t in np.unique(np.r_[.01,p,.99]):
                predicted=p>=t;tp=int(y[predicted].sum());recall=tp/y.sum()
                if recall>=target: choices.append((tp/max(1,predicted.sum()),float(t)))
            self.assertEqual(choose_threshold(y,p,target),max(choices)[1])

    def test_sparse_events_cannot_produce_probabilities(self):
        data=self.synthetic();data.loc[data.label==1,'event_id']='single-storm'
        artifact,report=train_classifier(data)
        self.assertIsNone(artifact);self.assertFalse(report['probability_available'])

if __name__=='__main__': unittest.main()
