import unittest
import numpy as np
from pipeline import features, train_station
class PipelineTest(unittest.TestCase):
    def test_gap_is_not_zero(self):
        water=[{'observed_at':f'2026-01-01 {i:02d}:00:00','water_level':i} for i in range(24)]
        rain=[{'observed_at':r['observed_at'],'hourly_rainfall':0} for i,r in enumerate(water) if i!=15]
        d=features(water,rain)
        self.assertTrue(np.isnan(d.iloc[16].rain_3h))
        self.assertEqual(d.iloc[14].rain_3h,0)
        self.assertTrue(np.isnan(d.iloc[-1].target))
    def test_chronology_and_classes(self):
        import pandas as pd
        times=pd.date_range('2026-01-01',periods=400,freq='h')
        water=[{'observed_at':t,'water_level':float(2+2*np.sin(i/5))} for i,t in enumerate(times)]
        rain=[{'observed_at':t,'hourly_rainfall':float(i%7)} for i,t in enumerate(times)]
        t=dict(interest_level_m=.5,caution_level_m=1.5,alert_level_m=2.5,severe_level_m=4.5,verification_status='VERIFIED',source_url='fixture',verified_at='2026-01-01')
        model,report=train_station(features(water,rain),t)
        self.assertLess(report['training_end'],report['testing_start'])
        self.assertEqual(report['status'],'CLASSIFIER_READY')
        self.assertEqual(len(report['f1']),3)
        model,report=train_station(features(water,rain),None)
        self.assertIsNone(model['classifier']);self.assertIsNone(report['roc_auc'])
if __name__=='__main__':unittest.main()
