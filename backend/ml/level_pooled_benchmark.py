"""Known-station pooled/basin benchmark with common calendar partitions.
No held-out-station transfer or deployable pooled-model claim is made.
"""
import json
import numpy as np,pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from level_research import connect,load_station,metrics,REPORT,save_json,stamp,WATER_FEATURES

def run():
 report=json.loads((REPORT/'training.json').read_text(encoding='utf-8'));candidates=[s for s in report['stations'] if s.get('eligible') and s.get('quality',{}).get('derived_provenanced_count',0)>=6000][:24]
 conn=connect();cur=conn.cursor(dictionary=True);frames=[];exclusions=[]
 try:
  for s in candidates:
   _,f,_=load_station(cur,s);f=f.copy();f['station_id']=s['station_id'];f['river_id']=s.get('river_id')
   dev=f[f.index<pd.Timestamp('2026-07-01')-pd.Timedelta(hours=78)];scale=float(dev.level.quantile(.75)-dev.level.quantile(.25)) if len(dev) else 0
   if len(dev.dropna(subset=WATER_FEATURES))<720 or not np.isfinite(scale) or scale<=0:exclusions.append({'station_id':s['station_id'],'reason':'INSUFFICIENT_COMMON_PERIOD_HISTORY_OR_VARIATION'});continue
   f['scale']=scale;frames.append(f)
  results=[]
  for h in [1,3,6]:
   splits=[]
   for f in frames:
    d=f.copy();d['actual']=d.level.shift(-h);d['target']=(d.actual-d.level)/d.scale
    for k in WATER_FEATURES:d[k]=d[k]/d.scale
    d=d.dropna(subset=WATER_FEATURES+['target','actual']);tr=d[d.index<pd.Timestamp('2026-07-01')-pd.Timedelta(hours=78)];val=d[(d.index>='2026-07-01')&(d.index<pd.Timestamp('2026-09-01')-pd.Timedelta(hours=78))];test=d[d.index>='2026-09-01']
    if min(len(val),len(test))<168:continue
    splits.append((tr,val,test))
   if len(splits)<3:results.append({'horizon_hours':h,'status':'INSUFFICIENT_COMMON_PERIOD_STATIONS','stations':len(splits)});continue
   train=pd.concat([s[0] for s in splits]);validation=pd.concat([s[1] for s in splits]);test=pd.concat([s[2] for s in splits]);model=make_pipeline(StandardScaler(),Ridge(alpha=5)).fit(train[WATER_FEATURES],train.target)
   pooled=test.level.to_numpy()+model.predict(test[WATER_FEATURES])*test.scale.to_numpy();individual=[];truth=[];persist=[]
   for tr,_,te in splits:
    own=make_pipeline(StandardScaler(),Ridge(alpha=5)).fit(tr[WATER_FEATURES],tr.target);individual.extend(te.level+own.predict(te[WATER_FEATURES])*te.scale);truth.extend(te.actual);persist.extend(te.level)
   basins=[]
   for basin,g in train.groupby('river_id'):
    te=test[test.river_id==basin]
    if g.station_id.nunique()<3 or te.station_id.nunique()<3:continue
    bm=make_pipeline(StandardScaler(),Ridge(alpha=5)).fit(g[WATER_FEATURES],g.target);p=te.level+bm.predict(te[WATER_FEATURES])*te.scale;basins.append({'river_id':basin,'stations':int(te.station_id.nunique()),'pooled_basin':metrics(te.actual,p),'persistence':metrics(te.actual,te.level)})
   results.append({'horizon_hours':h,'status':'RETROSPECTIVE_BENCHMARK_ONLY','stations':len(splits),'train_samples':len(train),'test_samples':len(test),'pooled':metrics(test.actual,pooled),'station_specific_ridge':metrics(truth,individual),'persistence':metrics(truth,persist),'basin_comparisons':basins})
  out={'generated_at':stamp(),'policy':'Common calendar: training before 2026-07-01, development July–August, retrospective test from 2026-09-01; 78h purge. Fixed Ridge alpha=5. Per-station scale fitted on training only. No absolute elevation feature.','selected_station_limit':24,'candidate_stations':len(candidates),'results':results,'exclusions':exclusions,'deployment_status':'NOT_DEPLOYED_BENCHMARK_ONLY','transfer_status':'HELD_OUT_STATION_TRANSFER_NOT_EVALUATED','limitation':'Known-station calendar benchmark; source datum epochs, basin rainfall and station-transfer reliability not established.'};save_json(REPORT/'pooled-benchmark.json',out);print(json.dumps({'candidates':len(candidates),'benchmarks':len(results)}));return out
 finally:cur.close();conn.close()
if __name__=='__main__':run()
