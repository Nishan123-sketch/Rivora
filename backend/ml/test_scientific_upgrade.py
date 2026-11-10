import unittest
import numpy as np
import pandas as pd
from level_development_upgrade import features,summarize,cv_eligible,development_gate,robust_features,tail_diagnostics
from warning_hydrology_research import hydro_features,station_context,CONTEXT_FEATURES,calendar_features,CALENDAR_FEATURES
from warning_development_research import qualify_threshold
from scientific_data_audit import intervals,hourly_grid
class ScientificUpgradeTests(unittest.TestCase):
 def test_calendar_features_use_kst_origin_only_and_do_not_use_future_rows(self):
  d=pd.DataFrame({'t':pd.to_datetime(['2025-07-17 03:00+00:00','2025-07-18 03:00+00:00']),'label':[0,1]})
  first=calendar_features(d);changed=d.copy();changed.loc[1,'t']=pd.Timestamp('2025-12-01 06:00+00:00');changed['label']=1-changed.label
  np.testing.assert_allclose(first.loc[0,CALENDAR_FEATURES].to_numpy(float),calendar_features(changed).loc[0,CALENDAR_FEATURES].to_numpy(float))
  self.assertAlmostEqual(first.loc[0,'kst_hour_cos'],-1.)
 def test_station_context_fits_only_training_levels_and_ignores_labels(self):
  train=pd.DataFrame({'station_id':[1,1,1,1], 'level':[1.,2.,3.,4.], 'label':[0,0,0,1]})
  data=pd.DataFrame({'station_id':[1,1], 'level':[3.,4.], 'change_1h':[.1,.2], 'change_3h':[.2,.3], 'change_6h':[.4,.5]})
  first=station_context(train,data);later=data.copy();later.loc[1,'level']=1000
  pd.testing.assert_series_equal(first.iloc[0],station_context(train,later).iloc[0])
  other=train.copy();other['label']=1-other.label
  pd.testing.assert_frame_equal(first,station_context(other,data))
 def test_station_context_does_not_assign_other_gauges_a_fake_reference(self):
  train=pd.DataFrame({'station_id':[1,1], 'level':[1.,2.]})
  data=pd.DataFrame({'station_id':[2], 'level':[20.], 'change_1h':[.1], 'change_3h':[.2], 'change_6h':[.3]})
  row=station_context(train,data).iloc[0]
  self.assertEqual(row.station_context_missing,1)
  self.assertTrue(row[CONTEXT_FEATURES[:-1]].isna().all())
 def test_level_added_features_do_not_use_future_rows(self):
  a=pd.DataFrame({'change_1':[1,2,3.],'change_3':[3,6,9.],'change_6':[6,12,18.],'std_6':[.1,.2,.3],'std_24':[.2,.3,.4]});b=a.copy();b.loc[2,:]=999
  pd.testing.assert_frame_equal(features(a).iloc[:2],features(b).iloc[:2])
 def test_hydrology_uses_observed_nonnegative_rain_interaction(self):
  a=pd.DataFrame({'rain_3h':[3.,0],'rain_6h':[6.,0],'rain_12h':[12.,0],'change_3h':[.3,-.3],'change_1h':[.1,-.1]});r=hydro_features(a);self.assertEqual(r.rise_rain_interaction.iloc[1],0);self.assertTrue(np.isfinite(r.to_numpy()).all())
 def test_threshold_precision_floor_is_not_relaxed(self):
  d=pd.DataFrame({'label':[1,0,0,0,0,0], 'event_id':['e',None,None,None,None,None]});self.assertIsNone(qualify_threshold(d,np.full(6,.5)))
 def test_single_event_cannot_qualify_even_at_perfect_precision(self):
  d=pd.DataFrame({'label':[1,0], 'event_id':['e',None]});self.assertIsNone(qualify_threshold(d,np.array([.9,.1])))
 def test_summary_weights_pooled_errors_by_pairs(self):
  rows=[{'horizon_hours':1,'station_code':str(n),'selection_samples':n,'persistence':{'mae_m':v,'rmse_m':v},'after_development':{'mae_m':v/2,'rmse_m':v/2}} for n,v in [(1,1.),(3,3.)]]
  result=summarize(rows)[0];self.assertEqual(result['persistence']['station_mean_mae_m'],2.)
  self.assertEqual(result['persistence']['pooled_mae_m'],2.5)
  self.assertAlmostEqual(result['persistence']['pooled_rmse_m'],np.sqrt(7))
 def test_gap_ranges_are_exact_and_do_not_fill_observations(self):
  times=pd.to_datetime(['2025-01-01 00:00','2025-01-01 01:00','2025-01-01 03:00']);r=intervals(times);self.assertEqual([x['missing_hours'] for x in r],[2,1]);self.assertEqual(len(times),3)
 def test_empty_gap_list(self):self.assertEqual(intervals([]),[])
 def test_gap_grid_does_not_misclassify_hourly_rain_as_missing(self):
  grid=hourly_grid('2025-07-17 11:20','2025-07-17 14:20')
  observed=pd.date_range('2025-07-17 12:00',periods=3,freq='h')
  self.assertEqual(len(grid.difference(observed)),0)
  self.assertEqual(str(grid[0]),'2025-07-17 12:00:00')
 def test_gap_grid_does_not_extend_beyond_coverage(self):
  self.assertEqual(len(hourly_grid('2025-07-17 11:20','2025-07-17 11:50')),0)
 def test_cv_rejects_lower_mae_with_worse_rmse(self):
  fold={'candidate':{'pairs':168,'mae_m':.8,'rmse_m':1.2},'persistence':{'pairs':168,'mae_m':1.,'rmse_m':1.}}
  self.assertFalse(cv_eligible([fold,fold]))
  fold['candidate']['rmse_m']=.9;self.assertTrue(cv_eligible([fold,fold]))
  self.assertFalse(cv_eligible([fold]))
 def test_development_gate_preserves_high_water_safeguard(self):
  candidate={'mae_m':.8,'rmse_m':.9};baseline={'mae_m':1.,'rmse_m':1.}
  group={'samples':40,'selected':{'mae_m':1.11},'persistence':{'mae_m':1.}}
  self.assertFalse(development_gate(candidate,baseline,{'groups':{'high_water_proxy':group}}))
 def test_robust_features_are_causal_and_preserve_missing_rain(self):
  index=pd.date_range('2025-01-01',periods=12,freq='h')
  d=pd.DataFrame({'level':np.arange(12.),'change_1':1.,'change_3':3.,'change_6':6.,'std_6':1.,'std_24':2.,'rain_6':np.nan,'rain_12':np.nan},index=index)
  altered=d.copy();altered.iloc[-1]=999
  pd.testing.assert_frame_equal(robust_features(d).iloc[:-1],robust_features(altered).iloc[:-1])
  self.assertTrue(robust_features(d).rain_growth_6.isna().all())
  self.assertTrue(robust_features(d).rise_rain_interaction.isna().all())
 def test_tail_diagnostics_retain_authentic_extreme_targets(self):
  d=pd.DataFrame({'target':[.1,.2,10.],'actual':[.1,.2,10.],'level':[0.,0.,0.]})
  result=tail_diagnostics(d,d,np.zeros(3));self.assertEqual(result['extreme_observations_removed'],0)
  self.assertEqual(result['large_observed_change_samples'],1);self.assertEqual(len(d),3)
if __name__=='__main__':unittest.main()
