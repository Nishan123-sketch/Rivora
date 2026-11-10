import unittest
from level_priority_development import DevelopmentCursor, development_parts
import pandas as pd
from level_research import WATER_FEATURES

class PriorityDevelopmentTests(unittest.TestCase):
 def test_history_queries_are_bounded_without_changing_identity(self):
  class Cursor:
   def execute(self,sql,args):self.sql,self.args=sql,args
  cur=Cursor();bounded=DevelopmentCursor(cur,'2025-01-01','2025-07-01')
  bounded.execute('SELECT observed_at,water_level FROM water_readings WHERE station_id=%s ORDER BY observed_at',(1689,))
  self.assertIn('observed_at BETWEEN %s AND %s',cur.sql);self.assertEqual(cur.args,(1689,'2025-01-01','2025-07-01'))
  bounded.execute('SELECT * FROM hr_rainfall_links WHERE station_id=%s',(1689,));self.assertEqual(cur.args,(1689,))
 def test_development_never_uses_future_target_outside_loaded_data(self):
  index=pd.date_range('2025-01-01',periods=100,freq='h')
  d=pd.DataFrame({k:0. for k in WATER_FEATURES},index=index);d['level']=range(100)
  periods={'train':{'from':str(index[0]),'to':str(index[49])},'selection':{'from':str(index[60]),'to':str(index[-1])}}
  parts=development_parts(d,6,WATER_FEATURES,periods)
  self.assertEqual(parts['selection'].index.max(),index[-7]);self.assertEqual(set(parts),{'train','selection'})

if __name__=='__main__':unittest.main()
