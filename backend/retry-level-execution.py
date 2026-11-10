import sys,traceback
sys.path.insert(0,'ml')
import level_research as core
for name in ['load_station','evaluate_station_horizon']:
 original=getattr(core,name)
 def wrapped(*args,_original=original,_name=name,**kwargs):
  try:return _original(*args,**kwargs)
  except Exception:
   print('Failure in '+_name,file=sys.stderr);traceback.print_exc();raise
 setattr(core,name,wrapped)
core.train(ids=[2874,2875,2934])
