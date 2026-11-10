from pathlib import Path
import urllib.request,json,hashlib,zipfile,concurrent.futures,time
root=Path(__file__).resolve().parents[2]/'.local';dest=root/'llama-cuda';dest.mkdir(parents=True,exist_ok=True)
def metadata(url):return json.load(urllib.request.urlopen(url,timeout=30))
release=metadata('https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b12182')
assets=[a for a in release['assets'] if a['name'] in ['llama-b12182-bin-win-cuda-12.4-x64.zip','cudart-llama-bin-win-cuda-12.4-x64.zip']]
model={'name':'Qwen3-4B-Q4_K_M.gguf','browser_download_url':'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf','size':2497280256,'digest':'sha256:7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'}

import math,threading
items=assets+[model]
def already_verified(a):
 p=(root/'models' if a['name'].endswith('.gguf') else root/'downloads')/a['name']
 return p.exists() and p.stat().st_size==a['size'] and a.get('digest') and hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==a['digest'].removeprefix('sha256:')
if (dest/'llama-server.exe').exists() and all(already_verified(a) for a in items):
 print('All model/runtime files already installed and checksum verified.');raise SystemExit(0)
chunks=root/'downloads/chunks';chunks.mkdir(parents=True,exist_ok=True)
step=1024*1024;oldstep=8*step;tasks=[]
for a in items:
 req=urllib.request.Request(a['browser_download_url'],headers={'Range':'bytes=0-1023'})
 with urllib.request.urlopen(req,timeout=20) as response:a['direct']=response.url
 for i,start in enumerate(range(0,a['size'],step)):
  old=chunks/(a['name']+'.'+str(i//8));oldsize=min(oldstep,a['size']-(i//8)*oldstep)
  if old.exists() and old.stat().st_size==oldsize:continue
  tasks.append((a,i,start,min(start+step,a['size'])-1))
def part(task):
 a,i,start,end=task;p=chunks/(a['name']+'.segment.'+str(i));size=end-start+1
 if p.exists() and p.stat().st_size==size:return size
 for attempt in range(3):
  try:
   req=urllib.request.Request(a['direct'],headers={'Range':f'bytes={start}-{end}'})
   with urllib.request.urlopen(req,timeout=15) as response,p.open('wb') as target:
    if response.status!=206 or not response.headers.get('content-range','').startswith(f'bytes {start}-'):raise RuntimeError('Range unsupported')
    remaining=size
    while remaining:
     b=response.read(min(65536,remaining))
     if not b:raise RuntimeError('Incomplete range')
     target.write(b);remaining-=len(b)
   return size
  except Exception as e:
   if attempt==2:print('Download range failed: '+a['name']+' '+str(i)+' '+type(e).__name__,flush=True);raise
completed=0
with concurrent.futures.ThreadPoolExecutor(max_workers=64) as executor:
 futures=[executor.submit(part,t) for t in tasks]
 for f in concurrent.futures.as_completed(futures):
  completed+=f.result()
  if completed//1048576%64==0:print('New verified ranges: '+str(completed//1048576)+' MiB',flush=True)
results=[]
for a in items:
 folder=root/'models' if a['name'].endswith('.gguf') else root/'downloads';p=folder/a['name'];h=hashlib.sha256()
 with p.open('wb') as out:
  for i in range(math.ceil(a['size']/step)):
   old=chunks/(a['name']+'.'+str(i//8));oldsize=min(oldstep,a['size']-(i//8)*oldstep)
   if old.exists() and old.stat().st_size==oldsize:
    with old.open('rb') as src:src.seek((i%8)*step);b=src.read(min(step,a['size']-i*step))
   else:b=(chunks/(a['name']+'.segment.'+str(i))).read_bytes()
   out.write(b);h.update(b)
 digest=h.hexdigest()
 if a.get('digest') and digest!=a['digest'].removeprefix('sha256:'):raise RuntimeError('Checksum mismatch')
 if p.suffix=='.zip':
  with zipfile.ZipFile(p) as z:
   if z.testzip():raise RuntimeError('Corrupt archive')
   for name in z.namelist():
    if not (dest/name).resolve().is_relative_to(dest.resolve()):raise RuntimeError('Unsafe archive')
   import zlib
   for info in z.infolist():
    target=dest/info.filename
    if info.is_dir():target.mkdir(parents=True,exist_ok=True);continue
    if target.exists() and target.stat().st_size==info.file_size:
     crc=0
     with target.open('rb') as existing:
      while b:=existing.read(1048576):crc=zlib.crc32(b,crc)
     if crc==info.CRC:continue
    z.extract(info,dest)
 results.append({'name':a['name'],'sha256':digest,'bytes':p.stat().st_size,'source':a['browser_download_url']});print('Verified '+a['name'],flush=True)
(root/'assistant-upgrade-downloads.json').write_text(json.dumps({'release':release['tag_name'],'files':results},indent=2),encoding='utf-8');print('All files verified.',flush=True)


print("Files verified. Test before activating the larger model.")
