"""Synthetic values validate software only, never reported as production accuracy."""
import unittest,tempfile
from pathlib import Path
import pandas as pd,numpy as np,joblib
from level_research import quality_and_frame,partition,WATER_FEATURES,RAIN_FEATURES,source_valid,forecast_key,metrics,evaluate_station_horizon,events,artifact_compatible,POLICY,ENGINE_SHA,ROOT,sklearn
class LevelResearchTests(unittest.TestCase):
 def fixture(self,n=300):
  times=pd.date_range('2025-01-01',periods=n,freq='h');raw=[{'observed_at':t,'water_level':1+np.sin(i/20)*.2,'source_url':'https://www.hrfco.go.kr/web/openapiPage/reference.do#waterlevel'} for i,t in enumerate(times)];rain=[{'observed_at':t,'rainfall':0} for t in times];return raw,rain
 def test_future_water_and_rain_do_not_change_past_features(self):
  raw,rain=self.fixture();_,a=quality_and_frame(raw,[],'1234567',rain);cut=150
  for r in raw[cut+1:]:r['water_level']=100
  for r in rain[cut+1:]:r['rainfall']=500
  _,b=quality_and_frame(raw,[],'1234567',rain)
  pd.testing.assert_frame_equal(a.iloc[:cut+1],b.iloc[:cut+1])
 def test_zero_and_missing_rain_stay_distinct(self):
  raw,rain=self.fixture();_,a=quality_and_frame(raw,[],'1234567',rain);self.assertEqual(a.rain_72.iloc[-1],0)
  rain[-3]['rainfall']=None;_,b=quality_and_frame(raw,[],'1234567',rain);self.assertTrue(pd.isna(b.rain_6.iloc[-1]));self.assertEqual(b.rain_1.iloc[-1],0)
 def test_identity_and_provenance_gate_unknown_history(self):
  self.assertFalse(source_valid('http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata?obscd=9999999','1234567'))
  raw,rain=self.fixture()
  for r in raw:r['source_url']=None
  q,f=quality_and_frame(raw,[],'1234567',rain);self.assertFalse(q['forecasting_eligible']);self.assertTrue(f.empty)
 def test_reconciliation_is_derived_and_never_mutates_raw(self):
  raw,rain=self.fixture();original=raw[0]['water_level'];verified=[{**raw[0],'water_level':2}];q,_=quality_and_frame(raw,verified,'1234567',rain)
  self.assertEqual(q['official_reconciliation_value_differences'],1);self.assertEqual(raw[0]['water_level'],original)
 def test_conflicting_duplicate_is_reviewed_not_silently_resolved(self):
  raw,rain=self.fixture();raw.append({**raw[-1],'water_level':5});q,_=quality_and_frame(raw,[],'1234567',rain);self.assertEqual(q['conflicting_duplicates'],1);self.assertFalse(q['forecasting_eligible'])
 def test_chronological_partitions_have_full_feature_target_purge(self):
  raw,rain=self.fixture(4000);_,f=quality_and_frame(raw,[],'1234567',rain);p=partition(f,6,WATER_FEATURES)
  for a,b in [('train','selection'),('selection','calibration'),('calibration','test')]:self.assertLess(p[a].index.max()+pd.Timedelta(hours=78),p[b].index.min())
 def test_hour_gaps_and_episode_counts_do_not_depend_on_pandas_timestamp_resolution(self):
  raw,rain=self.fixture(300);q,f=quality_and_frame(raw,[],'1234567',rain);self.assertEqual(q['longest_gap_hours'],1)
  mask=np.zeros(len(f),dtype=bool);mask[0]=True;mask[150]=True;self.assertEqual(events(f,mask),2)
 def test_artifact_identity_policy_runtime_and_schema_are_enforced(self):
  import hashlib
  from copy import deepcopy
  station={'station_id':207,'external_station_id':'2201670'}
  a={'station_id':207,'station_code':'2201670','schema_version':POLICY['version'],'engine_sha256':ENGINE_SHA,'sklearn_version':sklearn.__version__,'policy_sha256':hashlib.sha256((ROOT/'level_policy.json').read_bytes()).hexdigest(),'horizons':{1:{'features':WATER_FEATURES}}}
  self.assertTrue(artifact_compatible(a,station))
  for patch in [{'station_code':'9999999'},{'schema_version':'other'},{'engine_sha256':'other'},{'policy_sha256':'other'},{'sklearn_version':'other'},{'horizons':{1:{'features':['future_rain']}}}]:
   b=deepcopy(a);b.update(patch);self.assertFalse(artifact_compatible(b,station))
 def test_future_observations_are_flagged_and_never_enter_features(self):
  raw,rain=self.fixture();raw.append({'observed_at':pd.Timestamp('2100-01-01'),'water_level':99,'source_url':'https://www.hrfco.go.kr/sumun/waterlevelList.do'});q,f=quality_and_frame(raw,[],'1234567',rain);self.assertEqual(q['future_timestamp_rows'],1);self.assertLess(f.index.max(),pd.Timestamp('2100-01-01'))
 def test_forecast_ids_deduplicate_same_artifact_input_and_horizon(self):
  a=forecast_key(207,'v','2026-01-01 00:00:00',1);self.assertEqual(a,forecast_key(207,'v','2026-01-01 00:00:00',1));self.assertNotEqual(a,forecast_key(207,'v','2026-01-01 00:00:00',3))
 def test_metrics_include_bias_median_tail_and_true_zero(self):
  m=metrics([1,2,3],[1,2,3]);self.assertEqual(m['mae_m'],0);self.assertEqual(m['p95_absolute_error_m'],0);self.assertIsNone(metrics([],[]))
 def test_development_model_choice_does_not_use_final_outcomes(self):
  raw,rain=self.fixture(10000);_,f=quality_and_frame(raw,[],'1234567',rain);a,artifact=evaluate_station_horizon(f,1)
  self.assertFalse(a['evaluation']['test_used_for_selection']);self.assertIsNotNone(artifact)
  # Alter final targets through future levels, while leaving all development features unchanged.
  changed=f.copy();at=int(len(f)*.84);changed.loc[changed.index[at:],'level']+=.5
  b,_=evaluate_station_horizon(changed,1)
  self.assertEqual(a['evaluation']['chosen_on_development'],b['evaluation']['chosen_on_development'])
  with tempfile.TemporaryDirectory() as d:
   file=Path(d)/'model.joblib';joblib.dump(artifact,file);restored=joblib.load(file);self.assertEqual(restored['features'],artifact['features']);self.assertEqual(restored['schema_version'],artifact['schema_version'])
if __name__=='__main__':unittest.main()
