"""Run a private local model and release its startup-only mapped working set on Windows."""
import sys,subprocess,time,urllib.request,ctypes,os
if len(sys.argv)<3:raise SystemExit('Expected executable and model arguments')
args=sys.argv[1:];port=args[args.index('--port')+1]
process=subprocess.Popen(args,cwd=os.path.dirname(args[0]),creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
try:
 for _ in range(90):
  if process.poll() is not None:raise SystemExit(process.returncode)
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+port+'/health',timeout=1) as response:
    if response.status==200:break
  except Exception:time.sleep(1)
 if os.name=='nt':
  from ctypes import wintypes
  trim=ctypes.windll.psapi.EmptyWorkingSet;trim.argtypes=[wintypes.HANDLE];trim.restype=wintypes.BOOL
  print('Startup model pages released:',bool(trim(wintypes.HANDLE(int(process._handle)))),flush=True)
 process.wait()
finally:
 if process.poll() is None:process.terminate();process.wait(timeout=10)
