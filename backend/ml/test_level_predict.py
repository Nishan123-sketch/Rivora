import unittest
import pandas as pd,numpy as np
from level_predict import infer_horizon,station_identity_matches
from level_research import WATER_FEATURES,RAIN_FEATURES
class LevelInferenceTests(unittest.TestCase):
 def fixture(self,family='PERSISTENCE'):
  t=pd.Timestamp('2026-11-08 14:00:00');frame=pd.DataFrame([{**{k:np.nan for k in WATER_FEATURES+RAIN_FEATURES},'level':0}],index=[t]);metrics={'pairs':200,'mae_m':.1};original={'horizon_hours':1,'holdout':{'persistence':metrics,'model':{'mae_m':.05},'chosen_method':family},'model_kind':family,'advanced_accepted':family!='PERSISTENCE'};model={'family':family,'features':WATER_FEATURES+RAIN_FEATURES,'model':None,'interval':{'status':'UNAVAILABLE','radius_m':None},'training_period':{},'trend_limit':1};artifact={'version':'unit-artifact','rainfall_source':{'provider':'HRFCO','code':'test'}};station={'station_id':207};return original,model,frame,None,artifact,station,pd.Timestamp('2026-11-08 14:30:00')
 def test_persistence_requires_only_actual_level_and_preserves_zero(self):
  out=infer_horizon(*self.fixture());self.assertEqual(out['forecast_status'],'AVAILABLE');self.assertEqual(out['predicted_level_m'],0);self.assertEqual(out['inference_features'],['level']);self.assertTrue(out['missing_auxiliary_features']);self.assertIsNone(out['interval']['radius_m'])
 def test_ml_input_gaps_use_only_an_evaluated_labelled_baseline(self):
  out=infer_horizon(*self.fixture('RIDGE'));self.assertEqual(out['model_kind'],'PERSISTENCE');self.assertFalse(out['advanced_accepted']);self.assertEqual(out['validation_status'],'EVALUATED_PERSISTENCE_BASELINE');self.assertEqual(out['holdout']['model']['mae_m'],.1)
 def test_changed_actual_input_changes_id_but_repeat_does_not(self):
  args=self.fixture();a=infer_horizon(*args);b=infer_horizon(*args);self.assertEqual(a['forecast_id'],b['forecast_id']);args[2].iloc[0,args[2].columns.get_loc('level')]=1;c=infer_horizon(*args);self.assertNotEqual(a['forecast_id'],c['forecast_id'])
 def test_actual_non_hourly_observation_supports_a_labelled_baseline_not_a_fabricated_hour(self):
  args=self.fixture();args[2]['level']=np.nan;actual={'observed_at':'2026-11-08 14:10:00','water_level':.7,'source_url':'https://www.hrfco.go.kr/sumun/waterlevelList.do'};out=infer_horizon(*args,latest_observation=actual);self.assertEqual(out['predicted_level_m'],.7);self.assertEqual(out['observed_at'],'2026-11-08 14:10:00');self.assertEqual(out['valid_at'],'2026-11-08 15:10:00');self.assertIsNone(out['interval']['radius_m']);self.assertIsNotNone(out['evaluation_cadence_limitation'])
 def test_database_identity_is_checked_independently_of_artifact_metadata(self):
  stored={'external_station_id':'2201670'};self.assertTrue(station_identity_matches(stored,{'external_station_id':'2201670','data_source':'RIVER_GAUGE'}));self.assertFalse(station_identity_matches(stored,{'external_station_id':'1022640','data_source':'RIVER_GAUGE'}));self.assertFalse(station_identity_matches(stored,{'external_station_id':'2201670','data_source':'KWATER'}))
 def test_missing_actual_observation_is_never_invented(self):
  args=self.fixture();args[2]['level']=np.nan;out=infer_horizon(*args);self.assertEqual(out['forecast_status'],'UNAVAILABLE');self.assertIsNone(out['predicted_level_m'])
 def test_latest_complete_causal_origin_can_serve_an_unexpired_accepted_horizon(self):
  args=list(self.fixture('RIDGE'));args[0]['horizon_hours']=3;args[3]=args[4]['rainfall_source'];older={k:0.0 for k in WATER_FEATURES+RAIN_FEATURES};older['level']=1.0;args[2]=pd.concat([pd.DataFrame([older],index=[pd.Timestamp('2026-11-08 13:00:00')]),args[2]])
  class FixedModel:
   def predict(self,x):return np.array([.1]*len(x))
  args[1]['model']=FixedModel();out=infer_horizon(*args);self.assertEqual(out['model_kind'],'RIDGE');self.assertTrue(out['advanced_accepted']);self.assertEqual(out['observed_at'],'2026-11-08 13:00:00');self.assertEqual(out['valid_at'],'2026-11-08 16:00:00');self.assertAlmostEqual(out['predicted_level_m'],1.1);self.assertTrue(out['latest_hour_missing_features'])
 def test_an_expired_earlier_origin_never_becomes_a_new_ml_forecast(self):
  args=list(self.fixture('RIDGE'));args[3]=args[4]['rainfall_source'];older={k:0.0 for k in WATER_FEATURES+RAIN_FEATURES};older['level']=1.0;args[2]=pd.concat([pd.DataFrame([older],index=[pd.Timestamp('2026-11-08 13:00:00')]),args[2]]);out=infer_horizon(*args);self.assertEqual(out['model_kind'],'PERSISTENCE');self.assertFalse(out['advanced_accepted']);self.assertEqual(out['observed_at'],'2026-11-08 14:00:00')
 def test_complete_but_expired_advanced_origin_uses_only_real_fresh_evaluated_baseline(self):
  args=list(self.fixture('RIDGE'));args[3]=args[4]['rainfall_source'];args[2].loc[:,:]=0.;args[-1]=pd.Timestamp('2026-11-08 15:05:00')
  actual={'observed_at':'2026-11-08 14:50:00','water_level':.7,'source_url':'https://www.hrfco.go.kr/sumun/waterlevelList.do'}
  out=infer_horizon(*args,latest_observation=actual)
  self.assertEqual(out['forecast_status'],'AVAILABLE');self.assertEqual(out['model_kind'],'PERSISTENCE');self.assertFalse(out['advanced_accepted']);self.assertEqual(out['predicted_level_m'],.7)
  self.assertEqual(out['valid_at'],'2026-11-08 15:50:00');self.assertEqual(out['fallback_reason'],'EXPIRED_ADVANCED_ORIGIN_EVALUATED_BASELINE_USED');self.assertIsNone(out['interval']['radius_m'])
if __name__=='__main__':unittest.main()
