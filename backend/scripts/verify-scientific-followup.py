"""Read-only verification of this continuation's artifacts, observations and paired metrics."""
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ml'))
from pipeline import connect
OUT=ROOT/'reports/scientific-followup-20261109'
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def run():
 protected=read(OUT/'protected-artifacts-before.json')
 changed=[name for name,digest in protected.items() if not Path(name).is_file() or hashlib.sha256(Path(name).read_bytes()).hexdigest()!=digest]
 baseline=read(ROOT/'reports/scientific-continuation-20261109/level-development-results.json')['results']
 reproduced=read(OUT/'reproduction/level-development-results.json')['results']
 tail=read(OUT/'reproduction-tail/level-development-results.json')['results']
 robust=read(OUT/'robust/robust-development-results.json')['results']
 keyed=lambda rows:{(r['station_code'],r['horizon_hours']):r for r in rows}
 base,rep,rob=keyed(baseline),keyed(reproduced),keyed(robust)
 assert base.keys()==rep.keys(),'Reproduction cohort changed'
 assert all(rep[k]['selection_samples']==r['selection_samples'] and rep[k]['periods']==r['periods'] for k,r in rob.items()),'Robust comparison is not paired'
 comparisons=[]
 old_summary=read(OUT/'reproduction/level-development-summary.json');new_summary=read(OUT/'robust/robust-development-summary.json')
 for new in new_summary:
  old=next(r for r in old_summary if r['horizon_hours']==new['horizon_hours'])
  comparisons.append({'horizon_hours':new['horizon_hours'],'pairs':new['pairs'],'persistence':new['persistence'],'november9_candidate':old['candidate'],'robust_development':new['candidate'],'regimes':new['regime_metrics'],
   'mae_gain_vs_november9_fraction':1-new['candidate']['pooled_mae_m']/old['candidate']['pooled_mae_m'],
   'rmse_gain_vs_november9_fraction':1-new['candidate']['pooled_rmse_m']/old['candidate']['pooled_rmse_m']})
 recovery=[read(OUT/name) for name in ['rainfall-recovery-results.json','rainfall-recovery-supplement.json','rainfall-storm-completion.json']]
 imported=[]
 for report in recovery:
  for row in report['requests']:
   if row.get('inserted'):imported.extend(('HRFCO',row['rain_station_code'],r['at'],r['value']) for r in row['records'])
  for row in report['aws_requests']:
   if row.get('inserted'):imported.extend(('KMA_AWS',row['station_code'],r['at'],r['value']) for r in row['records'])
 conn=connect();cur=conn.cursor();mismatches=[]
 try:
  for provider,code,at,value in imported:
   sql=('SELECT rainfall_mm FROM hr_rainfall_history WHERE station_code=%s AND observed_at=%s' if provider=='HRFCO' else 'SELECT hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=%s AND observed_at=%s')
   cur.execute(sql,(code,at));row=cur.fetchone()
   if not row or row[0] is None or abs(float(row[0])-value)>.0001:mismatches.append([provider,code,at])
 finally:cur.close();conn.close()
 warning=read(OUT/'warning/warning-research-results.json')
 summary={'baseline_date':'2026-11-09','reproduced_station_horizons':len(rep),
  'max_mae_difference_vs_continuation_m':max(abs(base[k]['after_development']['mae_m']-rep[k]['after_development']['mae_m']) for k in base),
  'max_mae_difference_single_thread_rerun_m':max(abs(rep[(r['station_code'],r['horizon_hours'])]['after_development']['mae_m']-r['after_development']['mae_m']) for r in tail),
  'paired_robust_station_horizons':len(rob),'level_comparisons':comparisons,
  'research_advanced_choices':sum(r['development_method']!='PERSISTENCE' for r in robust),
  'research_persistence_choices':sum(r['development_method']=='PERSISTENCE' for r in robust),
  'authentic_imported_records':len(imported),'hrfco_records':sum(p=='HRFCO' for p,_,_,_ in imported),'kma_aws_records':sum(p=='KMA_AWS' for p,_,_,_ in imported),
  'import_database_mismatches':mismatches,'remaining_point_rain_missing_hours':sum(r['rain_missing_hours'] for r in read(OUT/'after-recovery/authentic-data-audit.json')['warning_feature_intervals']),
  'remaining_gap_windows':len(read(OUT/'after-recovery/authentic-data-gaps.json')),
  'protected_artifact_files':len(protected),'changed_protected_artifacts':changed,
  'warning_independent_validation':'EXISTING_FAILED_STATUS_PRESERVED','warning_new_independent_evaluation':warning['independent_evaluation'],
  'warning_counts':warning['counts'],'warning_candidates':[{k:c[k] for k in ['name','selection_ap','decision_ap','brier','baseline_brier','qualified_threshold','false_positive_diagnosis','diagnostic_at_frozen_existing_threshold']} for c in warning['candidates']],
  'level_independent_validation':'NOT_EVALUATED_NOT_DEPLOYED','extreme_targets_removed':0}
 (OUT/'verification-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
 assert not changed and not mismatches,'Protected artifact or recovered observation verification failed'
 print(json.dumps({k:summary[k] for k in ['reproduced_station_horizons','max_mae_difference_vs_continuation_m','authentic_imported_records','import_database_mismatches','changed_protected_artifacts','remaining_gap_windows']}))
if __name__=='__main__':run()
